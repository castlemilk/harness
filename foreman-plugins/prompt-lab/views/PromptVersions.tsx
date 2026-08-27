/**
 * Prompts — the PromptVersion ledger.
 *
 * One row per distinct prompt hash the harness has ever run under, newest
 * first, with the benchmark score recorded against it (null until a benchmark
 * has stamped it). This is the table that answers "did the last optimise task
 * make things better": two hashes, two scores, one look.
 */
import { useEffect, useState } from 'react';
import type { UseCaseViewProps } from '@omega-harness/usecase-kit';
import { ago } from '@omega-harness/usecase-kit/ui';
import { api, loadPromptVersions } from '../client.js';

export function PromptVersionsView({ state }: UseCaseViewProps) {
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof loadPromptVersions>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPromptVersions(api)
      .then((rows) => {
        if (!cancelled) setVersions(rows);
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
        <h2 className="text-[13px] font-semibold">Prompt versions</h2>
        <span className="text-[10.5px] text-muted">
          {state.objective.name} · {api.config.label}
        </span>
      </header>

      {error !== null ? (
        <p className="text-[11.5px] text-danger">{error}</p>
      ) : versions === null ? (
        <p className="text-[11.5px] text-faint">loading…</p>
      ) : versions.length === 0 ? (
        // Honest empty state: no rows means no agent run has happened yet,
        // not that the ledger is broken.
        <p className="max-w-[52ch] text-[11.5px] leading-relaxed text-muted">
          No prompt versions yet. Every agent run records the hash of the prompts it ran
          under; run a task and this ledger starts.
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-faint">
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Hash</th>
              <th className="py-1.5 pr-3 font-medium">Bench score</th>
              <th className="py-1.5 font-medium">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className="border-b border-line/60">
                <td className="py-1.5 pr-3 font-mono text-[10.5px]">{v.name}</td>
                <td className="py-1.5 pr-3 font-mono text-[10.5px] text-accent">{v.hash}</td>
                <td className="py-1.5 pr-3">
                  {v.benchmarkScore === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <span className="font-mono">{v.benchmarkScore.toFixed(3)}</span>
                  )}
                </td>
                <td className="py-1.5 text-muted" title={v.createdAt}>
                  {ago(v.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
