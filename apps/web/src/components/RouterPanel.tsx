import { useState } from 'react';
import { api } from '../lib/api.js';

interface IntelligentDecision {
  primary: { provider: string; model: string; score: number; breakdown: Record<string, number> };
  fallbacks: Array<{ provider: string; model: string; score: number; breakdown: Record<string, number> }>;
  classification: { complexity: string; domain: string; requiredCapabilities: string[]; estimatedTokens: number };
  strategy: string;
  reasoning: string;
}

interface HealthInfo {
  latencyP50: number;
  latencyP95: number;
  errorRate: number;
  rateLimitRate: number;
  score: number;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 10) * 100);
  const color = value >= 7 ? 'bg-green-500' : value >= 4 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-16 text-gray-500 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-200 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right font-mono">{value.toFixed(1)}</span>
    </div>
  );
}

function CandidateCard({
  candidate,
  label,
  isPrimary,
}: {
  candidate: { provider: string; model: string; score: number; breakdown: Record<string, number> };
  label: string;
  isPrimary: boolean;
}) {
  return (
    <div className={`p-2 rounded text-xs ${isPrimary ? 'bg-purple-50 border border-purple-200' : 'bg-gray-50'}`}>
      <div className="flex justify-between items-center mb-1">
        <span className={`font-medium ${isPrimary ? 'text-purple-800' : 'text-gray-700'}`}>{label}</span>
        <span className="font-mono text-[10px]">{candidate.score.toFixed(1)}</span>
      </div>
      <div className="font-medium">{candidate.provider} / {candidate.model}</div>
      <div className="mt-1.5 space-y-0.5">
        <ScoreBar label="capability" value={candidate.breakdown.capability ?? 0} />
        <ScoreBar label="performance" value={candidate.breakdown.performance ?? 0} />
        <ScoreBar label="cost" value={candidate.breakdown.cost ?? 0} />
        <ScoreBar label="health" value={candidate.breakdown.health ?? 0} />
        <ScoreBar label="budget" value={candidate.breakdown.budget ?? 0} />
        <ScoreBar label="recency" value={candidate.breakdown.recency ?? 0} />
      </div>
    </div>
  );
}

export function RouterPanel() {
  const [form, setForm] = useState({
    title: '',
    description: '',
    complexity: 'simple',
    tags: '',
    strategy: 'balanced',
  });
  const [decision, setDecision] = useState<IntelligentDecision | null>(null);
  const [ranking, setRanking] = useState<Array<{ provider: string; model: string; score: number; breakdown: Record<string, number> }>>([]);
  const [health, setHealth] = useState<Record<string, HealthInfo>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setDecision(null);
    try {
      const data = await api.selectProviderIntelligent({
        title: form.title,
        description: form.description || undefined,
        complexity: form.complexity,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        strategy: form.strategy,
      });
      setDecision(data.decision);
      setRanking(data.ranking);
      setHealth(data.health);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-semibold text-sm">Intelligent Router</h3>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-2">
        <input
          className="w-full border rounded px-2 py-1 text-xs"
          placeholder="Task title"
          value={form.title}
          onChange={(e) => { setForm({ ...form, title: e.target.value }); }}
          required
        />
        <textarea
          className="w-full border rounded px-2 py-1 text-xs"
          placeholder="Task description (optional)"
          value={form.description}
          onChange={(e) => { setForm({ ...form, description: e.target.value }); }}
          rows={2}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="border rounded px-2 py-1 text-xs"
            value={form.complexity}
            onChange={(e) => { setForm({ ...form, complexity: e.target.value }); }}
          >
            <option value="simple">Simple</option>
            <option value="medium">Medium</option>
            <option value="complex">Complex</option>
          </select>
          <select
            className="border rounded px-2 py-1 text-xs"
            value={form.strategy}
            onChange={(e) => { setForm({ ...form, strategy: e.target.value }); }}
          >
            <option value="balanced">Balanced</option>
            <option value="cost-optimized">Cost-optimized</option>
            <option value="performance-optimized">Performance</option>
            <option value="consensus">Consensus</option>
            <option value="exploratory">Exploratory</option>
          </select>
        </div>
        <input
          className="w-full border rounded px-2 py-1 text-xs"
          placeholder="Tags (comma separated)"
          value={form.tags}
          onChange={(e) => { setForm({ ...form, tags: e.target.value }); }}
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Routing…' : 'Select provider'}
        </button>
      </form>

      {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      {decision && (
        <div className="space-y-3">
          {/* Classification */}
          <div className="bg-gray-50 p-2 rounded text-xs">
            <div className="font-medium text-gray-600 mb-1">Task classification</div>
            <div className="flex gap-3">
              <span>domain: <b>{decision.classification.domain}</b></span>
              <span>complexity: <b>{decision.classification.complexity}</b></span>
              <span>~{decision.classification.estimatedTokens} tokens</span>
            </div>
            {decision.classification.requiredCapabilities.length > 0 && (
              <div className="text-gray-500 mt-0.5">
                needs: {decision.classification.requiredCapabilities.join(', ')}
              </div>
            )}
          </div>

          {/* Reasoning */}
          <div className="text-[10px] text-gray-500 font-mono">{decision.reasoning}</div>

          {/* Primary */}
          <CandidateCard candidate={decision.primary} label="Primary" isPrimary />

          {/* Fallbacks */}
          {decision.fallbacks.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Fallbacks</div>
              {decision.fallbacks.map((f, i) => (
                <CandidateCard key={`${f.provider}/${f.model}`} candidate={f} label={`#${i + 2}`} isPrimary={false} />
              ))}
            </div>
          )}

          {/* Full ranking */}
          {ranking.length > 0 && (
            <details className="bg-gray-50 p-2 rounded text-xs">
              <summary className="cursor-pointer font-medium text-gray-600">Full ranking ({ranking.length} models)</summary>
              <div className="mt-2 space-y-1">
                {ranking.map((c, i) => (
                  <div key={`${c.provider}/${c.model}`} className="flex justify-between items-center">
                    <span className="text-gray-500 w-4">{i + 1}.</span>
                    <span className="flex-1 truncate">{c.provider} / {c.model}</span>
                    <span className="font-mono text-[10px]">{c.score.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Provider health */}
          {Object.keys(health).length > 0 && (
            <details className="bg-gray-50 p-2 rounded text-xs">
              <summary className="cursor-pointer font-medium text-gray-600">Provider health</summary>
              <div className="mt-2 space-y-2">
                {Object.entries(health).map(([name, h]) => (
                  <div key={name} className="flex justify-between items-center">
                    <span className="font-medium">{name}</span>
                    <div className="flex gap-3 text-gray-500">
                      <span>p50={h.latencyP50 > 0 ? `${(h.latencyP50 / 1000).toFixed(1)}s` : '—'}</span>
                      <span>err={Math.round(h.errorRate * 100)}%</span>
                      <span>health={h.score.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
