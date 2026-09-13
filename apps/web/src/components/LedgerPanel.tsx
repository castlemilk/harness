import { useCallback, useEffect, useState } from 'react';
import { api, type LedgerInspectResponse } from '../lib/api.js';

function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function finishColor(finishReason: string | null, truncated: boolean): string {
  if (finishReason === 'error') return 'text-red-600';
  if (truncated) return 'text-amber-600';
  return 'text-green-600';
}

export function LedgerPanel({ taskId }: { taskId: string }) {
  const [data, setData] = useState<LedgerInspectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>('plan.md');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getLedger(taskId));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <div className="text-[10px] text-gray-400">Loading ledger…</div>;
  if (error) return <div className="text-[10px] text-gray-400">{error}</div>;
  if (!data) return null;

  const maxDuration = Math.max(1, ...data.calls.map((call) => call.durationMs ?? 0));

  return (
    <div className="max-h-80 space-y-2 overflow-auto rounded bg-gray-50 p-2">
      <div className="flex items-center gap-2 text-[10px] text-gray-600">
        <span className="font-medium">Ledger run</span>
        <span className="rounded bg-gray-200 px-1">{data.totals.calls} calls</span>
        <span className="rounded bg-gray-200 px-1">{data.totals.truncated} truncated</span>
        <span className="rounded bg-gray-200 px-1">{data.totals.completionTokens} out tok</span>
        {data.totals.costUsd > 0 && <span className="rounded bg-gray-200 px-1">${data.totals.costUsd.toFixed(4)}</span>}
        <button onClick={() => { void load(); }} className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[9px]">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-hidden rounded bg-white">
        <table className="w-full text-[10px]">
          <thead className="bg-gray-100 text-left text-gray-500">
            <tr>
              <th className="px-1.5 py-0.5">role</th>
              <th className="px-1.5 py-0.5">calls</th>
              <th className="px-1.5 py-0.5">trunc</th>
              <th className="px-1.5 py-0.5">out tok</th>
              <th className="px-1.5 py-0.5">avg</th>
              <th className="px-1.5 py-0.5">max</th>
            </tr>
          </thead>
          <tbody>
            {data.roles.map((role) => (
              <tr key={role.role} className="border-t border-gray-100">
                <td className="px-1.5 py-0.5 text-gray-700">{role.role}</td>
                <td className="px-1.5 py-0.5">{role.calls}</td>
                <td className={`px-1.5 py-0.5 ${role.truncated > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{role.truncated}</td>
                <td className="px-1.5 py-0.5">{role.completionTokens}</td>
                <td className="px-1.5 py-0.5">{formatMs(role.avgDurationMs)}</td>
                <td className="px-1.5 py-0.5">{formatMs(role.maxDurationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-0.5 text-[10px] font-medium text-gray-600">Calls</div>
        <div className="space-y-0.5">
          {data.calls.map((call) => (
            <div
              key={call.index}
              className="rounded bg-white px-1.5 py-0.5"
              title={call.responseExcerpt}
            >
              <div className="flex items-center gap-1 text-[10px]">
                <span className="w-6 text-right text-gray-400">{call.index}</span>
                <span className="w-24 truncate text-gray-700">{call.role}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                  <span
                    className={`block h-1.5 rounded ${call.truncated ? 'bg-amber-400' : 'bg-blue-400'}`}
                    style={{ width: `${Math.max(2, ((call.durationMs ?? 0) / maxDuration) * 100).toFixed(1)}%` }}
                  />
                </span>
                <span className="w-12 text-right text-gray-500">{formatMs(call.durationMs)}</span>
                <span className={`w-12 text-right ${finishColor(call.finishReason, call.truncated)}`}>
                  {call.finishReason ?? '?'}
                </span>
                <span className="w-14 text-right text-gray-400">{call.completionTokens} tok</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-0.5 text-[10px] font-medium text-gray-600">Workspace files</div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(data.files).map(([name, file]) => (
            <button
              key={name}
              onClick={() => { setOpenFile(openFile === name ? null : name); }}
              className={`rounded px-1.5 py-0.5 text-[9px] ${
                openFile === name ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'
              }`}
              disabled={file.bytes === 0}
            >
              {name} ({file.bytes}B)
            </button>
          ))}
        </div>
        {openFile && data.files[openFile].content !== undefined && (
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-white p-1.5 text-[9px]">
            {data.files[openFile].content}
          </pre>
        )}
        {openFile && data.files[openFile].content === undefined && (
          <div className="mt-1 text-[9px] text-gray-400">File is too large to preview; open {data.files[openFile].path}</div>
        )}
      </div>
    </div>
  );
}
