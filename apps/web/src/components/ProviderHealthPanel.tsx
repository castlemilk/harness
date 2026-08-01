import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface ProviderHealthEntry {
  provider: string;
  latencyP50: number;
  latencyP95: number;
  errorRate: number;
  rateLimitRate: number;
  recentCalls: number;
  score: number;
}

function scoreColor(score: number): string {
  if (score >= 8) return 'text-emerald-400';
  if (score >= 5) return 'text-amber-400';
  return 'text-rose-400';
}

function scoreBg(score: number): string {
  if (score >= 8) return 'bg-emerald-500/10 border-emerald-500/20';
  if (score >= 5) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-rose-500/10 border-rose-500/20';
}

function formatLatency(ms: number): string {
  if (ms === 0) return '—';
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ProviderHealthPanel() {
  const [entries, setEntries] = useState<ProviderHealthEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getProviderHealth().then(setEntries).catch(console.error).finally(() => { setLoading(false); });
  }, []);

  if (loading) return <div className="text-neutral-500 text-xs p-4">Loading provider health...</div>;
  if (entries.length === 0) return <div className="text-neutral-500 text-xs p-4">No provider health data yet. Run some tasks first.</div>;

  // Sort by score descending
  const sorted = [...entries].sort((a, b) => b.score - a.score);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-neutral-300">Provider Health</h3>
        <span className="text-[10px] text-neutral-500">{entries.length} providers tracked</span>
      </div>

      {sorted.map((e) => (
        <div
          key={e.provider}
          className={`px-3 py-2.5 rounded border ${scoreBg(e.score)}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono text-neutral-200">{e.provider}</span>
            <span className={`text-[11px] font-mono font-medium ${scoreColor(e.score)}`}>
              {e.score.toFixed(1)}/10
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <div>
              <span className="text-neutral-500">P50</span>
              <span className="ml-1 text-neutral-300">{formatLatency(e.latencyP50)}</span>
            </div>
            <div>
              <span className="text-neutral-500">P95</span>
              <span className="ml-1 text-neutral-300">{formatLatency(e.latencyP95)}</span>
            </div>
            <div>
              <span className="text-neutral-500">Err</span>
              <span className={`ml-1 ${e.errorRate > 0.2 ? 'text-rose-400' : 'text-neutral-300'}`}>
                {Math.round(e.errorRate * 100)}%
              </span>
            </div>
            <div>
              <span className="text-neutral-500">Calls</span>
              <span className="ml-1 text-neutral-300">{e.recentCalls}</span>
            </div>
          </div>

          {e.rateLimitRate > 0 && (
            <div className="mt-1.5 text-[10px] text-amber-400">
              Rate limited: {Math.round(e.rateLimitRate * 100)}% of recent calls
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
