import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

const sevColor: Record<string, string> = {
  auth: '#ef4444',
  rate_limit: '#f59e0b',
  timeout: '#f59e0b',
  credential: '#ef4444',
  server_error: '#ef4444',
  model_error: '#6366f1',
  unknown: '#9ca3af',
};

export default function ErrorAnalysisPanel() {
  const [errors, setErrors] = useState<Awaited<ReturnType<typeof api.getErrors>> | null>(null);
  const [traceStats, setTraceStats] = useState<Awaited<ReturnType<typeof api.getTraceStats>> | null>(null);

  useEffect(() => {
    Promise.all([api.getErrors(100), api.getTraceStats()])
      .then(([e, t]) => { setErrors(e); setTraceStats(t); })
      .catch(() => {});
  }, []);

  if (!errors || !traceStats) return <div className="p-6 text-sm text-gray-400">Loading...</div>;

  const categories = Object.entries(errors.byCategory).filter(([, v]) => v.count > 0).sort((a, b) => b[1].count - a[1].count);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="bg-white border rounded p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Error Analysis</h2>
            <p className="text-xs text-gray-500">{errors.total} errors in last 7 days · avg trace {traceStats.avgMs}ms</p>
          </div>
          <div className="flex gap-2">
            {Object.entries(traceStats.byOutcome).map(([k, v]) => (
              <span key={k} className={`text-xs px-2 py-0.5 rounded ${k === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {k}: {v}
              </span>
            ))}
          </div>
        </div>
      </div>

      {categories.length > 0 ? (
        <div className="bg-white border rounded p-4">
          <h3 className="text-xs font-semibold mb-3">By Category</h3>
          <div className="space-y-2">
            {categories.map(([cat, data]) => (
              <div key={cat} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: sevColor[cat] ?? '#9ca3af' }} />
                  <span className="font-medium">{cat}</span>
                </span>
                <span className="tabular-nums">{data.count} · {Object.keys(data.providers).join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border rounded p-4 text-sm text-gray-400">No errors recorded yet</div>
      )}

      {errors.topErrors.length > 0 && (
        <div className="bg-white border rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Top Error Patterns</h3>
          <div className="space-y-2">
            {errors.topErrors.slice(0, 5).map((e, i) => (
              <div key={i} className="text-xs p-2 rounded bg-gray-50">
                <div className="flex justify-between mb-1">
                  <span className="font-mono truncate text-red-600">{e.pattern}</span>
                  <span className="tabular-nums font-medium">×{e.count}</span>
                </div>
                <div className="truncate text-gray-500">{e.sample.slice(0, 120)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(errors.dailyTrend).length > 0 && (
        <div className="bg-white border rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Daily Trend</h3>
          <div className="space-y-1">
            {Object.entries(errors.dailyTrend)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([day, cats]) => {
                const total = Object.values(cats).reduce((s, v) => s + v, 0);
                return (
                  <div key={day} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{day}</span>
                    <span className="tabular-nums">{total} errors</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
