import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

export default function ProviderComparePanel() {
  const [providers, setProviders] = useState<Awaited<ReturnType<typeof api.getProviderCompare>>>([]);
  const [traceMap, setTraceMap] = useState<Record<string, { count: number; avgMs: number; errorRate: number }>>({});

  useEffect(() => {
    Promise.all([api.getProviderCompare(), api.getTraceStats()])
      .then(([p, t]) => { setProviders(p); setTraceMap(t.byProvider); })
      .catch(() => {});
  }, []);

  if (providers.length === 0) return <div className="p-6 text-sm text-gray-400">No provider data yet</div>;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="bg-white border rounded p-4">
        <h2 className="text-base font-semibold">Provider Comparison</h2>
        <p className="text-xs text-gray-500">Last 7 days · sorted by pass rate</p>
      </div>

      {providers.map((p) => {
        const traceInfo = traceMap[p.provider];
        const errRate = traceInfo ? Math.round(traceInfo.errorRate * 100) : 0;
        const passColor = p.passRate >= 0.8 ? '#22c55e' : p.passRate >= 0.5 ? '#f59e0b' : '#ef4444';
        return (
          <div key={`${p.provider}/${p.model}`} className="bg-white border rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{p.provider}</span>
                <span className="text-xs text-gray-400">{p.model}</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: `${passColor}20`, color: passColor }}>
                {Math.round(p.passRate * 100)}%
              </span>
            </div>
            <div className="grid grid-cols-4 gap-4 text-xs">
              <div>
                <div className="tabular-nums font-medium">{p.total}</div>
                <div className="text-gray-400">tasks</div>
              </div>
              <div>
                <div className="tabular-nums font-medium">{Math.round(p.avgDurationMs / 1000)}s</div>
                <div className="text-gray-400">avg time</div>
              </div>
              <div>
                <div className="tabular-nums font-medium">{errRate}%</div>
                <div className="text-gray-400">error rate</div>
              </div>
              <div>
                <div className="tabular-nums font-medium">{traceInfo?.count ?? 0}</div>
                <div className="text-gray-400">traces</div>
              </div>
            </div>
            {Object.keys(p.byComplexity).length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-xs text-gray-500">
                {Object.entries(p.byComplexity)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([complexity, data]) => {
                    const rate = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
                    return <span key={complexity}>{complexity}: {rate}% ({data.passed}/{data.total})</span>;
                  })}
              </div>
            )}
            {p.topErrors.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                {p.topErrors.map((e, i) => (
                  <div key={i} className="text-xs truncate text-red-600">×{e.count} {e.error.slice(0, 80)}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
