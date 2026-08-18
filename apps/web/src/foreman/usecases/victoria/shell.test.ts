/**
 * The Victoria shell as the app sees it.
 *
 * Importing the roster (`../index.js`) is what registers Victoria, exactly as
 * `ForemanApp` does — so these assertions cover the real registration path, not
 * a hand-built shell that happens to look like it.
 */
import { describe, expect, it } from 'vitest';
import { CORE_VIEWS, getUseCase, resolveViewId, viewTabs } from '../index.js';
import { victoriaUseCase } from './index.js';
import { predecessorOf, sortVersions } from './views/Runs.js';
import { summariseByRegime } from './views/Trades.js';
import { maxDrawdown } from './views/Equity.js';
import { settleTrades, TRADE_DETAILS_SOURCE, TRADE_RPC_SOURCE } from './hooks.js';
import { DataSourceError } from '../data-source.js';
import { pct, pnlClass, ratio, regimeColor, signedPct, signedUsd, usd } from './format.js';
import type { VersionInfo } from './client.js';

describe('registration', () => {
  it('is registered by the roster in every build, not just dev', () => {
    // The demo shell is dev-only; Victoria is a real domain shell with a real
    // backend and must reach an operator in production.
    expect(getUseCase('victoria')).toBe(victoriaUseCase);
  });

  it('declares exactly one data source, the omega API', () => {
    expect(victoriaUseCase.dataSources).toHaveLength(1);
    expect(victoriaUseCase.dataSources?.[0].id).toBe('omega-api');
    expect(victoriaUseCase.dataSources?.[0].envVar).toBe('VITE_UC_VICTORIA_URL');
  });

  it('carries an accent that is legible on the canvas', () => {
    // victoria.yaml declares #00ff00; the shell brings it onto the palette.
    expect(victoriaUseCase.accent).toBe('#3fd97d');
    expect(victoriaUseCase.accent).not.toBe('#00ff00');
  });

  it('renames only the term that reads naturally', () => {
    expect(victoriaUseCase.vocabulary).toEqual({ harness: 'desk agent' });
  });
});

describe('tab derivation', () => {
  it('adds six domain tabs after the core six, in declared order', () => {
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
    ]);
    expect(tabs.map((t) => t.label).slice(6)).toEqual([
      'Overview',
      'Runs',
      'Live',
      'Trades',
      'Equity',
      'Signals',
    ]);
  });

  it('marks the core tabs core and the domain tabs usecase', () => {
    const tabs = viewTabs(CORE_VIEWS, 'victoria');
    expect(tabs.slice(0, 6).every((t) => t.source === 'core')).toBe(true);
    expect(tabs.slice(6).every((t) => t.source === 'usecase')).toBe(true);
  });

  it('shadows no core tab — every view id is namespaced', () => {
    const coreIds = new Set(CORE_VIEWS.map((v) => v.id));
    for (const view of victoriaUseCase.views) {
      expect(coreIds.has(view.id)).toBe(false);
      expect(view.id.startsWith('victoria-')).toBe(true);
    }
  });

  it('falls back to Console when a victoria tab is open on a core-only objective', () => {
    const coreTabs = viewTabs(CORE_VIEWS, null);
    expect(resolveViewId(coreTabs, 'victoria-equity')).toBe('console');
    expect(resolveViewId(viewTabs(CORE_VIEWS, 'victoria'), 'victoria-equity')).toBe(
      'victoria-equity',
    );
  });
});

// The zero-requests guard lives in `./manifest-cost.test.ts`, not here: this
// file statically imports the manifest, so a dynamic re-import inside a test
// would return the cached module and the guard could never fail.

// ── View-level pure logic ────────────────────────────────────────────────────

const row = (version: string, pnl = 0): VersionInfo => ({
  version,
  total_pnl: pnl,
  total_trades: 0,
  win_rate: 0,
  sharpe_ratio: 0,
});

describe('sortVersions', () => {
  it('sorts newest first by natural order, so v100 beats v9', () => {
    const sorted = sortVersions([row('v9'), row('v100'), row('v21')]);
    expect(sorted.map((r) => r.version)).toEqual(['v100', 'v21', 'v9']);
  });

  it('handles the real corpus labels, which are not all v<digits>', () => {
    const sorted = sortVersions([
      row('v100'),
      row('v101b'),
      row('v252_replay_2025-03-05'),
      row('v99'),
    ]);
    expect(sorted.map((r) => r.version)).toEqual([
      'v252_replay_2025-03-05',
      'v101b',
      'v100',
      'v99',
    ]);
  });

  it('keeps every row when the corpus repeats a label', () => {
    // Observed live: /versions answers 450 rows with 449 distinct labels —
    // two results files both declare version "v10" internally. Sorting must not
    // dedupe them, or a run silently vanishes from the ledger.
    const sorted = sortVersions([row('v10', 5), row('v11'), row('v10', -3)]);
    expect(sorted).toHaveLength(3);
    expect(sorted.filter((r) => r.version === 'v10')).toHaveLength(2);
  });
});

describe('predecessorOf', () => {
  const sorted = sortVersions([row('v98'), row('v99'), row('v100')]);

  it('returns the next-older run', () => {
    expect(predecessorOf(sorted, 'v100')).toBe('v99');
    expect(predecessorOf(sorted, 'v99')).toBe('v98');
  });

  it('returns null for the oldest run and for an unknown one', () => {
    expect(predecessorOf(sorted, 'v98')).toBeNull();
    expect(predecessorOf(sorted, 'v1')).toBeNull();
  });
});

describe('summariseByRegime', () => {
  it('totals PnL, trades and wins per regime', () => {
    const summary = summariseByRegime([
      { regime: 'normal', pnl: 10 },
      { regime: 'normal', pnl: -4 },
      { regime: 'crisis', pnl: -20 },
      { regime: 'normal', pnl: 6 },
    ]);
    expect(summary).toEqual([
      { regime: 'normal', trades: 3, pnl: 12, wins: 2 },
      { regime: 'crisis', trades: 1, pnl: -20, wins: 0 },
    ]);
  });

  it('buckets an unlabelled trade rather than dropping it, so the totals still sum', () => {
    const summary = summariseByRegime([{ pnl: 5 }, { regime: 'normal', pnl: 1 }]);
    expect(summary.find((s) => s.regime === 'unknown')).toEqual({
      regime: 'unknown',
      trades: 1,
      pnl: 5,
      wins: 1,
    });
    expect(summary.reduce((t, s) => t + s.pnl, 0)).toBe(6);
  });

  it('is empty for no trades', () => {
    expect(summariseByRegime([])).toEqual([]);
  });
});

describe('settleTrades', () => {
  const rejected = (error: Error): PromiseSettledResult<never> => ({
    status: 'rejected',
    reason: error,
  });
  const fulfilled = <T,>(value: T): PromiseSettledResult<T> => ({ status: 'fulfilled', value });

  it('reports the source that failed instead of calling the view empty', () => {
    // The defect: one source 500s, the other legitimately has no rows, and the
    // view drew "No trades — neither source has rows". That reads as an
    // unseeded database and sends the operator looking in the wrong place.
    const boom = new DataSourceError('Omega API: VictoriaService/GetTrades', 500, 'no such table');
    const data = settleTrades(fulfilled([]), rejected(boom));

    expect(data.details).toEqual([]);
    expect(data.rpc).toEqual([]);
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].source).toBe(TRADE_RPC_SOURCE);
    expect(data.failures[0].error).toBe(boom);
    expect((data.failures[0].error as DataSourceError).bodyExcerpt).toBe('no such table');
  });

  it('keeps the good half and still names the bad one', () => {
    const data = settleTrades(
      rejected(new Error('trade-details is missing')),
      fulfilled([{ sym: 'BTC' }]),
    );
    expect(data.rpc).toEqual([{ sym: 'BTC' }]);
    expect(data.failures.map((f) => f.source)).toEqual([TRADE_DETAILS_SOURCE]);
  });

  it('reports no failure when both sources answer, however empty', () => {
    expect(settleTrades(fulfilled([]), fulfilled([])).failures).toEqual([]);
  });

  it('still fails the panel when both sources fail', () => {
    expect(() =>
      settleTrades(rejected(new Error('details down')), rejected(new Error('rpc down'))),
    ).toThrow('details down');
  });
});

describe('maxDrawdown', () => {
  it('measures peak to trough, not first to last', () => {
    // peak 120, trough 60 → -0.5, even though the series ends higher than it started.
    expect(maxDrawdown([100, 120, 60, 110])).toBeCloseTo(-0.5, 10);
  });

  it('is zero for a monotonically rising curve', () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });

  it('ignores non-finite points', () => {
    expect(maxDrawdown([100, NaN, 50])).toBeCloseTo(-0.5, 10);
  });
});

describe('formatters', () => {
  it('renders money grouped and signed where sign is the point', () => {
    expect(usd(1240.5)).toBe('$1,240.50');
    expect(usd(-225.89)).toBe('-$225.89');
    expect(signedUsd(36.8)).toBe('+$36.80');
    expect(signedUsd(-225.89)).toBe('-$225.89');
    expect(signedUsd(0)).toBe('$0.00');
  });

  it('renders an absent number as an em dash, never as zero', () => {
    // The omega API omits zero-valued fields, so "absent" arrives as undefined
    // and must not be reported as a real $0.00 / 0.0% / 0.00.
    expect(usd(undefined)).toBe('—');
    expect(signedUsd(null)).toBe('—');
    expect(pct(undefined)).toBe('—');
    expect(ratio(NaN)).toBe('—');
  });

  it('does not clamp percentages, unlike the core progress formatter', () => {
    expect(pct(0.4032)).toBe('40.3%');
    expect(pct(1.85)).toBe('185.0%');
    expect(pct(-0.21)).toBe('-21.0%');
    expect(signedPct(0.1477)).toBe('+14.8%');
  });

  it('colours PnL, leaving flat and absent neutral', () => {
    expect(pnlClass(12)).toBe('text-ok');
    expect(pnlClass(-12)).toBe('text-danger');
    expect(pnlClass(0)).toBe('text-ink3');
    expect(pnlClass(undefined)).toBe('text-ink3');
  });

  it('maps the regime labels the data actually uses', () => {
    // crisis/high_vol/normal — NOT bull/bear/chop.
    expect(regimeColor('crisis')).toBe('#e5675b');
    expect(regimeColor('high_vol')).toBe('#e5c04a');
    expect(regimeColor('normal')).toBe('#4ec97a');
    // 'unknown' is what early cycles emit; it must not be guessed into a colour.
    expect(regimeColor('unknown')).toBe('#6b6b74');
    expect(regimeColor('bull')).toBe('#6b6b74');
  });
});
