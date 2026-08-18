import { describe, expect, it } from 'vitest';
import { CONFIG_FILE, loadPlugins, parsePluginSpecs, pluginEntries, resolvePlugin } from './plugin-discovery.mjs';

/**
 * Plugin discovery: what the configuration means, and what happens when it is
 * wrong.
 *
 * The reason this is worth testing at all is the failure mode it exists to
 * prevent. Discovery runs inside `vite.config.ts` and `tailwind.config.js`, so
 * the only way to see a bad message is to break a build; the parsing and
 * resolution are pure functions here precisely so the messages can be asserted
 * without one. `statPath` is injectable for the same reason — the missing-plugin
 * case must be testable without deleting anything from the working tree.
 */

// A fake filesystem: paths present as directories, and as files.
function fakeStat(dirs, files) {
  return (path) => {
    if (dirs.includes(path)) return { isFile: () => false };
    if (files.includes(path)) return { isFile: () => true };
    const err = new Error(`ENOENT: ${path}`);
    err.code = 'ENOENT';
    throw err;
  };
}

describe('parsePluginSpecs', () => {
  it('reads the plugins array from the config file', () => {
    const { source, specs } = parsePluginSpecs({
      configText: '{"plugins":["./a","/abs/b"]}',
      env: {},
    });
    expect(source).toBe(CONFIG_FILE);
    expect(specs).toEqual(['./a', '/abs/b']);
  });

  it('lets FOREMAN_PLUGINS replace the file entirely, not add to it', () => {
    const { source, specs } = parsePluginSpecs({
      configText: '{"plugins":["./from-file"]}',
      env: { FOREMAN_PLUGINS: './only, /abs/this ' },
    });
    expect(source).toBe('FOREMAN_PLUGINS');
    expect(specs).toEqual(['./only', '/abs/this']);
  });

  it('treats an empty FOREMAN_PLUGINS as unset, not as "ship no domains"', () => {
    const { source, specs } = parsePluginSpecs({
      configText: '{"plugins":["./from-file"]}',
      env: { FOREMAN_PLUGINS: '  ' },
    });
    expect(source).toBe(CONFIG_FILE);
    expect(specs).toEqual(['./from-file']);
  });

  it('accepts an explicitly empty roster from the file', () => {
    expect(parsePluginSpecs({ configText: '{"plugins":[]}', env: {} }).specs).toEqual([]);
  });

  it('says what to write when the config file is absent', () => {
    expect(() => parsePluginSpecs({ configText: undefined, env: {} })).toThrow(
      /foreman-plugins\.json not found at the repo root[\s\S]*FOREMAN_PLUGINS/
    );
  });

  it('names the JSON error rather than crashing opaquely', () => {
    expect(() => parsePluginSpecs({ configText: '{oops', env: {} })).toThrow(/is not valid JSON/);
  });

  it('rejects a config whose plugins is not an array of strings', () => {
    expect(() => parsePluginSpecs({ configText: '{"plugins":"./a"}', env: {} })).toThrow(
      /must contain a "plugins" array of path strings, got "\.\/a"/
    );
    expect(() => parsePluginSpecs({ configText: '{}', env: {} })).toThrow(/got undefined/);
  });
});

describe('resolvePlugin', () => {
  const root = '/repo';

  it('resolves a relative directory to its index entry', () => {
    const statPath = fakeStat(['/repo/plugins/victoria'], ['/repo/plugins/victoria/index.ts']);
    expect(resolvePlugin('./plugins/victoria', { root, statPath })).toEqual({
      id: 'victoria',
      spec: './plugins/victoria',
      dir: '/repo/plugins/victoria',
      entry: '/repo/plugins/victoria/index.ts',
    });
  });

  it('accepts an absolute directory outside the repo — the whole point of the config', () => {
    const statPath = fakeStat(['/elsewhere/omega/foreman/victoria'], ['/elsewhere/omega/foreman/victoria/index.tsx']);
    expect(resolvePlugin('/elsewhere/omega/foreman/victoria', { root, statPath })).toMatchObject({
      dir: '/elsewhere/omega/foreman/victoria',
      entry: '/elsewhere/omega/foreman/victoria/index.tsx',
    });
  });

  it('accepts a module file directly', () => {
    const statPath = fakeStat([], ['/repo/plugins/demo.tsx']);
    expect(resolvePlugin('./plugins/demo.tsx', { root, statPath })).toEqual({
      id: 'demo',
      spec: './plugins/demo.tsx',
      dir: '/repo/plugins',
      entry: '/repo/plugins/demo.tsx',
    });
  });

  it('fails loudly, with the path and a fix, when the plugin is not there', () => {
    const statPath = fakeStat([], []);
    expect(() => resolvePlugin('../omega/foreman/victoria', { root, statPath })).toThrow(
      /plugin "\.\.\/omega\/foreman\/victoria" \(from foreman-plugins\.json\) does not exist[\s\S]*looked for: \/omega\/foreman\/victoria[\s\S]*check out the repository that provides it/
    );
  });

  it('fails when the directory exists but has no entry module', () => {
    const statPath = fakeStat(['/repo/plugins/hollow'], []);
    expect(() => resolvePlugin('./plugins/hollow', { root, statPath })).toThrow(
      /has no entry module[\s\S]*expected one of: index\.ts, index\.tsx, index\.js, index\.mjs/
    );
  });

  it('attributes the failure to the env override when that is where it came from', () => {
    const statPath = fakeStat([], []);
    expect(() => resolvePlugin('./gone', { root, statPath, source: 'FOREMAN_PLUGINS' })).toThrow(
      /\(from FOREMAN_PLUGINS\)/
    );
  });
});

describe('loadPlugins', () => {
  it('refuses two config entries that are the same plugin', () => {
    const statPath = fakeStat(['/repo/a'], ['/repo/a/index.ts']);
    expect(() =>
      loadPlugins({
        root: '/repo',
        env: {},
        readFile: () => '{"plugins":["./a","/repo/a"]}',
        statPath,
      })
    ).toThrow(/resolve to the same entry module \/repo\/a\/index\.ts/);
  });

  it('reads the repo\'s real config, and every plugin in it is on disk', () => {
    // Not a fixture: this is the assertion that the checked-in
    // foreman-plugins.json is valid, which is the same call vite.config.ts makes.
    const plugins = pluginEntries();
    expect(plugins.map((p) => p.id)).toEqual(['victoria', 'polymarket']);
    for (const plugin of plugins) {
      expect(plugin.entry.startsWith(plugin.dir + '/')).toBe(true);
    }
  });
});
