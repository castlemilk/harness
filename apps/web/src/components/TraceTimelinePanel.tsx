import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

const phaseIcon: Record<string, string> = {
  'route.start': '🧭',
  'route.candidates': '📋',
  'route.selected': '✅',
  'route.fallback': '🔄',
  'rate_limit.backpressure': '⏳',
  'circuit.open_skip': '⚡',
  'llm.request': '📤',
  'llm.response': '📥',
  'llm.error': '❌',
  'timeout.abort': '⏰',
  'task.complete': '🏁',
};

const outcomeColor: Record<string, string> = {
  success: '#22c55e',
  error: '#ef4444',
  timeout: '#f59e0b',
  rate_limited: '#f59e0b',
  auth_error: '#ef4444',
};

type Trace = Awaited<ReturnType<typeof api.getTraces>>[number];

export default function TraceTimelinePanel() {
  const [traces, setTraces] = useState<Trace[]>([]);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTraces(30).then(setTraces).catch((err: unknown) => { setError(err instanceof Error ? err.message : 'Failed to load traces'); });
  }, []);

  if (error) return <div className="p-6 text-sm text-red-500">{error}</div>;
  if (traces.length === 0) return <div className="p-6 text-sm text-gray-400">No traces recorded yet</div>;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="bg-white border rounded p-4">
        <h2 className="text-base font-semibold">Trace Timeline</h2>
        <p className="text-xs text-gray-500">Last {traces.length} task executions</p>
      </div>

      {traces.map((trace) => {
        const color = outcomeColor[trace.outcome ?? ''] ?? '#9ca3af';
        return (
          <div key={trace.traceId} className="bg-white border rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-400">{trace.traceId}</span>
                <span className="text-xs text-gray-600">{trace.taskId.slice(0, 8)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-gray-400">
                  {trace.totalMs != null ? `${(trace.totalMs / 1000).toFixed(1)}s` : 'pending'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: `${color}20`, color }}>
                  {trace.outcome ?? '?'}
                </span>
              </div>
            </div>
            <div className="relative pl-5">
              <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-gray-200" />
              {trace.events.map((ev, i) => {
                const rel = ev.ts - trace.startedAt;
                const icon = phaseIcon[ev.phase] ?? '•';
                const isLlm = ev.phase.startsWith('llm.');
                return (
                  <div key={i} className="flex items-start gap-2 text-xs py-0.5">
                    <span className="relative z-10 flex-shrink-0 -ml-5">{icon}</span>
                    <span className="tabular-nums flex-shrink-0 text-gray-400" style={{ width: 50 }}>
                      +{(rel / 1000).toFixed(1)}s
                    </span>
                    <span className={`truncate ${isLlm ? 'text-gray-900' : 'text-gray-500'}`}>
                      {ev.phase}
                      {ev.data ? ` ${JSON.stringify(ev.data).slice(0, 100)}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
