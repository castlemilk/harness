/**
 * Benchmarks — what the optimise loop eats.
 *
 * The server keeps benchmark reports as JSON files (`benchmark-*.json`), newest
 * first over `/benchmarks/reports`. This view shows the newest report's pass
 * rate and per-task outcomes — the number the self-improvement loop is trying
 * to move — plus the recent file list for context. The loading logic lives in
 * `client.ts` (`loadBenchSummary`) so it is testable without a DOM.
 */
import { useEffect, useState } from 'react';
import type { UseCaseViewProps } from '@omega-harness/usecase-kit';
import { api, loadBenchSummary } from '../client.js';

export function BenchReportsView({ state }: UseCaseViewProps) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof loadBenchSummary>>>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBenchSummary(api)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-canvas p-4 text-ink">
      <header className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Benchmark reports</h2>
        <span className="text-[10.5px] text-muted">
          {state.objective.name} · {api.config.label}
        </span>
      </header>

      {error !== null ? (
        <p className="text-[11.5px] text-danger">{error}</p>
      ) : summary === null ? (
        <p className="text-[11.5px] text-faint">loading…</p>
      ) : summary.file === null ? (
        <p className="max-w-[52ch] text-[11.5px] leading-relaxed text-muted">
          No benchmark reports yet. <span className="font-mono">harness bench run</span> writes
          them under <span className="font-mono">.omega/reports/</span>, and each one stamps the
          prompt version it measured.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-[28px] font-semibold leading-none" style={{ color: 'var(--uc-accent)' }}>
              {summary.passRate === null ? '—' : `${String(summary.passRate)}%`}
            </span>
            <span className="text-[11px] text-muted">pass rate · {summary.file}</span>
          </div>

          {summary.failures.length > 0 ? (
            <div>
              <h3 className="mb-1 text-[10px] uppercase tracking-wide text-faint">
                Failed tasks ({String(summary.failures.length)})
              </h3>
              <ul className="flex flex-col gap-0.5">
                {summary.failures.slice(0, 8).map((f, i) => (
                  <li
                    key={`${f.name}-${String(i)}`}
                    className="truncate font-mono text-[10.5px] text-danger"
                    title={f.message ?? undefined}
                  >
                    {f.name}
                    {f.message !== null ? ` — ${f.message}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="mb-1 text-[10px] uppercase tracking-wide text-faint">Recent reports</h3>
            <ul className="flex flex-col gap-0.5">
              {summary.recent.slice(0, 8).map((file) => (
                <li
                  key={file}
                  className={`font-mono text-[10.5px] ${summary.file === file ? 'text-accent' : 'text-muted'}`}
                >
                  {file}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
