import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface TaskCost {
  taskId: string;
  title: string;
  status: string;
  complexity: string | null;
  provider: string;
  model: string;
  costUsd: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
}

interface CostSummary {
  totalCostUsd: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  costByDay: Record<string, number>;
  totalTokens: number;
  avgCostPerRun: number;
  avgTokensPerRun: number;
  runsWithCost: number;
}

interface CostBucket {
  bucket: string;
  costUsd: number;
  tokens: number;
  runs: number;
  avgDurationMs: number;
}

interface ProviderBucket {
  bucket: string;
  provider: string;
  runs: number;
  avgDurationMs: number;
  totalTokens: number;
}

interface TaskTimeseries {
  created: { bucket: string; count: number }[];
  completed: { bucket: string; count: number }[];
  failed: { bucket: string; count: number }[];
  passRate: { bucket: string; rate: number }[];
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function BarChart({ data, maxValue, color }: { data: number[]; maxValue: number; color: string }) {
  return (
    <div className="flex items-end gap-px h-16">
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 ${color} rounded-t-sm min-w-[2px]`}
          style={{ height: maxValue > 0 ? `${String((v / maxValue) * 100)}%` : '0%' }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

function TimeseriesBarChart({
  timeseries,
  getValues,
  color,
  label,
}: {
  timeseries: CostBucket[];
  getValues: (b: CostBucket) => number;
  color: string;
  label: string;
}) {
  const values = timeseries.map(getValues);
  const maxVal = Math.max(...values, 1);
  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <BarChart data={values} maxValue={maxVal} color={color} />
      <div className="flex justify-between text-[9px] text-gray-400 mt-1">
        {timeseries.length > 0 && <span>{timeseries[0].bucket.slice(5, 10)}</span>}
        {timeseries.length > 2 && <span>{timeseries[Math.floor(timeseries.length / 2)].bucket.slice(5, 10)}</span>}
        {timeseries.length > 1 && <span>{timeseries[timeseries.length - 1].bucket.slice(5, 10)}</span>}
      </div>
    </div>
  );
}

export function CostDashboard() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [costTs, setCostTs] = useState<CostBucket[]>([]);
  const [providerTs, setProviderTs] = useState<ProviderBucket[]>([]);
  const [taskTs, setTaskTs] = useState<TaskTimeseries | null>(null);
  const [taskCosts, setTaskCosts] = useState<TaskCost[]>([]);
  const [bucket, setBucket] = useState<'hour' | 'day' | 'week'>('day');
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [s, c, p, t, tc] = await Promise.all([
        api.getCostSummary(),
        api.getCostTimeseries(bucket, days),
        api.getProviderTimeseries(bucket, days),
        api.getTaskTimeseries(bucket, days),
        api.getCostsPerTask(30),
      ]);
      setSummary(s);
      setCostTs(c);
      setProviderTs(p);
      setTaskTs(t);
      setTaskCosts(tc);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, [bucket, days]);

  if (error) {
    return <div className="p-4 text-xs text-red-600">{error}</div>;
  }
  if (!summary) {
    return <div className="p-4 text-xs text-gray-400">Loading costs…</div>;
  }

  const providers = Object.entries(summary.costByProvider).sort((a, b) => b[1] - a[1]);
  const models = Object.entries(summary.costByModel).sort((a, b) => b[1] - a[1]);
  const totalCostAll = providers.reduce((s, [, v]) => s + v, 0) || 1;

  const uniqueProviders = [...new Set(providerTs.map((b) => b.provider))];

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cost Dashboard</h2>
        <div className="flex gap-2 text-xs">
          <select
            value={bucket}
            onChange={(e) => { setBucket(e.target.value as 'hour' | 'day' | 'week'); }}
            className="border rounded px-2 py-1"
          >
            <option value="hour">Hour</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
          </select>
          <select
            value={days}
            onChange={(e) => { setDays(Number(e.target.value)); }}
            className="border rounded px-2 py-1"
          >
            <option value={7}>7d</option>
            <option value={14}>14d</option>
            <option value={30}>30d</option>
            <option value={90}>90d</option>
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase">Total Cost</div>
          <div className="text-xl font-bold">{formatCost(summary.totalCostUsd)}</div>
        </div>
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase">Total Tokens</div>
          <div className="text-xl font-bold">{formatTokens(summary.totalTokens)}</div>
        </div>
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase">Avg Cost / Run</div>
          <div className="text-xl font-bold">{formatCost(summary.avgCostPerRun)}</div>
        </div>
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase">Runs w/ Cost</div>
          <div className="text-xl font-bold">{summary.runsWithCost}</div>
        </div>
      </div>

      {/* Time-series charts */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border rounded p-3">
          <TimeseriesBarChart
            timeseries={costTs}
            getValues={(b) => b.costUsd}
            color="bg-blue-500"
            label="Cost (USD)"
          />
        </div>
        <div className="bg-white border rounded p-3">
          <TimeseriesBarChart
            timeseries={costTs}
            getValues={(b) => b.tokens}
            color="bg-violet-500"
            label="Tokens"
          />
        </div>
        <div className="bg-white border rounded p-3">
          <TimeseriesBarChart
            timeseries={costTs}
            getValues={(b) => b.runs}
            color="bg-green-500"
            label="Runs"
          />
        </div>
      </div>

      {/* Provider time-series stacked view */}
      {uniqueProviders.length > 0 && (
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase mb-2">Cost by Provider Over Time</div>
          <div className="space-y-1">
            {uniqueProviders.map((prov) => {
              const provData = providerTs.filter((b) => b.provider === prov);
              const runs = provData.map((b) => b.runs);
              const maxRuns = Math.max(...runs, 1);
              return (
                <div key={prov} className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate text-gray-600" title={prov}>{prov}</span>
                  <div className="flex-1 flex items-end gap-px h-4">
                    {runs.map((v, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-indigo-400 rounded-t-sm min-w-[2px]"
                        style={{ height: `${String((v / maxRuns) * 100)}%` }}
                        title={`${String(v)} runs`}
                      />
                    ))}
                  </div>
                  <span className="w-12 text-right text-gray-500">{runs.reduce((a, b) => a + b, 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Provider / Model breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase mb-2">Cost by Provider</div>
          {providers.length === 0 ? (
            <div className="text-xs text-gray-400">No data</div>
          ) : (
            <div className="space-y-2">
              {providers.map(([name, cost]) => (
                <div key={name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="truncate" title={name}>{name}</span>
                    <span className="font-medium">{formatCost(cost)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${String((cost / totalCostAll) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase mb-2">Cost by Model</div>
          {models.length === 0 ? (
            <div className="text-xs text-gray-400">No data</div>
          ) : (
            <div className="space-y-2">
              {models.map(([name, cost]) => (
                <div key={name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="truncate" title={name}>{name}</span>
                    <span className="font-medium">{formatCost(cost)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full"
                      style={{ width: `${String((cost / totalCostAll) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Task pass rate time-series */}
      {taskTs && taskTs.passRate.length > 0 && (
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase mb-2">Task Pass Rate Over Time</div>
          <div className="flex items-end gap-px h-12">
            {taskTs.passRate.map((pr, i) => (
              <div
                key={i}
                className={`flex-1 rounded-t-sm min-w-[2px] ${pr.rate >= 0.8 ? 'bg-green-500' : pr.rate >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ height: `${String(pr.rate * 100)}%` }}
                title={`${pr.bucket.slice(0, 10)}: ${(pr.rate * 100).toFixed(0)}%`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 mt-1">
            {taskTs.passRate.length > 0 && <span>{taskTs.passRate[0].bucket.slice(5, 10)}</span>}
            {taskTs.passRate.length > 1 && <span>{taskTs.passRate[taskTs.passRate.length - 1].bucket.slice(5, 10)}</span>}
          </div>
        </div>
      )}

      {/* Per-task cost breakdown */}
      {taskCosts.length > 0 && (
        <div className="bg-white border rounded p-3">
          <div className="text-[10px] text-gray-500 uppercase mb-2">Cost by Task (Top 30)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase border-b">
                  <th className="text-left py-1.5 pr-2">Task</th>
                  <th className="text-left py-1.5 pr-2">Provider</th>
                  <th className="text-left py-1.5 pr-2">Model</th>
                  <th className="text-right py-1.5 pr-2">Tokens</th>
                  <th className="text-right py-1.5 pr-2">Cost</th>
                  <th className="text-right py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {taskCosts.map((tc) => (
                  <tr key={tc.taskId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 pr-2 max-w-[200px] truncate" title={tc.title}>{tc.title}</td>
                    <td className="py-1.5 pr-2 text-gray-500">{tc.provider}</td>
                    <td className="py-1.5 pr-2 text-gray-500 truncate max-w-[120px]" title={tc.model}>{tc.model}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-500">{tc.totalTokens.toLocaleString()}</td>
                    <td className="py-1.5 pr-2 text-right font-medium">{formatCost(tc.costUsd)}</td>
                    <td className="py-1.5 text-right">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${tc.status === 'done' ? 'bg-green-100 text-green-700' : tc.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                        {tc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
