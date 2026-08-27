import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface ReportRef {
  file: string;
  data: unknown;
}

interface Run {
  id: string;
  taskId: string;
  title: string;
  resultStatus: string;
  provider?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  currentPhase?: string | null;
  durationMs?: number;
  createdAt: string;
}

interface Metrics {
  taskCounts: { todo: number; in_progress: number; done: number; failed: number };
  totalTasks: number;
  providerUsage: Record<string, number>;
  modelUsage: Record<string, number>;
  avgDurationMs: number;
  recentRuns: Run[];
  latestReports: { e2e?: ReportRef; benchmark?: ReportRef };
  providerRouting: Record<string, {
    calls: number;
    errors: number;
    retries: number;
    rateLimitRetries: number;
    rotations: number;
    avgDurationMs: number;
    models: string[];
  }>;
  agentHealth: {
    tokenBudgetExceededRuns: number;
    traceSpanSampleSize: number;
  };
}

export function MetricsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = (await api.getMetrics()) as Metrics;
      setMetrics(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      clearInterval(id);
    };
  }, []);

  if (error) {
    return <div className="p-4 text-xs text-red-600">{error}</div>;
  }
  if (!metrics) {
    return <div className="p-4 text-xs text-gray-400">Loading metrics…</div>;
  }

  const { taskCounts, totalTasks, providerUsage, providerRouting, agentHealth, avgDurationMs, recentRuns, latestReports } = metrics;

  return (
    <div className="p-4 space-y-6 text-sm">
      <div>
        <h3 className="font-semibold mb-2">Tasks</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-gray-50 p-2 rounded">Total: <span className="font-medium">{totalTasks}</span></div>
          <div className="bg-gray-50 p-2 rounded">Avg run: <span className="font-medium">{avgDurationMs ? `${String(avgDurationMs)}ms` : '-'}</span></div>
          <div className="bg-green-50 text-green-700 p-2 rounded">Done: {taskCounts.done}</div>
          <div className="bg-red-50 text-red-700 p-2 rounded">Failed: {taskCounts.failed}</div>
          <div className="bg-yellow-50 text-yellow-700 p-2 rounded">In progress: {taskCounts.in_progress}</div>
          <div className="bg-gray-50 p-2 rounded">Todo: {taskCounts.todo}</div>
        </div>
      </div>

      {Object.keys(providerUsage).length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Provider / Model usage</h3>
          <div className="space-y-1 text-xs">
            {Object.entries(providerUsage).map(([key, count]) => (
              <div key={key} className="flex justify-between bg-gray-50 p-2 rounded">
                <span className="truncate" title={key}>{key}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(providerRouting).length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Provider routing telemetry</h3>
          <div className="space-y-2 text-xs">
            {Object.entries(providerRouting).map(([provider, stats]) => (
              <div key={provider} className="bg-gray-50 p-2 rounded">
                <div className="font-medium truncate" title={stats.models.join(', ')}>{provider}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-gray-500 mt-1">
                  <span>Calls: {stats.calls}</span>
                  <span>Errors: {stats.errors}</span>
                  <span>Retries: {stats.retries}</span>
                  <span>429 retries: {stats.rateLimitRetries}</span>
                  <span>Rotations: {stats.rotations}</span>
                  <span>Avg: {stats.avgDurationMs}ms</span>
                </div>
                <div className="text-gray-400 truncate mt-1" title={stats.models.join(', ')}>
                  Models: {stats.models.join(', ') || '-'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-2">Run health</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-gray-50 p-2 rounded">Budget overruns: <span className="font-medium">{agentHealth.tokenBudgetExceededRuns}</span></div>
          <div className="bg-gray-50 p-2 rounded">Trace sample: <span className="font-medium">{agentHealth.traceSpanSampleSize}</span></div>
        </div>
      </div>

      {recentRuns.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Recent agent runs</h3>
          <div className="space-y-2 text-xs">
            {recentRuns.map((run) => (
              <div key={run.id} className="bg-gray-50 p-2 rounded">
                <div className="font-medium truncate" title={run.title}>{run.title}</div>
                {(run.provider || run.model || run.currentPhase) && (
                  <div className="text-gray-400 truncate mt-1" title={run.model ?? undefined}>
                    {run.provider ?? 'unknown'}{run.model ? ` / ${run.model}` : ''}{run.currentPhase ? ` · ${run.currentPhase}` : ''}
                  </div>
                )}
                <div className="flex justify-between text-gray-500 mt-1">
                  <span className={`capitalize ${run.resultStatus === 'done' ? 'text-green-600' : run.resultStatus === 'failed' ? 'text-red-600' : 'text-yellow-600'}`}>
                    {run.resultStatus}
                  </span>
                  <span>{run.durationMs !== undefined ? `${String(run.durationMs)}ms` : '-'}{run.totalTokens ? ` · ${String(run.totalTokens)} tok` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-2">Latest reports</h3>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between bg-gray-50 p-2 rounded">
            <span>E2E</span>
            <span className={latestReports.e2e ? 'text-green-600' : 'text-gray-400'}>
              {latestReports.e2e ? latestReports.e2e.file : 'none'}
            </span>
          </div>
          <div className="flex justify-between bg-gray-50 p-2 rounded">
            <span>Benchmark</span>
            <span className={latestReports.benchmark ? 'text-green-600' : 'text-gray-400'}>
              {latestReports.benchmark ? latestReports.benchmark.file : 'none'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
