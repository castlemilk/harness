import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface StrategyScore {
  domain: string;
  complexity: string;
  wins: number;
  total: number;
  passRate: number;
  avgScore: number;
}

const complexityColors: Record<string, string> = {
  simple: 'text-emerald-400',
  medium: 'text-amber-400',
  complex: 'text-rose-400',
};

const complexityBg: Record<string, string> = {
  simple: 'bg-emerald-500/10 border-emerald-500/20',
  medium: 'bg-amber-500/10 border-amber-500/20',
  complex: 'bg-rose-500/10 border-rose-500/20',
};

export default function StrategyLearningPanel() {
  const [scores, setScores] = useState<StrategyScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStrategyLearning().then(setScores).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-neutral-500 text-xs p-4">Loading strategy data...</div>;
  if (scores.length === 0) return <div className="text-neutral-500 text-xs p-4">No strategy data yet. Run some tasks to start learning.</div>;

  // Group by domain
  const byDomain = new Map<string, StrategyScore[]>();
  for (const s of scores) {
    const list = byDomain.get(s.domain) ?? [];
    list.push(s);
    byDomain.set(s.domain, list);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-neutral-300">Strategy Learning</h3>
        <span className="text-[10px] text-neutral-500">{scores.length} domain:complexity combos tracked</span>
      </div>

      {[...byDomain.entries()].map(([domain, entries]) => (
        <div key={domain} className="space-y-1.5">
          <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">{domain}</div>
          {entries.map((e) => (
            <div
              key={`${e.domain}:${e.complexity}`}
              className={`flex items-center gap-3 px-3 py-2 rounded border ${complexityBg[e.complexity] ?? 'bg-neutral-500/10 border-neutral-500/20'}`}
            >
              <span className={`text-[11px] font-mono w-16 ${complexityColors[e.complexity] ?? 'text-neutral-400'}`}>
                {e.complexity}
              </span>
              <div className="flex-1">
                <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.round(e.passRate * 100)}%` }}
                  />
                </div>
              </div>
              <span className="text-[11px] text-neutral-300 w-12 text-right">
                {Math.round(e.passRate * 100)}%
              </span>
              <span className="text-[10px] text-neutral-500 w-16 text-right">
                {e.wins}/{e.total}
              </span>
              <span className={`text-[10px] w-10 text-right ${e.avgScore > 0.3 ? 'text-emerald-400' : e.avgScore < -0.1 ? 'text-amber-400' : 'text-neutral-500'}`}>
                {e.avgScore > 0 ? '+' : ''}{e.avgScore.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
