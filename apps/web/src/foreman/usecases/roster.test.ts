import { describe, expect, it } from 'vitest';
import { pluginSources, shells } from 'virtual:foreman-plugins';
import { shellFromModule } from './plugin-module.js';
// Importing the roster registers it, exactly as `ForemanApp` does.
import { getUseCases } from './index.js';

/**
 * The roster is what `foreman-plugins.json` says it is.
 *
 * These assertions run against the *generated* module, not a fixture: vitest
 * uses `vite.config.ts`, so `virtual:foreman-plugins` is emitted by the same
 * plugin the dev server and `vite build` use. A discovery change that produced
 * an empty or wrong roster would fail here rather than in a browser.
 */
describe('the generated roster', () => {
  it('contains exactly the configured plugins, in configured order', () => {
    expect(pluginSources).toEqual([
      './apps/web/src/foreman/usecases/victoria',
      './apps/web/src/foreman/usecases/polymarket',
    ]);
    expect(shells.map((s) => s.id)).toEqual(['victoria', 'polymarket']);
  });

  it('registers the configured plugins plus the dev-only demo shell', () => {
    // `import.meta.env.DEV` is true under vitest, so this is the dev roster.
    // In `vite build` the demo entry is gone and the first two remain.
    expect(getUseCases().map((s) => s.id).sort()).toEqual(['demo', 'polymarket', 'victoria']);
  });

  it('carries the shells themselves, not lookalikes', () => {
    const victoria = shells.find((s) => s.id === 'victoria');
    expect(victoria).toBe(getUseCases().find((s) => s.id === 'victoria'));
    expect(victoria?.views.map((v) => v.id)).toEqual([
      'victoria-overview',
      'victoria-runs',
      'victoria-live',
      'victoria-trades',
      'victoria-equity',
      'victoria-signals',
    ]);
  });
});

/**
 * The plugin → shell rule, which the generated roster applies to every
 * configured entry: one shell per entry module, named however the plugin likes.
 */
describe('shellFromModule', () => {
  const shell = { id: 'x', name: 'X', views: [] };

  it('finds the shell whatever the export is called', () => {
    expect(shellFromModule({ anythingUseCase: shell }, './x')).toBe(shell);
    expect(shellFromModule({ default: shell }, './x')).toBe(shell);
  });

  it('ignores exports that are not shells', () => {
    expect(shellFromModule({ ACCENT: '#fff', helper: () => null, s: shell }, './x')).toBe(shell);
  });

  it('names the plugin, and what it did export, when there is no shell', () => {
    expect(() => shellFromModule({ ACCENT: '#fff' }, './plugins/x')).toThrow(
      /plugin \.\/plugins\/x exports no UseCaseShell[\s\S]*Exports seen: ACCENT/
    );
  });

  it('prefers the default export when a plugin re-exports its own shell', () => {
    const other = { id: 'y', name: 'Y', views: [] };
    expect(shellFromModule({ default: shell, named: shell, other }, './x')).toBe(shell);
  });

  it('refuses two unrelated shells in one entry module', () => {
    expect(() => shellFromModule({ a: shell, b: { id: 'y', name: 'Y', views: [] } }, './x')).toThrow(
      /exports 2 UseCaseShells \(a, b\)/
    );
  });
});
