import { useEffect, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import {
  foremanApi,
  type BenchmarkRunDetail,
  type BenchmarkRunSummary,
  type BenchmarkSummary,
  type BenchmarkTaskResult,
  type ProviderHealth,
} from '../data/api.js';
import { money, percent } from '../ui/format.js';
import { Panel, Pill, SectionLabel } from '../ui/primitives.js';

const DEEPSWE_NEAR_MISS_F2P_COMPLETION = 0.5;

export function isDeepSweSuite(suite: string): boolean {
  return suite === 'deepswe' || suite === 'deep-swe';
}

function numberMetric(result: BenchmarkTaskResult, key: string): number | undefined {
  const value = result.evaluation?.metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function metricPair(result: BenchmarkTaskResult, passedKey: string, totalKey: string): string {
  const passed = numberMetric(result, passedKey);
  const total = numberMetric(result, totalKey);
  return passed !== undefined && total !== undefined ? `${String(passed)}/${String(total)}` : '—';
}

function flagMetric(result: BenchmarkTaskResult, key: string): boolean {
  const value = result.evaluation?.metrics?.[key];
  return value === 1 || value === '1';
}

function hasMetric(result: BenchmarkTaskResult, key: string): boolean {
  return result.evaluation?.metrics?.[key] !== undefined;
}

function partialReward(result: BenchmarkTaskResult): number | undefined {
  const metric = numberMetric(result, 'partial');
  if (metric !== undefined) return metric;
  const score = result.evaluation?.score;
  return typeof score === 'number' && Number.isFinite(score) ? score : undefined;
}

export function deepSweTaskState(result: BenchmarkTaskResult): 'passed' | 'near-miss' | 'failed' {
  if (result.evaluation?.passed ?? result.passed) return 'passed';
  const f2pPassed = numberMetric(result, 'f2p_passed');
  const f2pTotal = numberMetric(result, 'f2p_total');
  return f2pPassed !== undefined
    && f2pTotal !== undefined
    && f2pTotal > 0
    && f2pPassed / f2pTotal >= DEEPSWE_NEAR_MISS_F2P_COMPLETION
    ? 'near-miss'
    : 'failed';
}

export function DeepSweTaskResults({ results }: { results: BenchmarkTaskResult[] }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 p-2">
      {results.map((result, index) => {
        const state = deepSweTaskState(result);
        const partial = partialReward(result);
        const verifierMode = result.evaluation?.metrics?.verifier_mode;
        const rowTone = state === 'passed'
          ? 'border-ok/20 bg-ok/[.04]'
          : state === 'near-miss'
            ? 'border-warn/30 bg-warn/[.08]'
            : 'border-danger/25 bg-danger/[.04]';
        const statusColor = state === 'passed' ? '#4ec97a' : '#e5675b';

        return (
          <div
            key={`${result.harnessTaskId || result.taskName}-${String(index)}`}
            className={`min-w-0 rounded-[7px] border px-2.5 py-2 ${rowTone}`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] font-semibold text-ink">
                {result.taskName}
              </span>
              <Pill color={statusColor} className="px-2 py-0.5 text-[9px]">
                {(result.evaluation?.passed ?? result.passed) ? 'passed' : 'failed'}
              </Pill>
              {state === 'near-miss' && (
                <Pill color="#e8963c" className="px-2 py-0.5 text-[9px]">near miss</Pill>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9.5px] text-ink3">
              <span>partial {partial !== undefined ? partial.toFixed(3) : '—'}</span>
              <span>f2p {metricPair(result, 'f2p_passed', 'f2p_total')}</span>
              <span>p2p {metricPair(result, 'p2p_passed', 'p2p_total')}</span>
              <span>verifier {typeof verifierMode === 'string' ? verifierMode : '—'}</span>
            </div>
            {(hasMetric(result, 'flake_rerun')
              || hasMetric(result, 'flake_forgiven_pass')
              || hasMetric(result, 'p2p_rerun_failure_disjoint')) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {hasMetric(result, 'flake_rerun') && (
                  <Pill className="px-2 py-0.5 text-[9px]">
                    flake rerun {flagMetric(result, 'flake_rerun') ? 'yes' : 'no'}
                  </Pill>
                )}
                {flagMetric(result, 'flake_forgiven_pass') && (
                  <Pill color="#4ec97a" className="px-2 py-0.5 text-[9px]">forgiven pass</Pill>
                )}
                {flagMetric(result, 'p2p_rerun_failure_disjoint') && (
                  <Pill color="#e8963c" className="px-2 py-0.5 text-[9px]">rerun failures disjoint</Pill>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type BenchmarkDetailStatus = 'idle' | 'loading' | 'loaded' | 'error';

export function shouldLoadBenchmarkDetail(isOpen: boolean, status: BenchmarkDetailStatus): boolean {
  return isOpen && (status === 'idle' || status === 'error');
}

export type BenchmarkDetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; results: BenchmarkTaskResult[] }
  | { status: 'error'; message: string };

export interface BenchmarkDetailController {
  getSnapshot: () => BenchmarkDetailState;
  subscribe: (listener: () => void) => () => void;
  toggle: (isOpen: boolean) => Promise<void>;
}

type BenchmarkDetailLoader = (id: string) => Promise<BenchmarkRunDetail>;

export function createBenchmarkDetailController(
  runId: string,
  initialResults?: BenchmarkTaskResult[],
  load: BenchmarkDetailLoader = (id) => foremanApi.getBenchmarkDetails(id),
): BenchmarkDetailController {
  let state: BenchmarkDetailState = initialResults !== undefined
    ? { status: 'loaded', results: initialResults }
    : { status: 'idle' };
  const listeners = new Set<() => void>();

  const setState = (next: BenchmarkDetailState): void => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    toggle: async (isOpen) => {
      if (!shouldLoadBenchmarkDetail(isOpen, state.status)) return;
      setState({ status: 'loading' });
      try {
        const response = await load(runId);
        setState({
          status: 'loaded',
          results: Array.isArray(response.results) ? response.results : [],
        });
      } catch (error) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function BenchmarkRunDisclosureView({
  detail,
  onToggle,
}: {
  detail: BenchmarkDetailState;
  onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
}) {
  const summary = detail.status === 'loaded'
    ? `${String(detail.results.length)} task result${detail.results.length === 1 ? '' : 's'}`
    : detail.status === 'loading'
      ? 'loading task results…'
      : detail.status === 'error'
        ? 'retry task results'
        : 'view task results';

  return (
    <details className="mt-2" onToggle={onToggle}>
      <summary className="cursor-pointer select-none text-[9.5px] font-semibold uppercase tracking-[.06em] text-muted hover:text-ink2">
        {summary}
      </summary>
      <Panel className="mt-1.5 bg-controlAlt">
        {detail.status === 'loaded' ? (
          detail.results.length > 0
            ? <DeepSweTaskResults results={detail.results} />
            : <div className="p-2 text-[10px] text-muted">No persisted task results for this run.</div>
        ) : detail.status === 'error' ? (
          <div className="p-2 text-[10px] text-danger-tint">{detail.message}</div>
        ) : (
          <div className="p-2 text-[10px] text-muted">Loading…</div>
        )}
      </Panel>
    </details>
  );
}

export function BenchmarkRunDisclosure({ run }: { run: BenchmarkRunSummary }) {
  const legacyResults = Array.isArray(run.results) ? run.results : undefined;
  const [controller] = useState(() => createBenchmarkDetailController(run.id, legacyResults));
  const detail = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>): void => {
    void controller.toggle(event.currentTarget.open);
  };

  return <BenchmarkRunDisclosureView detail={detail} onToggle={handleToggle} />;
}

/**
 * Surface 1k — Benchmarks.
 *
 * The evidence layer for multi-model orchestration: which model actually
 * passes tasks, at what cost per pass, joined with the router's live view of
 * provider health. BenchmarkHistory had no HTTP surface at all before this —
 * pass rates lived in the CLI and the legacy panel, invisible to the fleet
 * operator choosing models.
 *
 * Read-only by design: runs are launched from the CLI (`omega bench run`) or
 * the legacy benchmark panel, both of which write the same BenchmarkHistory
 * rows this renders.
 */
export function Benchmarks() {
  const [summary, setSummary] = useState<BenchmarkSummary | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([foremanApi.getBenchmarks(), foremanApi.getProvidersHealth()])
      .then(([bench, health]) => {
        if (cancelled) return;
        setSummary(bench);
        setProviders(health);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
        Loading benchmark history…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-danger-tint">
        {error}
      </div>
    );
  }

  const models = summary?.models ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-5 py-[18px] text-ink">
      <div className="mx-auto max-w-[1040px]">
        <div className="flex items-start gap-5">
          <div>
            <h3 className="m-0 text-[16px] font-semibold">Benchmarks</h3>
            <div className="mt-1 font-mono text-[10.5px] text-muted">
              {summary ? `${String(summary.totalRuns)} recorded runs · ${String(models.length)} model rows` : ''}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <SectionLabel className="mb-2">Pass rate by model</SectionLabel>
          {models.length === 0 ? (
            <p className="m-0 text-[11.5px] leading-relaxed text-muted">
              No benchmark history yet. Runs land here from{' '}
              <span className="font-mono">omega bench run</span> (CLI) or the legacy
              benchmark panel — both write BenchmarkHistory rows per suite × model.
              Without them, model choice is running on vibes.
            </p>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-[11.5px]">
              <thead>
                <tr className="text-left font-mono text-[9.5px] uppercase tracking-[.08em] text-faint">
                  <th className="border-b border-line px-2 py-1.5 font-medium">Provider / model</th>
                  <th className="border-b border-line px-2 py-1.5 text-right font-medium">Runs</th>
                  <th className="border-b border-line px-2 py-1.5 text-right font-medium">Latest pass</th>
                  <th className="border-b border-line px-2 py-1.5 text-right font-medium">Mean pass</th>
                  <th className="border-b border-line px-2 py-1.5 text-right font-medium">$/pass</th>
                  <th className="border-b border-line px-2 py-1.5 font-medium">Suites</th>
                </tr>
              </thead>
              <tbody>
                {models.map((row) => (
                  <tr key={`${row.provider ?? '—'}/${row.model ?? '—'}`} className="hover:bg-card">
                    <td className="border-b border-hair px-2 py-1.5 font-mono text-ink">
                      {row.provider ?? '—'} / {row.model ?? '—'}
                    </td>
                    <td className="border-b border-hair px-2 py-1.5 text-right font-mono text-ink3">
                      {row.runs}
                    </td>
                    <td
                      className={`border-b border-hair px-2 py-1.5 text-right font-mono ${
                        row.latestPassRate >= 0.5 ? 'text-ok' : 'text-warn'
                      }`}
                    >
                      {percent(row.latestPassRate)}
                    </td>
                    <td className="border-b border-hair px-2 py-1.5 text-right font-mono text-ink3">
                      {percent(row.meanPassRate)}
                    </td>
                    <td className="border-b border-hair px-2 py-1.5 text-right font-mono text-ink3">
                      {/* Null cost means NO run reported spend — unknown, not free. */}
                      {row.costPerPass != null ? money(row.costPerPass) : 'unreported'}
                    </td>
                    <td className="border-b border-hair px-2 py-1.5 font-mono text-[10px] text-muted">
                      {row.suites.join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-6">
          <SectionLabel className="mb-2">Provider health (router live state)</SectionLabel>
          {providers.length === 0 ? (
            <p className="m-0 text-[11.5px] text-muted">No enabled providers.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {providers.map((p) => (
                <div key={p.name} className="rounded-[7px] border border-hair bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11.5px] font-semibold text-ink">{p.name}</span>
                    <span className="font-mono text-[9.5px] text-muted">{p.kind} · {p.defaultModel}</span>
                    <div className="flex-1" />
                    {p.health?.circuitState === 'open' ? (
                      <span className="font-mono text-[9.5px] font-medium text-danger">circuit open</span>
                    ) : p.health?.circuitState === 'half-open' ? (
                      <span className="font-mono text-[9.5px] font-medium text-warn">half-open</span>
                    ) : null}
                    {!p.credentialed && (
                      <span className="font-mono text-[9.5px] text-warn">no key</span>
                    )}
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-ink3">
                    {p.health
                      ? `score ${p.health.score.toFixed(2)} · error ${percent(p.health.errorRate)} · p50 ${String(Math.round(p.health.latencyP50))}ms · ${String(p.health.recentCalls)} recent calls`
                      : 'no health samples — the router has never routed to this provider'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {summary && summary.recent.length > 0 && (
          <div className="mt-6">
            <SectionLabel className="mb-2">Recent runs</SectionLabel>
            <div className="flex flex-col gap-px overflow-hidden rounded-[7px] border border-hair">
              {summary.recent.slice(0, 15).map((run, i) => (
                <div
                  key={run.id}
                  className={`px-3 py-2 font-mono text-[10.5px] ${
                    i % 2 === 0 ? 'bg-card' : 'bg-cardAlt'
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="w-28 flex-none text-ink2">{run.suite}</span>
                    <span className="min-w-[10rem] flex-1 truncate text-ink3">
                      {run.provider ?? '—'} / {run.model ?? '—'}
                    </span>
                    <span className={run.passRate >= 0.5 ? 'text-ok' : 'text-warn'}>
                      {run.passed}/{run.totalTasks} · {percent(run.passRate)}
                    </span>
                    <span className="text-muted">
                      {run.totalCostUsd != null ? money(run.totalCostUsd) : 'cost unreported'}
                    </span>
                    <span className="text-faint">{new Date(run.createdAt).toLocaleDateString()}</span>
                  </div>
                  {isDeepSweSuite(run.suite) && <BenchmarkRunDisclosure run={run} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
