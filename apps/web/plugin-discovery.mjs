/**
 * Where the use-case plugins live — the single answer, for every tool that
 * needs it.
 *
 * A plugin is a directory containing a module that exports one `UseCaseShell`.
 * Which directories those are is a **build-time configuration**, not a runtime
 * lookup: `foreman-plugins.json` at the repo root lists them, this module
 * resolves that list to absolute paths, and everything downstream is static
 * imports. So a required plugin that is configured but not on disk fails the
 * build with the path in the message, and can never become a blank tab in front
 * of an operator. Entries under `optional` are allowed to be absent — see
 * `parsePluginSpecs`.
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
 * `plugins` are **required**: a configured path that is not on disk fails the
 * build. `optional` entries resolve like any other but may be absent — a
 * directory that does not exist skips with a note instead of failing, which is
 * how the omega repo's shells (`../foreman-plugins/*`) stay configured here
 * without demanding that checkout on every machine that builds this one. An
 * optional path that EXISTS but is broken (no entry module, a duplicate entry)
 * still fails: "absent" is a state of the world, "broken" is a bug.
 *
 * `FOREMAN_PLUGINS` (comma-separated) replaces the file **entirely** rather
 * than adding to it — CI and one-off experiments want "exactly these", and an
 * override that merges gives you the file's plugins plus yours with no way to
 * ask for fewer. Under the override there are no optionals: what you listed is
 * everything, required. An empty override (`FOREMAN_PLUGINS=`) is treated as no
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
      optionalSpecs: [],
    };
  }

  if (configText === undefined || configText === null) {
    throw new Error(
      `Foreman plugin discovery: ${CONFIG_FILE} not found at the repo root.\n` +
        `Create it with the plugins this build should ship, e.g.\n` +
        `  { "plugins": ["./foreman-plugins/prompt-lab"] }\n` +
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

  const optional = parsed?.optional;
  if (optional !== undefined && (!Array.isArray(optional) || optional.some((p) => typeof p !== 'string'))) {
    throw new Error(
      `Foreman plugin discovery: ${CONFIG_FILE}'s "optional" must be an array of path strings, got ${JSON.stringify(
        optional
      )}.`
    );
  }

  return {
    source: CONFIG_FILE,
    specs: plugins.map((p) => p.trim()).filter((p) => p !== ''),
    optionalSpecs: Array.isArray(optional)
      ? optional.map((p) => p.trim()).filter((p) => p !== '')
      : [],
  };
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
 * *required* entry: half a roster is not a useful thing to hand a build.
 *
 * `optional` entries are resolved too, but one whose directory does not exist
 * is skipped — reported through `onSkipped` when a caller wants the note (the
 * doctor does), dropped silently otherwise, where "otherwise" is the build,
 * which only cares that what it ships resolves.
 */
export function loadPlugins({
  root = REPO_ROOT,
  env = process.env,
  readFile = readFileSync,
  statPath = statSync,
  onSkipped,
} = {}) {
  const configPath = join(root, CONFIG_FILE);
  let configText;
  try {
    configText = readFile(configPath, 'utf8');
  } catch {
    configText = undefined;
  }

  const { source, specs, optionalSpecs } = parsePluginSpecs({ configText, env });

  const plugins = [];
  const seen = new Map();
  const claim = (plugin) => {
    const prior = seen.get(plugin.entry);
    if (prior !== undefined) {
      throw new Error(
        `Foreman plugin discovery: "${plugin.spec}" and "${prior}" (from ${source}) resolve to the same entry module ${plugin.entry}.`
      );
    }
    seen.set(plugin.entry, plugin.spec);
    plugins.push(plugin);
  };

  for (const spec of specs) claim(resolvePlugin(spec, { root, source, statPath }));

  for (const spec of optionalSpecs) {
    try {
      claim(resolvePlugin(spec, { root, source, statPath }));
    } catch (err) {
      // Skip only true absence. A directory that exists but has no entry
      // module, or an entry shared with another plugin, is a bug in something
      // that IS installed — failing loudly beats a quietly missing tab.
      const abs = isAbsolute(spec) ? spec : resolve(root, spec);
      if (tryStat(abs, statPath) === null) {
        onSkipped?.({ spec, source, reason: 'not installed' });
        continue;
      }
      throw err;
    }
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
