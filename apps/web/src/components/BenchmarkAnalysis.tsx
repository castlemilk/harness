import type { BenchmarkReport, BenchmarkResult } from './BenchmarkPanel.js';

function formatPct(n: number): string {
  return `${String(Math.round(n * 100))}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function aggregateF2pP2p(report: BenchmarkReport) {
  let f2pPassed = 0;
  let f2pTotal = 0;
  let p2pPassed = 0;
  let p2pTotal = 0;
  for (const r of report.results) {
    const m = r.evaluation.metrics;
    if (!m) continue;
    if (typeof m.f2p_passed === 'number' && typeof m.f2p_total === 'number') {
      f2pPassed += m.f2p_passed;
      f2pTotal += m.f2p_total;
    }
    if (typeof m.p2p_passed === 'number' && typeof m.p2p_total === 'number') {
      p2pPassed += m.p2p_passed;
      p2pTotal += m.p2p_total;
    }
  }
  return {
    f2pPassed,
    f2pTotal,
    p2pPassed,
    p2pTotal,
    f2pRate: f2pTotal > 0 ? f2pPassed / f2pTotal : 0,
    p2pRate: p2pTotal > 0 ? p2pPassed / p2pTotal : 0,
  };
}

function resultF2pP2p(result: BenchmarkResult) {
  const m = result.evaluation.metrics;
  return {
    f2pPassed: typeof m?.f2p_passed === 'number' ? m.f2p_passed : undefined,
    f2pTotal: typeof m?.f2p_total === 'number' ? m.f2p_total : undefined,
    p2pPassed: typeof m?.p2p_passed === 'number' ? m.p2p_passed : undefined,
    p2pTotal: typeof m?.p2p_total === 'number' ? m.p2p_total : undefined,
    partial: typeof m?.partial === 'number' ? m.partial : result.evaluation.score,
  };
}

function Bar({ label, passed, total, color }: { label: string; passed: number; total: number; color: string }) {
  const rate = total > 0 ? passed / total : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-gray-600">
        <span>{label}</span>
        <span>
          {String(passed)}/{String(total)} ({formatPct(rate)})
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${String(Math.max(0, Math.min(1, rate)) * 100)}%` }} />
      </div>
    </div>
  );
}

export function F2pP2pSummary({ report }: { report: BenchmarkReport }) {
  const agg = aggregateF2pP2p(report);
  if (agg.f2pTotal === 0 && agg.p2pTotal === 0) return null;
  return (
    <div className="bg-white border border-gray-200 p-3 rounded space-y-2">
      <h5 className="font-medium text-xs text-gray-500 uppercase tracking-wide">f2p / p2p breakdown</h5>
      {agg.f2pTotal > 0 && <Bar label="f2p (feature-to-patch)" passed={agg.f2pPassed} total={agg.f2pTotal} color="bg-blue-500" />}
      {agg.p2pTotal > 0 && <Bar label="p2p (patch-to-patch)" passed={agg.p2pPassed} total={agg.p2pTotal} color="bg-emerald-500" />}
    </div>
  );
}

export function ResultF2pP2p({ result }: { result: BenchmarkResult }) {
  const m = resultF2pP2p(result);
  if (m.f2pTotal === undefined && m.p2pTotal === undefined) return null;
  return (
    <div className="space-y-1 mt-1">
      {m.f2pTotal !== undefined && (
        <Bar label="f2p" passed={m.f2pPassed ?? 0} total={m.f2pTotal} color="bg-blue-500" />
      )}
      {m.p2pTotal !== undefined && (
        <Bar label="p2p" passed={m.p2pPassed ?? 0} total={m.p2pTotal} color="bg-emerald-500" />
      )}
    </div>
  );
}

export function ScoreDistribution({ report }: { report: BenchmarkReport }) {
  const bins = ['0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1', '1'];
  const counts: number[] = Array.from({ length: bins.length }, () => 0);
  for (const r of report.results) {
    const s = r.evaluation.score ?? (r.status === 'done' ? 1 : 0);
    const idx = Math.min(Math.floor(s / (1 / (bins.length - 1))), bins.length - 1);
    counts[idx] += 1;
  }
  const max = Math.max(1, ...counts);
  return (
    <div className="bg-white border border-gray-200 p-3 rounded space-y-2">
      <h5 className="font-medium text-xs text-gray-500 uppercase tracking-wide">Score distribution</h5>
      <div className="flex items-end gap-1 h-24">
        {bins.map((label, i) => (
          <div key={label} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-indigo-500 rounded-t"
              style={{ height: `${String((counts[i] / max) * 100)}%` }}
              title={`${label}: ${String(counts[i])}`}
            />
            <span className="text-[9px] text-gray-500">{label}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-gray-500 text-center">
        {String(report.results.length)} tasks · avg score{' '}
        {formatPct(report.results.reduce((sum, r) => sum + (r.evaluation.score ?? 0), 0) / report.results.length)}
      </div>
    </div>
  );
}

export function FailurePatterns({ report }: { report: BenchmarkReport }) {
  const groups = new Map<string, number>();
  for (const r of report.results) {
    if (r.status === 'done' && r.evaluation.passed) continue;
    const msg = r.evaluation.message ?? r.agentRun?.validationSummary ?? r.status;
    let key: string;
    if (typeof msg === 'string' && msg.includes('Docker build failed')) {
      key = 'Docker build failed';
    } else if (typeof msg === 'string' && msg.includes('f2p')) {
      const m = /reward=\d+/.exec(msg);
      key = m ? `Verifier failed (${m[0]})` : 'Verifier failed';
    } else {
      key = typeof msg === 'string' ? msg.split('\n')[0].slice(0, 80) : String(msg);
    }
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const rows = Array.from(groups.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 p-3 rounded space-y-2">
      <h5 className="font-medium text-xs text-gray-500 uppercase tracking-wide">Top failure patterns</h5>
      <div className="space-y-1">
        {rows.map(([key, count]) => (
          <div key={key} className="flex justify-between items-center text-xs">
            <span className="truncate mr-2" title={key}>{key}</span>
            <span className="shrink-0 font-medium">{count} ({Math.round((count / report.results.length) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function resultDuration(r: BenchmarkResult): number {
  return r.durationMs;
}

function resultTokens(r: BenchmarkResult): number {
  return r.agentRun?.totalTokens ?? r.usage?.totalTokens ?? 0;
}

function resultScore(r: BenchmarkResult): number {
  return r.evaluation.score ?? (r.evaluation.passed ? 1 : 0);
}

export function DurationChart({ report }: { report: BenchmarkReport }) {
  const durations = report.results.map(resultDuration);
  const max = Math.max(1, ...durations);
  return (
    <div className="bg-white border border-gray-200 p-3 rounded space-y-2">
      <h5 className="font-medium text-xs text-gray-500 uppercase tracking-wide">Duration by task</h5>
      <div className="space-y-1">
        {report.results.map((r) => {
          const d = resultDuration(r);
          const score = resultScore(r);
          return (
            <div key={r.harnessTaskId} className="flex items-center gap-2">
              <span className="w-32 truncate text-[10px] text-gray-600" title={r.task.name}>{r.task.name}</span>
              <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                <div
                  className={`h-full ${score >= 1 ? 'bg-green-500' : score >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${String((d / max) * 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-[10px] text-gray-500">{formatDuration(d)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TokenChart({ report }: { report: BenchmarkReport }) {
  const tokens = report.results.map(resultTokens);
  const max = Math.max(1, ...tokens);
  return (
    <div className="bg-white border border-gray-200 p-3 rounded space-y-2">
      <h5 className="font-medium text-xs text-gray-500 uppercase tracking-wide">Token usage by task</h5>
      <div className="space-y-1">
        {report.results.map((r) => {
          const t = resultTokens(r);
          const score = resultScore(r);
          return (
            <div key={r.harnessTaskId} className="flex items-center gap-2">
              <span className="w-32 truncate text-[10px] text-gray-600" title={r.task.name}>{r.task.name}</span>
              <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                <div
                  className={`h-full ${score >= 1 ? 'bg-blue-500' : score >= 0.5 ? 'bg-indigo-500' : 'bg-gray-400'}`}
                  style={{ width: `${String((t / max) * 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-[10px] text-gray-500">{formatTokens(t)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
