import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * What `task doctor` can say about the use-case plugins, without a bundler.
 *
 * Two questions get people stuck on a fresh checkout, and neither is answerable
 * from the app:
 *
 *   1. **Does `foreman-plugins.json` resolve?** The shells live in the omega
 *      repo at `../foreman-plugins/*`, so a harness cloned on its own has
 *      nothing there and `vite` dies at config load. That error is good, but
 *      you only see it by trying to start the thing.
 *   2. **Is the plugin's backend up?** Victoria reads the omega Go API on
 *      :8080, which the harness neither starts nor depends on. Without it the
 *      Victoria tabs render honest errors — expected, and indistinguishable
 *      from a broken build if nobody told you.
 *
 * The resolution half reuses `apps/web/plugin-discovery.mjs`, the same module
 * Vite and Tailwind read, so doctor cannot disagree with the build about which
 * plugins exist.
 *
 * The backend half is a **static read of the plugin's source**, and it says so.
 * A manifest is TypeScript that imports React views; evaluating it here would
 * mean carrying a bundler inside a diagnostic. So `declaredSources` scans for
 * data-source object literals instead. Its failure mode is finding *fewer*
 * sources than the shell declares, never inventing one — and finding none is
 * reported as "none found", not as "healthy".
 */

/** One entry of `foreman-plugins.json`, resolved to disk. */
export interface ResolvedPlugin {
  /** Directory basename — a label, not the shell's registered id. */
  id: string;
  /** The configured path, verbatim. */
  spec: string;
  dir: string;
  entry: string;
}

/** A data source as the plugin's source text declares it. */
export interface DeclaredSource {
  id: string;
  label: string;
  baseUrl: string;
  envVar?: string;
  probePath?: string;
}

interface DiscoveryModule {
  loadPlugins: (options?: { root?: string }) => ResolvedPlugin[];
}

/**
 * Resolve `foreman-plugins.json` exactly as the build does, or return the
 * error it would have failed with. Never throws: doctor's job is to report a
 * broken configuration, not to inherit it.
 */
export async function resolvePlugins(
  root: string,
): Promise<{ plugins: ResolvedPlugin[]; error: string | null }> {
  const discovery = path.join(root, 'apps/web/plugin-discovery.mjs');
  if (!fs.existsSync(discovery)) {
    return { plugins: [], error: `Plugin discovery is missing: ${discovery}` };
  }
  try {
    const mod = (await import(pathToFileURL(discovery).href)) as DiscoveryModule;
    return { plugins: mod.loadPlugins({ root }), error: null };
  } catch (err) {
    return { plugins: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** `name@version` from a plugin's package.json, or null when it has none. */
export function pluginPackage(dir: string): { name: string; version: string } | null {
  const file = path.join(dir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    if (typeof pkg.name !== 'string') return null;
    return { name: pkg.name, version: typeof pkg.version === 'string' ? pkg.version : '?' };
  } catch {
    return null;
  }
}

/**
 * Is this configured path inside the harness repo? Lexical, like the
 * equivalent judgement in `plugin-discovery.mjs` — it only picks wording.
 */
export function isOutOfTree(dir: string, root: string): boolean {
  return dir !== root && !dir.startsWith(root.endsWith('/') ? root : root + '/');
}

const FIELD = (name: string) => new RegExp(`\\b${name}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`);

/**
 * Every data-source literal in a module's source text.
 *
 * Anchored on `baseUrl:`, because that is the one field a source cannot omit;
 * from each occurrence it walks out to the enclosing braces and reads the
 * sibling fields. An object without an `id` is skipped rather than guessed at.
 */
export function declaredSources(text: string): DeclaredSource[] {
  const out: DeclaredSource[] = [];
  const anchor = /\bbaseUrl\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(text)) !== null) {
    const open = text.lastIndexOf('{', match.index);
    if (open === -1) continue;
    const close = matchingBrace(text, open);
    if (close === -1) continue;
    const literal = text.slice(open, close + 1);
    const baseUrl = FIELD('baseUrl').exec(literal)?.[1];
    const id = FIELD('id').exec(literal)?.[1];
    if (baseUrl === undefined || id === undefined) continue;
    out.push({
      id,
      label: FIELD('label').exec(literal)?.[1] ?? id,
      baseUrl,
      envVar: FIELD('envVar').exec(literal)?.[1],
      probePath: FIELD('probePath').exec(literal)?.[1],
    });
    anchor.lastIndex = close;
  }
  return dedupeById(out);
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function dedupeById(sources: DeclaredSource[]): DeclaredSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/**
 * The sources a plugin declares, gathered from the modules at the top of its
 * directory. Not recursive: a shell's sources live in its manifest or the
 * client module beside it, never inside a view.
 */
export function pluginSourcesOnDisk(dir: string): DeclaredSource[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const modules = names
    .filter((n) => /\.(ts|tsx|js|mjs)$/.test(n) && !n.includes('.test.'))
    .sort();
  const found: DeclaredSource[] = [];
  for (const name of modules) {
    try {
      found.push(...declaredSources(fs.readFileSync(path.join(dir, name), 'utf8')));
    } catch {
      /* unreadable file: nothing to declare */
    }
  }
  return dedupeById(found);
}

/**
 * The URL a probe should hit: the env override when one is set, plus the
 * declared probe path. Same precedence the kit's `resolveBaseUrl` uses, so
 * doctor and the health dot check the same address.
 */
export function probeUrl(source: DeclaredSource, env: NodeJS.ProcessEnv = process.env): string {
  const override = source.envVar ? env[source.envVar] : undefined;
  const base = (override !== undefined && override.length > 0 ? override : source.baseUrl).replace(
    /\/+$/,
    '',
  );
  const suffix = source.probePath ?? '';
  return suffix.startsWith('/') ? base + suffix : base + (suffix ? `/${suffix}` : '');
}

/** A single GET with a short deadline. Any answer at all counts as reachable. */
export async function reachable(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
