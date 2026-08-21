import { useEffect, useState } from 'react';
import {
  foremanApi,
  type BenchmarkSummary,
  type ProviderHealth,
} from '../data/api.js';
import { money, percent } from '../ui/format.js';
import { SectionLabel } from '../ui/primitives.js';

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
                  className={`flex items-baseline gap-3 px-3 py-2 font-mono text-[10.5px] ${
                    i % 2 === 0 ? 'bg-card' : 'bg-cardAlt'
                  }`}
                >
                  <span className="w-28 flex-none text-ink2">{run.suite}</span>
                  <span className="min-w-0 flex-1 truncate text-ink3">
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
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
