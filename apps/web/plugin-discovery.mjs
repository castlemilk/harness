/**
 * Where the use-case plugins live — the single answer, for every tool that
 * needs it.
 *
 * A plugin is a directory containing a module that exports one `UseCaseShell`.
 * Which directories those are is a **build-time configuration**, not a runtime
 * lookup: `foreman-plugins.json` at the repo root lists them, this module
 * resolves that list to absolute paths, and everything downstream is static
 * imports. So a plugin that is configured but not on disk fails the build with
 * the path in the message, and can never become a blank tab in front of an
 * operator.
 *
 * Three tools read this, and they must agree or the failure is silent:
 *
 *   - `vite.config.ts` generates the roster (`virtual:foreman-plugins`) from
 *     `pluginEntries()` and widens `server.fs.allow` with `pluginDirs()`, so
 *     dev and build can both reach a directory outside this repository.
 *   - `tailwind.config.js` adds `pluginDirs()` to `content`. This is the one
 *     that bites: an out-of-tree plugin not in `content` still *renders*, it
 *     just renders unstyled, because its classes were purged. Same source of
 *     truth, so it cannot drift.
 *   - the tests below, which are the reason the parsing is a pure function.
 *
 * Plain JavaScript and dependency-free on purpose: it is imported by two config
 * files that run before any build step, one of which (`tailwind.config.js`) is
 * not TypeScript at all.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The harness repo root — `foreman-plugins.json` lives here, and relative plugin paths are resolved against it. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CONFIG_FILE = 'foreman-plugins.json';

/** Entry module names tried, in order, inside a plugin directory. */
const ENTRY_NAMES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs'];

/**
 * The configured plugin paths, before any of them touch the disk.
 *
 * `FOREMAN_PLUGINS` (comma-separated) replaces the file **entirely** rather
 * than adding to it — CI and one-off experiments want "exactly these", and an
 * override that merges gives you the file's plugins plus yours with no way to
 * ask for fewer. An empty override (`FOREMAN_PLUGINS=`) is treated as no
 * override at all: an exported-but-empty variable is far more often a shell
 * accident than a request to ship an app with no domains. To ship none, say so
 * in the file — `{ "plugins": [] }`.
 */
export function parsePluginSpecs({ configText, env = {} }) {
  const override = env.FOREMAN_PLUGINS;
  if (typeof override === 'string' && override.trim() !== '') {
    return {
      source: 'FOREMAN_PLUGINS',
      specs: override
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    };
  }

  if (configText === undefined || configText === null) {
    throw new Error(
      `Foreman plugin discovery: ${CONFIG_FILE} not found at the repo root.\n` +
        `Create it with the plugins this build should ship, e.g.\n` +
        `  { "plugins": ["../foreman-plugins/victoria"] }\n` +
        `or set FOREMAN_PLUGINS=<comma-separated paths> to override it for this run.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(configText);
  } catch (err) {
    throw new Error(`Foreman plugin discovery: ${CONFIG_FILE} is not valid JSON — ${err.message}`);
  }

  const plugins = parsed?.plugins;
  if (!Array.isArray(plugins) || plugins.some((p) => typeof p !== 'string')) {
    throw new Error(
      `Foreman plugin discovery: ${CONFIG_FILE} must contain a "plugins" array of path strings, got ${JSON.stringify(
        plugins
      )}.`
    );
  }

  return { source: CONFIG_FILE, specs: plugins.map((p) => p.trim()).filter((p) => p !== '') };
}

/**
 * Resolve one configured path to `{ id, dir, entry }`, or throw saying which
 * configured path is wrong and what would fix it.
 *
 * A spec may name a directory (the normal case — its `index.ts` is the entry)
 * or a module file directly. `id` is derived from the path and is only a label
 * for messages and the generated roster's variable names; the shell's real id
 * comes from its manifest, and the registry is what enforces uniqueness on it.
 */
export function resolvePlugin(spec, { root = REPO_ROOT, source = CONFIG_FILE, statPath = statSync } = {}) {
  const abs = isAbsolute(spec) ? spec : resolve(root, spec);

  const stat = tryStat(abs, statPath);
  if (stat === null) {
    // The common failure since OT-3 is not a typo, it is a missing *checkout*:
    // the shells live in the omega repo, and a harness cloned on its own has
    // nothing at `../foreman-plugins/*`. Saying which side of the seam is
    // absent is the difference between "fix your config" (wrong, the config is
    // right) and "clone the other repo" (what actually has to happen).
    const outOfTree = !isInside(abs, root);
    throw new Error(
      `Foreman plugin discovery: plugin "${spec}" (from ${source}) does not exist.\n` +
        `  looked for: ${abs}\n` +
        (outOfTree
          ? `That path is outside the harness repo (${root}), so this plugin comes from another ` +
            `checkout — clone or update the repository that provides it, at exactly that path.\n`
          : '') +
        `Fix the path in ${CONFIG_FILE}, remove the entry if the plugin is gone, ` +
        `or check out the repository that provides it.`
    );
  }

  if (stat.isFile()) {
    const id = basenameNoExt(abs);
    return { id, spec, dir: dirname(abs), entry: abs };
  }

  for (const name of ENTRY_NAMES) {
    const candidate = join(abs, name);
    const entryStat = tryStat(candidate, statPath);
    if (entryStat !== null && entryStat.isFile()) {
      return { id: basenameNoExt(abs), spec, dir: abs, entry: candidate };
    }
  }

  throw new Error(
    `Foreman plugin discovery: plugin "${spec}" (from ${source}) has no entry module.\n` +
      `  directory: ${abs}\n` +
      `  expected one of: ${ENTRY_NAMES.join(', ')}\n` +
      `A plugin's entry module exports exactly one UseCaseShell; see docs/USE-CASE-SHELLS.md.`
  );
}

/**
 * Every configured plugin, resolved and validated. Throws on the first bad
 * entry: half a roster is not a useful thing to hand a build.
 */
export function loadPlugins({ root = REPO_ROOT, env = process.env, readFile = readFileSync, statPath = statSync } = {}) {
  const configPath = join(root, CONFIG_FILE);
  let configText;
  try {
    configText = readFile(configPath, 'utf8');
  } catch {
    configText = undefined;
  }

  const { source, specs } = parsePluginSpecs({ configText, env });
  const plugins = specs.map((spec) => resolvePlugin(spec, { root, source, statPath }));

  const seen = new Map();
  for (const plugin of plugins) {
    const prior = seen.get(plugin.entry);
    if (prior !== undefined) {
      throw new Error(
        `Foreman plugin discovery: "${plugin.spec}" and "${prior}" (from ${source}) resolve to the same entry module ${plugin.entry}.`
      );
    }
    seen.set(plugin.entry, plugin.spec);
  }

  return plugins;
}

/** Absolute plugin directories — Tailwind `content` globs and `server.fs.allow`. */
export function pluginDirs(options) {
  return loadPlugins(options).map((p) => p.dir);
}

/** `{ id, dir, entry }` per plugin — what the generated roster imports. */
export function pluginEntries(options) {
  return loadPlugins(options);
}

/**
 * Tailwind `content` globs for the configured plugins, absolute so the cwd
 * cannot matter.
 *
 * The glob is unfiltered: it would descend into a `node_modules` inside a
 * plugin directory if one ever appeared there. None does today — plugins
 * install at their repo root, not per-directory — but a plugin that grew its
 * own `node_modules` would make every Tailwind scan walk its dependency tree.
 * Add an ignore then; there is nothing to ignore now.
 */
export function pluginContentGlobs(options) {
  return pluginDirs(options).map((dir) => join(dir, '**/*.{js,ts,jsx,tsx}'));
}

/**
 * Is `path` the root itself, or under it? String comparison on purpose — no
 * realpath, no fs.
 *
 * That makes it a *lexical* answer, and it is only used to choose the wording
 * of an error, so being wrong is cosmetic. It can be wrong two ways: a plugin
 * symlinked from inside the repo to a directory outside it reads as in-tree,
 * and a path outside the repo that symlinks back in reads as out-of-tree. Both
 * would print the less helpful half of the "clone the other repo" message and
 * nothing else. Resolving symlinks here would mean an fs call on a path that,
 * at the one moment this runs, is known not to exist.
 */
function isInside(path, root) {
  return path === root || path.startsWith(root.endsWith('/') ? root : root + '/');
}

function tryStat(path, statPath) {
  try {
    return statPath(path);
  } catch {
    return null;
  }
}

function basenameNoExt(path) {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
}
