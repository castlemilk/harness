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
 * The roster has two tiers. `prompt-lab` is first-party and REQUIRED — it must
 * resolve at every checkout, and its assertions are unconditional. Victoria and
 * Polymarket live in the omega repo and are configured OPTIONAL: they join the
 * roster when that sibling checkout exists on the building machine and are
 * skipped (by discovery, loudly reported by doctor) when it does not, which is
 * why their assertions below are conditional rather than absent — they run
 * wherever the shells do, and cost nothing where they don't.
 */
const installed = new Set(getUseCases().map((s) => s.id));
const ifInstalled = (id: string) => (installed.has(id) ? it : it.skip);

describe('the generated roster', () => {
  it('contains exactly the configured plugins, in configured order', () => {
    // Subset-in-order against the full expected list: the required first-party
    // shell is always there; the optionals slot in after it when installed.
    const expected = [
      './foreman-plugins/prompt-lab',
      '../omega/foreman-plugins/victoria',
      '../omega/foreman-plugins/polymarket',
    ].filter((spec) => pluginSources.includes(spec));
    expect(pluginSources).toEqual(expected);
    expect(shells.map((s) => s.id)).toEqual(expected.map((spec) => spec.split('/').pop()));
  });

  it('always ships the required prompt-lab shell', () => {
    const lab = getUseCase('prompt-lab');
    expect(lab).not.toBeNull();
    expect(lab?.views.map((v) => v.id)).toEqual(['prompt-lab-versions', 'prompt-lab-bench']);
  });

  it('registers the configured plugins plus the dev-only demo shell', () => {
    // `import.meta.env.DEV` is true under vitest, so this is the dev roster.
    // In `vite build` the demo entry is gone and the configured ones remain.
    const expected = ['demo', 'prompt-lab'];
    if (installed.has('victoria')) expected.push('victoria');
    if (installed.has('polymarket')) expected.push('polymarket');
    expect(getUseCases().map((s) => s.id).sort()).toEqual(expected.sort());
  });

  it('carries the shells themselves, not lookalikes', () => {
    const lab = getUseCase('prompt-lab');
    expect(shells.find((s) => s.id === 'prompt-lab')).toBe(lab);
  });
});

/**
 * What the out-of-tree shells declare, as the host receives it — run only where
 * the omega checkout provides them.
 *
 * These used to live in `victoria/shell.test.ts` and `polymarket/shell.test.tsx`
 * next to the shells. The manifest half went with them; this half could not,
 * because it is an assertion about *this* app — that a plugin's accent, source
 * and vocabulary survive the crossing, and that its tabs land after the core
 * six without shadowing one. A copy of it in the omega repo would pass against
 * an object that never went through the roster.
 */
describe('the shells, as the host sees them', () => {
  ifInstalled('victoria')('gives Victoria its palette accent, its one data source and its one rename', () => {
    const victoria = getUseCase('victoria');
    // victoria.yaml declares #00ff00; the shell brings it onto the palette.
    expect(victoria?.accent).toBe('#3fd97d');
    expect(victoria?.dataSources).toHaveLength(1);
    expect(victoria?.dataSources?.[0].id).toBe('omega-api');
    expect(victoria?.dataSources?.[0].envVar).toBe('VITE_UC_VICTORIA_URL');
    expect(victoria?.vocabulary).toEqual({ harness: 'desk agent' });
  });

  ifInstalled('polymarket')('gives Polymarket a distinct accent, no data source and no rename', () => {
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

  ifInstalled('victoria')('adds Victoria’s ten domain tabs after the core chrome, in declared order', () => {
    const tabs = viewTabs(CORE_VIEWS, 'victoria');
    expect(tabs.map((t) => t.id)).toEqual([
      'console',
      'board',
      'graph',
      'work',
      'usage',
      'playbooks',
      'plugins',
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
    expect(tabs.map((t) => t.label).slice(CORE_VIEWS.length)).toEqual([
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
    expect(tabs.slice(0, CORE_VIEWS.length).every((t) => t.source === 'core')).toBe(true);
    expect(tabs.slice(CORE_VIEWS.length).every((t) => t.source === 'usecase')).toBe(true);
  });

  ifInstalled('polymarket')('adds Polymarket’s single tab, and leaks it into no other objective', () => {
    const tabs = viewTabs(CORE_VIEWS, 'polymarket');
    expect(tabs.map((t) => t.id)).toEqual([
      'console',
      'board',
      'graph',
      'work',
      'usage',
      'playbooks',
      'plugins',
      'polymarket-pipeline',
    ]);
    expect(tabs[CORE_VIEWS.length]).toEqual({ id: 'polymarket-pipeline', label: 'Pipeline', source: 'usecase' });
    expect(viewTabs(CORE_VIEWS, null)).toHaveLength(CORE_VIEWS.length);
  });

  it('gives Prompt Lab two read-only tabs backed by the harness API', () => {
    const tabs = viewTabs(CORE_VIEWS, 'prompt-lab');
    expect(tabs.slice(CORE_VIEWS.length).map((t) => t.id)).toEqual([
      'prompt-lab-versions',
      'prompt-lab-bench',
    ]);
    expect(tabs.slice(CORE_VIEWS.length).every((t) => t.source === 'usecase')).toBe(true);
    const lab = getUseCase('prompt-lab');
    expect(lab?.dataSources?.map((s) => s.id)).toEqual(['harness-api']);
    expect(lab?.dataSources?.[0].probePath).toBe('/projects');
  });

  it('shadows no core tab — every view id is namespaced under its shell id', () => {
    const coreIds = new Set(CORE_VIEWS.map((v) => v.id));
    for (const shell of shells) {
      for (const view of shell.views) {
        expect(coreIds.has(view.id)).toBe(false);
        expect(view.id.startsWith(`${shell.id}-`)).toBe(true);
      }
    }
  });

  it('falls back to Console when a domain tab is open on an objective without it', () => {
    expect(resolveViewId(viewTabs(CORE_VIEWS, null), 'prompt-lab-versions')).toBe('console');
    expect(resolveViewId(viewTabs(CORE_VIEWS, 'prompt-lab'), 'prompt-lab-bench')).toBe(
      'prompt-lab-bench',
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
