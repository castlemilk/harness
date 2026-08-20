import { describe, expect, it } from 'vitest';
import {
  declaredSources,
  isOutOfTree,
  pluginPackage,
  pluginSourcesOnDisk,
  probeUrl,
  resolvePlugins,
} from './plugins.js';
import { repoRoot } from './repo.js';

/**
 * What `task doctor` says about the use-case plugins.
 *
 * The parsing is pure and gets the edge cases; the last block runs against the
 * **real** configuration, because the value of the check is entirely that it
 * agrees with what the build resolves. A test that fed it a fixture would pass
 * on a checkout where the plugins are missing — which is the exact situation
 * the check exists to report.
 */

describe('declaredSources', () => {
  it('reads a source literal whole', () => {
    expect(
      declaredSources(`
        export const OMEGA_SOURCE: UseCaseDataSourceConfig = {
          id: 'omega-api',
          label: 'Omega API',
          baseUrl: 'http://localhost:8080',
          envVar: 'VITE_UC_VICTORIA_URL',
          probePath: '/api/v1/training/versions',
        };
      `),
    ).toEqual([
      {
        id: 'omega-api',
        label: 'Omega API',
        baseUrl: 'http://localhost:8080',
        envVar: 'VITE_UC_VICTORIA_URL',
        probePath: '/api/v1/training/versions',
      },
    ]);
  });

  it('finds an untyped literal too, and one inline in a manifest', () => {
    const found = declaredSources(`
      const A = { id: 'a', label: 'A', baseUrl: 'http://a' };
      export const shell = {
        id: 'x',
        dataSources: [{ id: 'b', label: 'B', baseUrl: 'http://b', probePath: '/ping' }],
      };
    `);
    expect(found.map((s) => s.id)).toEqual(['a', 'b']);
    expect(found[1].probePath).toBe('/ping');
  });

  it('skips a literal with no id rather than inventing one', () => {
    // Finding fewer sources than a shell declares is the acceptable failure of
    // a static read. Reporting a source that isn't there is not.
    expect(declaredSources(`const s = { label: 'L', baseUrl: 'http://x' };`)).toEqual([]);
  });

  it('falls back to the id when a source declares no label', () => {
    expect(declaredSources(`const s = { id: 'q', baseUrl: 'http://x' };`)[0].label).toBe('q');
  });

  it('reports one source once, however many modules mention it', () => {
    const text = `const a = { id: 'a', baseUrl: 'http://a' }; const b = { id: 'a', baseUrl: 'http://a' };`;
    expect(declaredSources(text)).toHaveLength(1);
  });

  it('finds nothing in a shell that declares no backend', () => {
    expect(declaredSources(`export const shell = { id: 'polymarket', views: [] };`)).toEqual([]);
  });
});

describe('probeUrl', () => {
  const source = {
    id: 'omega-api',
    label: 'Omega API',
    baseUrl: 'http://localhost:8080',
    envVar: 'VITE_UC_VICTORIA_URL',
    probePath: '/api/v1/training/versions',
  };

  it('uses the declared base and probe path', () => {
    expect(probeUrl(source, {})).toBe('http://localhost:8080/api/v1/training/versions');
  });

  it('honours the env override, so doctor probes what the app would', () => {
    expect(probeUrl(source, { VITE_UC_VICTORIA_URL: 'https://omega.example/' })).toBe(
      'https://omega.example/api/v1/training/versions',
    );
  });

  it('ignores an override set to the empty string, matching the kit', () => {
    expect(probeUrl(source, { VITE_UC_VICTORIA_URL: '' })).toBe(
      'http://localhost:8080/api/v1/training/versions',
    );
  });

  it('probes the base itself when no path is declared', () => {
    expect(probeUrl({ id: 'a', label: 'A', baseUrl: 'http://a/' }, {})).toBe('http://a');
  });
});

describe('against the real configuration', () => {
  const root = repoRoot();

  it('resolves foreman-plugins.json the way the build does', async () => {
    const { plugins, error } = await resolvePlugins(root);
    expect(error).toBeNull();
    expect(plugins.map((p) => p.id)).toEqual(['victoria', 'polymarket']);
    for (const plugin of plugins) {
      // The shells live in the omega repo; that is what doctor has to be able
      // to say out loud when they are absent.
      expect(isOutOfTree(plugin.dir, root)).toBe(true);
      expect(pluginPackage(plugin.dir)?.version).toBeTruthy();
    }
  });

  it('finds Victoria’s one backend, and Polymarket’s none', async () => {
    const { plugins } = await resolvePlugins(root);
    const victoria = plugins.find((p) => p.id === 'victoria');
    const polymarket = plugins.find((p) => p.id === 'polymarket');
    expect(pluginSourcesOnDisk(victoria?.dir ?? '')).toEqual([
      {
        id: 'omega-api',
        label: 'Omega API',
        baseUrl: 'http://localhost:8080',
        envVar: 'VITE_UC_VICTORIA_URL',
        probePath: '/api/v1/training/versions',
      },
    ]);
    expect(pluginSourcesOnDisk(polymarket?.dir ?? '')).toEqual([]);
  });
});
