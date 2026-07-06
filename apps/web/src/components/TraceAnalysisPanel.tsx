import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface ToolSummary {
  tool: string;
  total: number;
  success: number;
  failure: number;
  successRate: number;
  sampleErrors: string[];
}

interface TraceAnalysis {
  taskId: string;
  agentRunId?: string;
  totalSpans: number;
  totalDurationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  toolSummary: ToolSummary[];
  topErrors: { tool?: string; message: string; time: string }[];
  phaseDurations: Record<string, number>;
}

interface Props {
  taskId: string;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusColor(rate: number): string {
  if (rate >= 0.9) return 'text-green-600';
  if (rate >= 0.5) return 'text-yellow-600';
  return 'text-red-600';
}

export function TraceAnalysisPanel({ taskId }: Props) {
  const [data, setData] = useState<TraceAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = (await api.getTraceAnalysis(taskId)) as TraceAnalysis;
      setData(res);
    } catch {
      setData(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [taskId]);

  if (loading) return <div className="text-xs text-gray-400">Loading trace analysis…</div>;
  if (!data) return <div className="text-xs text-gray-400">No trace analysis available.</div>;

  const phaseEntries = Object.entries(data.phaseDurations).sort((a, b) => b[1] - a[1]);
  const maxPhase = phaseEntries[0]?.[1] ?? 1;

  return (
    <div className="max-h-96 overflow-auto space-y-4 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 p-2 rounded">
          <div className="text-gray-500">Spans</div>
          <div className="font-semibold">{data.totalSpans}</div>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <div className="text-gray-500">Duration</div>
          <div className="font-semibold">{formatMs(data.totalDurationMs)}</div>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <div className="text-gray-500">Tokens</div>
          <div className="font-semibold">{data.totalTokens ?? 'n/a'}</div>
        </div>
      </div>

      {phaseEntries.length > 0 && (
        <div>
          <div className="font-medium mb-1">Phase durations</div>
          <div className="space-y-1">
            {phaseEntries.map(([name, ms]) => {
              const width = maxPhase > 0 ? `${String((ms / maxPhase) * 100)}%` : '0%';
              return (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-32 truncate text-gray-600">{name}</span>
                  <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                    <div className="bg-blue-500 h-full" style={{ width }} />
                  </div>
                  <span className="w-16 text-right text-gray-500">{formatMs(ms)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.toolSummary.length > 0 && (
        <div>
          <div className="font-medium mb-1">Tool summary</div>
          <div className="space-y-1">
            {data.toolSummary.map((t) => (
              <div key={t.tool} className="bg-gray-50 p-2 rounded">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.tool}</span>
                  <span className={statusColor(t.successRate)}>
                    {t.success}/{t.total} ({t.successRate})
                  </span>
                </div>
                {t.sampleErrors.length > 0 && (
                  <div className="mt-1 text-[10px] text-red-600 space-y-0.5">
                    {t.sampleErrors.slice(0, 2).map((err, i) => (
                      <div key={i} className="truncate" title={err}>
                        {err}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.topErrors.length > 0 && (
        <div>
          <div className="font-medium mb-1">Top errors</div>
          <div className="space-y-1">
            {data.topErrors.slice(0, 5).map((err, i) => (
              <div key={i} className="bg-red-50 text-red-700 p-2 rounded text-[10px]">
                {err.tool && <span className="font-medium">[{err.tool}] </span>}
                {err.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
