import { describe, expect, it } from 'vitest';
import { pluginSources, shells } from 'virtual:foreman-plugins';
import { shellFromModule } from './plugin-module.js';
// Importing the roster registers it, exactly as `ForemanApp` does.
import { CORE_VIEWS, getUseCase, getUseCases, resolveViewId, viewTabs } from './index.js';

/**
 * The roster is what `foreman-plugins.json` says it is.
 *
 * These assertions run against the *generated* module, not a fixture: vitest
 * uses `vite.config.ts`, so `virtual:foreman-plugins` is emitted by the same
 * plugin the dev server and `vite build` use. A discovery change that produced
 * an empty or wrong roster would fail here rather than in a browser.
 *
 * Since OT-3 both configured plugins live in **another repository** — the omega
 * repo this harness is checked out inside, at `../foreman-plugins/*` — which is
 * precisely why this file grew: it is
 * now the harness's whole account of the shells it ships. It cannot import
 * them by path and does not try — everything below comes through the generated
 * roster or the registry, i.e. through the seam an out-of-tree plugin arrives
 * by. The shells' own logic is tested in the omega repo, beside the shells.
 */
describe('the generated roster', () => {
  it('contains exactly the configured plugins, in configured order', () => {
    expect(pluginSources).toEqual([
      '../foreman-plugins/victoria',
      '../foreman-plugins/polymarket',
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
      'victoria-gates',
      'victoria-conviction',
      'victoria-forensics',
      'victoria-journal',
    ]);
  });
});

/**
 * What the out-of-tree shells declare, as the host receives it.
 *
 * These used to live in `victoria/shell.test.ts` and `polymarket/shell.test.tsx`
 * next to the shells. The manifest half went with them; this half could not,
 * because it is an assertion about *this* app — that a plugin's accent, source
 * and vocabulary survive the crossing, and that its tabs land after the core
 * six without shadowing one. A copy of it in the omega repo would pass against
 * an object that never went through the roster.
 */
describe('the shells, as the host sees them', () => {
  it('gives Victoria its palette accent, its one data source and its one rename', () => {
    const victoria = getUseCase('victoria');
    // victoria.yaml declares #00ff00; the shell brings it onto the palette.
    expect(victoria?.accent).toBe('#3fd97d');
    expect(victoria?.dataSources).toHaveLength(1);
    expect(victoria?.dataSources?.[0].id).toBe('omega-api');
    expect(victoria?.dataSources?.[0].envVar).toBe('VITE_UC_VICTORIA_URL');
    expect(victoria?.vocabulary).toEqual({ harness: 'desk agent' });
  });

  it('gives Polymarket a distinct accent, no data source and no rename', () => {
    // No source is the honest answer, not an oversight: nothing in omega serves
    // polymarket over HTTP, and an aspirational entry would put a permanently
    // red health dot in the chrome.
    const polymarket = getUseCase('polymarket');
    expect(polymarket?.name).toBe('Polymarket — prediction markets');
    expect(polymarket?.accent).toBe('#a67ff0');
    expect(polymarket?.accent).not.toBe(getUseCase('victoria')?.accent);
    expect(polymarket?.dataSources).toBeUndefined();
    expect(polymarket?.vocabulary).toBeUndefined();
  });

  it('adds Victoria’s ten domain tabs after the core six, in declared order', () => {
    const tabs = viewTabs(CORE_VIEWS, 'victoria');
    expect(tabs.map((t) => t.id)).toEqual([
      'console',
      'board',
      'graph',
      'work',
      'usage',
      'playbooks',
      'victoria-overview',
      'victoria-runs',
      'victoria-live',
      'victoria-trades',
      'victoria-equity',
      'victoria-signals',
      'victoria-gates',
      'victoria-conviction',
      'victoria-forensics',
      'victoria-journal',
    ]);
    expect(tabs.map((t) => t.label).slice(6)).toEqual([
      'Overview',
      'Runs',
      'Live',
      'Trades',
      'Equity',
      'Signals',
      'Gates',
      'Conviction',
      'Forensics',
      'Journal',
    ]);
    expect(tabs.slice(0, 6).every((t) => t.source === 'core')).toBe(true);
    expect(tabs.slice(6).every((t) => t.source === 'usecase')).toBe(true);
  });

  it('adds Polymarket’s single tab, and leaks it into no other objective', () => {
    const tabs = viewTabs(CORE_VIEWS, 'polymarket');
    expect(tabs.map((t) => t.id)).toEqual([
      'console',
      'board',
      'graph',
      'work',
      'usage',
      'playbooks',
      'polymarket-pipeline',
    ]);
    expect(tabs[6]).toEqual({ id: 'polymarket-pipeline', label: 'Pipeline', source: 'usecase' });
    expect(viewTabs(CORE_VIEWS, 'victoria').map((t) => t.id)).not.toContain('polymarket-pipeline');
    expect(viewTabs(CORE_VIEWS, null)).toHaveLength(6);
  });

  it('shadows no core tab — every out-of-tree view id is namespaced', () => {
    const coreIds = new Set(CORE_VIEWS.map((v) => v.id));
    for (const shell of shells) {
      for (const view of shell.views) {
        expect(coreIds.has(view.id)).toBe(false);
        expect(view.id.startsWith(`${shell.id}-`)).toBe(true);
      }
    }
  });

  it('falls back to Console when a domain tab is open on an objective without it', () => {
    expect(resolveViewId(viewTabs(CORE_VIEWS, null), 'victoria-equity')).toBe('console');
    expect(resolveViewId(viewTabs(CORE_VIEWS, 'polymarket'), 'victoria-equity')).toBe('console');
    expect(resolveViewId(viewTabs(CORE_VIEWS, 'victoria'), 'victoria-equity')).toBe(
      'victoria-equity',
    );
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
