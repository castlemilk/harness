import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../lib/api.js';
import type { BenchmarkBaselineComparison } from '../lib/api.js';
import { TraceFlow } from './TraceFlow.js';
import { TaskSteps } from './TaskSteps.js';
import { DiffViewer } from './DiffViewer.js';
import { ErrorBadge } from './ErrorBadge.js';
import { FailurePatterns, F2pP2pSummary, ResultF2pP2p, ScoreDistribution, DurationChart, TokenChart } from './BenchmarkAnalysis.js';

export interface BenchmarkRunBody {
  suite?: 'synthetic' | 'deep-swe';
  nTasks?: number;
  provider?: string;
  model?: string;
  timeout?: number;
}

export interface BenchmarkRunStatus {
  running: boolean;
  pid?: number;
  output?: string;
}

export interface BenchmarkTask {
  id: string;
  name: string;
  title: string;
  description?: string;
  complexity?: string;
}

export interface BenchmarkEvaluation {
  passed: boolean;
  score?: number;
  message?: string;
  metrics?: Record<string, number | string>;
}

export interface BenchmarkAgentRun {
  id: string;
  resultStatus: string;
  validationSummary?: string;
  publishedVersion?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BenchmarkFailureAnalysis {
  category: string;
  rootCause?: string;
  evidence?: string;
  verifierLogFile?: string;
}

export interface BenchmarkResultDiff {
  id: string;
  branch: string;
  patch: string;
  createdAt?: string;
}

export interface BenchmarkResult {
  task: BenchmarkTask;
  harnessTaskId: string;
  durationMs: number;
  status: 'done' | 'failed' | 'timeout';
  evaluation: BenchmarkEvaluation;
  agentRun?: BenchmarkAgentRun;
  diffs?: BenchmarkResultDiff[];
  failureAnalysis?: BenchmarkFailureAnalysis;
  spanCount?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  promptVersionId?: string;
  promptHash?: string;
}

export interface BenchmarkReport {
  timestamp: string;
  suite: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  totalDurationMs: number;
  totalUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  promptVersionId?: string;
  promptHash?: string;
  results: BenchmarkResult[];
  failureAnalysis?: Record<string, unknown>;
}

export interface AbReport {
  timestamp: string;
  suite: string;
  baseline: { name: string; report: BenchmarkReport };
  candidate: { name: string; report: BenchmarkReport };
  comparison?: Record<string, unknown>;
}

export interface PromptVersion {
  id: string;
  name: string;
  sourcePath: string;
  systemPrompt: string;
  textToolsPrompt: string;
  hash: string;
  metadata?: string | null;
  createdAt: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function passRate(report: BenchmarkReport): string {
  if (report.total === 0) return '0%';
  return `${String(Math.round((report.passed / report.total) * 100))}%`;
}

function tokenCount(report: BenchmarkReport): number {
  if (report.totalUsage?.totalTokens !== undefined) return report.totalUsage.totalTokens;
  return report.results.reduce((sum, r) => sum + (r.usage?.totalTokens ?? r.agentRun?.totalTokens ?? 0), 0);
}

function statusColor(status: string): string {
  if (status === 'done') return 'text-green-600';
  if (status === 'failed') return 'text-red-600';
  if (status === 'timeout') return 'text-yellow-600';
  return 'text-gray-500';
}

function ReportList({
  title,
  files,
  selected,
  onSelect,
}: {
  title: string;
  files: string[];
  selected: string | undefined;
  onSelect: (file: string) => void;
}) {
  return (
    <div>
      <h4 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">{title}</h4>
      {files.length === 0 ? (
        <div className="text-xs text-gray-400">No reports</div>
      ) : (
        <div className="space-y-1 max-h-40 overflow-auto">
          {files.map((file) => (
            <button
              key={file}
              onClick={() => { onSelect(file); }}
              className={`w-full text-left text-[11px] px-2 py-1 rounded truncate ${
                selected === file ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
              }`}
              title={file}
            >
              {file}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function f2pBadge(metrics?: Record<string, number | string>): string | undefined {
  const passed = metrics?.f2p_passed;
  const total = metrics?.f2p_total;
  if (typeof passed === 'number' && typeof total === 'number') {
    return `f2p ${String(passed)}/${String(total)}`;
  }
  return undefined;
}

function ResultRow({
  result,
  selected,
  onSelect,
  version,
}: {
  result: BenchmarkResult;
  selected: boolean;
  onSelect: () => void;
  version?: PromptVersion;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-2 py-1 rounded text-[11px] ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex justify-between items-center">
        <span className="font-medium truncate" title={result.task.title}>
          {result.task.name}
        </span>
        <span
          className={
            result.status === 'timeout'
              ? statusColor('timeout')
              : result.evaluation.passed
                ? 'text-green-600'
                : 'text-red-600'
          }
          title={`agent run: ${result.status}`}
        >
          {result.status === 'timeout' ? 'timeout' : result.evaluation.passed ? 'passed' : 'failed'}
        </span>
      </div>
      <div className="flex justify-between text-gray-500 mt-0.5">
        <span>{formatDuration(result.durationMs)}</span>
        <span>{result.agentRun?.totalTokens ?? result.usage?.totalTokens ?? 0} tokens</span>
      </div>
      <div className="flex justify-between text-gray-400 text-[10px] mt-0.5">
        <span>score {result.evaluation.score ?? '—'}</span>
        <span>{f2pBadge(result.evaluation.metrics) ?? ''}</span>
      </div>
      <ResultF2pP2p result={result} />
      {!result.evaluation.passed && result.failureAnalysis && (
        <div className="mt-0.5">
          <ErrorBadge
            category={result.failureAnalysis.category}
            title={result.failureAnalysis.rootCause}
          />
        </div>
      )}
      {version && (
        <div className="text-[10px] text-blue-600 truncate" title={version.hash}>
          {version.name}
        </div>
      )}
    </button>
  );
}

function PromptVersionBadge({
  report,
  versions,
}: {
  report: BenchmarkReport;
  versions: PromptVersion[];
}) {
  const version = versions.find((v) => v.id === report.promptVersionId);
  if (!version && !report.promptHash) return null;
  return (
    <div className="bg-blue-50 p-2 rounded text-xs">
      <div className="text-gray-500">Prompt version</div>
      <div className="font-medium truncate" title={version?.name ?? report.promptHash}>
        {version?.name ?? report.promptHash}
      </div>
      {version && (
        <div className="text-[10px] text-gray-400 truncate" title={version.hash}>
          {version.hash}
        </div>
      )}
    </div>
  );
}

function BenchmarkSummary({ report, versions }: { report: BenchmarkReport; versions: PromptVersion[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-gray-50 p-2 rounded">Suite: <span className="font-medium">{report.suite}</span></div>
      <div className="bg-gray-50 p-2 rounded">Pass rate: <span className="font-medium">{passRate(report)}</span></div>
      <div className="bg-gray-50 p-2 rounded">Duration: <span className="font-medium">{formatDuration(report.totalDurationMs)}</span></div>
      <div className="bg-gray-50 p-2 rounded">Total tokens: <span className="font-medium">{tokenCount(report)}</span></div>
      <div className="bg-gray-50 p-2 rounded">Total: <span className="font-medium">{report.total}</span></div>
      <div className="bg-gray-50 p-2 rounded">Passed: <span className="font-medium text-green-600">{report.passed}</span></div>
      <div className="bg-gray-50 p-2 rounded">Failed: <span className="font-medium text-red-600">{report.failed}</span></div>
      <div className="bg-gray-50 p-2 rounded">Timeouts: <span className="font-medium text-yellow-600">{report.timeouts}</span></div>
      <div className="col-span-2">
        <PromptVersionBadge report={report} versions={versions} />
      </div>
    </div>
  );
}

function BenchmarkResults({
  report,
  selectedResult,
  onSelectResult,
  versions,
}: {
  report: BenchmarkReport;
  selectedResult: BenchmarkResult | undefined;
  onSelectResult: (result: BenchmarkResult) => void;
  versions: PromptVersion[];
}) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'timeout'>('all');
  const verdictOf = (r: BenchmarkResult): 'passed' | 'failed' | 'timeout' =>
    r.status === 'timeout' ? 'timeout' : r.evaluation.passed ? 'passed' : 'failed';
  const filtered = report.results.filter((r) => (filter === 'all' ? true : verdictOf(r) === filter));
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h4 className="font-medium text-xs text-gray-500 uppercase tracking-wide">Results</h4>
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value as typeof filter); }}
          className="text-[10px] border border-gray-200 rounded px-1 py-0.5"
        >
          <option value="all">all</option>
          <option value="passed">passed</option>
          <option value="failed">failed</option>
          <option value="timeout">timeout</option>
        </select>
      </div>
      <div className="space-y-1 max-h-48 overflow-auto">
        {filtered.map((result) => (
          <ResultRow
            key={result.harnessTaskId}
            result={result}
            selected={selectedResult?.harnessTaskId === result.harnessTaskId}
            onSelect={() => { onSelectResult(result); }}
            version={versions.find((v) => v.id === result.promptVersionId)}
          />
        ))}
      </div>
    </div>
  );
}

function MetricsGrid({ metrics }: { metrics?: Record<string, number | string> }) {
  if (!metrics) return null;
  const entries = Object.entries(metrics).filter(([k]) => k !== 'verifier_logs');
  if (entries.length === 0) return null;
  return (
    <div>
      <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">DeepSWE metrics</h5>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="bg-gray-50 p-2 rounded">
            <div className="text-gray-500">{k}</div>
            <div className="font-medium truncate">{String(v)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerifierLogs({ metrics }: { metrics?: Record<string, number | string> }) {
  const logs = metrics?.verifier_logs;
  if (!logs || typeof logs !== 'string') return null;
  return (
    <details className="bg-gray-50 p-2 rounded text-xs">
      <summary className="cursor-pointer font-medium text-gray-700">Verifier logs</summary>
      <pre className="mt-2 bg-white p-2 rounded text-[10px] overflow-auto max-h-96 whitespace-pre-wrap">
        {logs}
      </pre>
    </details>
  );
}

function ResultDetail({ result, version }: { result: BenchmarkResult; version?: PromptVersion }) {
  return (
    <div className="space-y-4">
      <div className="bg-gray-50 p-3 rounded text-xs space-y-1">
        <div className="font-medium">{result.task.title}</div>
        <div className="text-gray-500">{result.task.description}</div>
        <div className="flex gap-3 mt-2">
          <span>Status: <span className={statusColor(result.status)}>{result.status}</span></span>
          <span>Duration: {formatDuration(result.durationMs)}</span>
          <span>Spans: {result.spanCount ?? 0}</span>
        </div>
        <div>
          Evaluation: {result.evaluation.passed ? (
            <span className="text-green-600">passed</span>
          ) : (
            <span className="text-red-600">failed</span>
          )}
          {result.evaluation.message && <span className="text-gray-500 ml-2">— {result.evaluation.message}</span>}
        </div>
        {(result.agentRun?.totalTokens ?? result.usage?.totalTokens) !== undefined && (
          <div className="text-gray-500">
            Tokens: {result.agentRun?.promptTokens ?? result.usage?.promptTokens ?? 0} prompt /{' '}
            {result.agentRun?.completionTokens ?? result.usage?.completionTokens ?? 0} completion /{' '}
            {result.agentRun?.totalTokens ?? result.usage?.totalTokens ?? 0} total
          </div>
        )}
        {version && (
          <div className="text-blue-700">
            Prompt: <span className="font-medium">{version.name}</span>{' '}
            <span className="text-[10px] text-gray-400" title={version.hash}>
              {version.hash.slice(0, 12)}
            </span>
          </div>
        )}
      </div>

      {!result.evaluation.passed && (
        <div className="bg-red-50 p-3 rounded text-xs text-red-700">
          <div className="font-medium mb-1 flex items-center gap-2">
            Failure analysis
            {result.failureAnalysis && <ErrorBadge category={result.failureAnalysis.category} />}
          </div>
          {result.failureAnalysis?.rootCause && (
            <div className="mb-1">{result.failureAnalysis.rootCause}</div>
          )}
          {result.evaluation.message ? (
            <div>{result.evaluation.message}</div>
          ) : (
            !result.failureAnalysis?.rootCause && <div className="text-red-500">No failure message recorded.</div>
          )}
          {result.failureAnalysis?.evidence && (
            <pre className="mt-2 bg-white p-2 rounded text-[10px] overflow-auto max-h-40 whitespace-pre-wrap">
              {result.failureAnalysis.evidence}
            </pre>
          )}
          {result.failureAnalysis?.verifierLogFile && (
            <div className="mt-1 text-[10px] text-red-500 font-mono">
              verifier log: {result.failureAnalysis.verifierLogFile}
            </div>
          )}
          {result.agentRun?.validationSummary && (
            <pre className="mt-2 bg-white p-2 rounded text-[10px] overflow-auto max-h-40">
              {result.agentRun.validationSummary}
            </pre>
          )}
        </div>
      )}

      {result.diffs && result.diffs.length > 0 && (
        <div>
          <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">Diffs</h5>
          <div className="space-y-3">
            {result.diffs.map((diff) => (
              <div key={diff.id}>
                <div className="text-[10px] text-gray-500 font-mono mb-1">{diff.branch}</div>
                <DiffViewer patch={diff.patch} />
              </div>
            ))}
          </div>
        </div>
      )}

      <MetricsGrid metrics={result.evaluation.metrics} />
      <VerifierLogs metrics={result.evaluation.metrics} />

      <div>
        <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">Agent steps</h5>
        <TaskSteps taskId={result.harnessTaskId} />
      </div>

      <div>
        <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">Trace flow</h5>
        <TraceFlow taskId={result.harnessTaskId} />
      </div>
    </div>
  );
}

function AbComparison({ report }: { report: AbReport }) {
  const baseline = report.baseline.report;
  const candidate = report.candidate.report;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 p-2 rounded">
          <div className="font-medium">Baseline: {report.baseline.name}</div>
          <div>Pass: {passRate(baseline)}</div>
          <div>Duration: {formatDuration(baseline.totalDurationMs)}</div>
          <div>Tokens: {tokenCount(baseline)}</div>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <div className="font-medium">Candidate: {report.candidate.name}</div>
          <div>Pass: {passRate(candidate)}</div>
          <div>Duration: {formatDuration(candidate.totalDurationMs)}</div>
          <div>Tokens: {tokenCount(candidate)}</div>
        </div>
      </div>

      <div>
        <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">Candidate results</h5>
        <div className="space-y-1 max-h-48 overflow-auto">
          {candidate.results.map((result) => (
            <div
              key={result.harnessTaskId}
              className="px-2 py-1 rounded text-[11px] bg-gray-50 flex justify-between"
            >
              <span className="truncate" title={result.task.title}>{result.task.name}</span>
              <span className={statusColor(result.status)}>{result.status}</span>
            </div>
          ))}
        </div>
      </div>

      {report.comparison && (
        <div className="bg-gray-50 p-2 rounded text-xs">
          <div className="font-medium mb-1">Comparison</div>
          <pre className="text-[10px] overflow-auto max-h-40">{JSON.stringify(report.comparison, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function PromptVersionComparison({
  reports,
  versions,
}: {
  reports: BenchmarkReport[];
  versions: PromptVersion[];
}) {
  const byVersion = new Map<string, BenchmarkReport[]>();
  for (const report of reports) {
    const key = report.promptVersionId ?? report.promptHash ?? 'unknown';
    const list = byVersion.get(key) ?? [];
    list.push(report);
    byVersion.set(key, list);
  }

  const rows = Array.from(byVersion.entries())
    .map(([key, reps]) => {
      const version = versions.find((v) => v.id === key || v.hash === key);
      const total = reps.reduce((sum, r) => sum + r.total, 0);
      const passed = reps.reduce((sum, r) => sum + r.passed, 0);
      const duration = reps.reduce((sum, r) => sum + r.totalDurationMs, 0);
      const tokens = reps.reduce((sum, r) => sum + tokenCount(r), 0);
      return {
        key,
        version,
        reports: reps.length,
        total,
        passed,
        passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
        duration,
        tokens,
      };
    })
    .sort((a, b) => b.passRate - a.passRate || a.reports - b.reports);

  if (rows.length === 0) {
    return <div className="text-xs text-gray-400">No prompt-version data available.</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="bg-gray-50 p-2 rounded text-xs">
          <div className="flex justify-between items-center">
            <span className="font-medium truncate" title={row.version?.name ?? row.key}>
              {row.version?.name ?? `${row.key.slice(0, 12)}…`}
            </span>
            <span className={row.passRate >= 80 ? 'text-green-600' : row.passRate >= 50 ? 'text-yellow-600' : 'text-red-600'}>
              {row.passRate}% ({row.passed}/{row.total})
            </span>
          </div>
          <div className="text-gray-500 mt-0.5">
            {row.reports} run{row.reports === 1 ? '' : 's'} · {formatDuration(row.duration)} · {row.tokens} tokens
          </div>
          {row.version && (
            <div className="text-[10px] text-gray-400 truncate" title={row.version.hash}>
              {row.version.hash}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PassRateTrend({ reports }: { reports: BenchmarkReport[] }) {
  const points = [...reports]
    .filter((r) => r.total > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (points.length < 2) {
    return <div className="text-xs text-gray-400">Need at least two reports for a trend.</div>;
  }
  return (
    <div className="bg-white border border-gray-200 p-3 rounded space-y-2">
      <h5 className="font-medium text-xs text-gray-500 uppercase tracking-wide">Pass rate trend</h5>
      <div className="flex items-end gap-1 h-24">
        {points.map((r) => {
          const rate = r.passed / r.total;
          return (
            <div key={r.timestamp} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[9px] text-gray-500">{Math.round(rate * 100)}%</span>
              <div
                className={`w-full rounded-t ${rate >= 0.8 ? 'bg-green-500' : rate >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ height: `${String(Math.max(2, rate * 64))}px` }}
                title={`${r.timestamp}: ${String(r.passed)}/${String(r.total)}`}
              />
              <span className="text-[9px] text-gray-400 truncate w-full text-center">
                {new Date(r.timestamp).toLocaleDateString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function deltaText(delta: number | undefined, suffix = ''): string {
  if (delta === undefined) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${String(delta)}${suffix}`;
}

function BaselineComparisonView({ comparison }: { comparison: BenchmarkBaselineComparison }) {
  const { summary } = comparison;
  // Tolerate pass rates expressed either as fractions (0–1) or percents (0–100).
  const toPct = (v: number) => (v > 1 ? v : v * 100);
  const baselinePct = toPct(summary.passRateBaseline);
  const candidatePct = toPct(summary.passRateCandidate);
  const passDelta = candidatePct - baselinePct;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 p-2 rounded">
          <div className="font-medium truncate" title={comparison.baseline.file}>
            Baseline: {comparison.baseline.file}
          </div>
          <div className="text-gray-500">{comparison.baseline.timestamp}</div>
          <div>Pass rate: {Math.round(baselinePct)}%</div>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <div className="font-medium truncate" title={comparison.candidate.file}>
            Candidate: {comparison.candidate.file}
          </div>
          <div className="text-gray-500">{comparison.candidate.timestamp}</div>
          <div>Pass rate: {Math.round(candidatePct)}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="bg-gray-50 p-2 rounded">
          <div className="text-gray-500">Pass rate Δ</div>
          <div className={`font-medium ${passDelta > 0 ? 'text-green-600' : passDelta < 0 ? 'text-red-600' : ''}`}>
            {passDelta > 0 ? '+' : ''}{Math.round(passDelta)}%
          </div>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <div className="text-gray-500">Passed Δ</div>
          <div className={`font-medium ${summary.passedDelta > 0 ? 'text-green-600' : summary.passedDelta < 0 ? 'text-red-600' : ''}`}>
            {deltaText(summary.passedDelta)}
          </div>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <div className="text-gray-500">Failed Δ</div>
          <div className={`font-medium ${summary.failedDelta < 0 ? 'text-green-600' : summary.failedDelta > 0 ? 'text-red-600' : ''}`}>
            {deltaText(summary.failedDelta)}
          </div>
        </div>
        <div className="bg-gray-50 p-2 rounded">
          <div className="text-gray-500">Regressions / improvements</div>
          <div className="font-medium">
            <span className="text-red-600">{summary.regressions.length}</span>
            {' / '}
            <span className="text-green-600">{summary.improvements.length}</span>
          </div>
        </div>
      </div>

      {summary.regressions.length > 0 && (
        <div className="bg-red-50 p-2 rounded text-xs text-red-700">
          <div className="font-medium mb-1">Regressions</div>
          <ul className="list-disc list-inside">
            {summary.regressions.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      {summary.improvements.length > 0 && (
        <div className="bg-green-50 p-2 rounded text-xs text-green-700">
          <div className="font-medium mb-1">Improvements</div>
          <ul className="list-disc list-inside">
            {summary.improvements.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-1 pr-2">Task</th>
              <th className="py-1 pr-2">Baseline</th>
              <th className="py-1 pr-2">Candidate</th>
              <th className="py-1 pr-2">Score Δ</th>
              <th className="py-1 pr-2">Duration Δ</th>
              <th className="py-1">Token Δ</th>
            </tr>
          </thead>
          <tbody>
            {comparison.results.map((r) => {
              const flipped = r.baselinePassed !== r.candidatePassed;
              const scoreDelta =
                r.baselineScore !== undefined && r.candidateScore !== undefined
                  ? Math.round((r.candidateScore - r.baselineScore) * 100) / 100
                  : undefined;
              return (
                <tr
                  key={r.taskId}
                  className={`border-b border-gray-100 ${
                    flipped ? (r.candidatePassed ? 'bg-green-50' : 'bg-red-50') : ''
                  }`}
                >
                  <td className="py-1 pr-2 truncate max-w-[200px]" title={r.taskName}>{r.taskName}</td>
                  <td className={`py-1 pr-2 ${r.baselinePassed ? 'text-green-600' : 'text-red-600'}`}>
                    {r.baselinePassed ? 'pass' : 'fail'}
                  </td>
                  <td className={`py-1 pr-2 ${r.candidatePassed ? 'text-green-600' : 'text-red-600'}`}>
                    {r.candidatePassed ? 'pass' : 'fail'}
                    {flipped && <span className="ml-1 text-[9px] text-gray-500">{r.candidatePassed ? '▲' : '▼'}</span>}
                  </td>
                  <td className="py-1 pr-2">{deltaText(scoreDelta)}</td>
                  <td className="py-1 pr-2">{deltaText(r.durationDeltaMs, 'ms')}</td>
                  <td className="py-1">{deltaText(r.tokenDelta)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ServerBenchRun = Awaited<ReturnType<typeof api.listBenchRuns>>[number];
type ServerBenchRunDetail = Awaited<ReturnType<typeof api.getBenchRun>>;
export type ServerBenchRunResult = NonNullable<ServerBenchRunDetail['results']>[number];

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'running': return { label: 'running', cls: 'bg-blue-100 text-blue-700' };
    case 'done': return { label: 'done', cls: 'bg-green-100 text-green-700' };
    case 'failed': return { label: 'failed', cls: 'bg-red-100 text-red-700' };
    case 'cancelled': return { label: 'cancelled', cls: 'bg-gray-100 text-gray-500' };
    case 'pending': return { label: 'pending', cls: 'bg-yellow-100 text-yellow-700' };
    default: return { label: status, cls: 'bg-gray-100 text-gray-500' };
  }
}

export function ServerBenchRunResultRow({ result }: { result: ServerBenchRunResult }) {
  const f2p = f2pBadge(result.evaluation?.metrics);
  const message = result.evaluation?.message ?? result.error;
  const usage = [
    result.costUsd !== undefined ? `$${result.costUsd.toFixed(4)}` : undefined,
    result.totalTokens !== undefined ? `${result.totalTokens.toLocaleString()} tokens` : undefined,
  ].filter((value): value is string => value !== undefined);

  return (
    <div className="px-2 py-1.5 rounded bg-gray-50 space-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={result.passed ? 'text-green-600' : 'text-red-600'}>
            {result.passed ? '✓' : '✗'}
          </span>
          <span className="truncate" title={result.taskName}>{result.taskName}</span>
          {result.winnerModel && <span className="text-[10px] text-blue-600">{result.winnerModel}</span>}
          {result.variancePassRate != null && (
            <span className="text-[10px] text-gray-400">{Math.round(result.variancePassRate * 100)}%</span>
          )}
        </div>
        <div className="shrink-0 text-right text-gray-400">
          <div>{formatDuration(result.durationMs)}</div>
          {usage.length > 0 && <div className="text-[10px]">{usage.join(' · ')}</div>}
        </div>
      </div>
      {(result.evaluation?.score !== undefined || f2p) && (
        <div className="flex gap-2 pl-5 text-[10px] text-gray-500">
          {result.evaluation?.score !== undefined && <span>score {result.evaluation.score}</span>}
          {f2p && <span>{f2p}</span>}
        </div>
      )}
      {message && <div className="pl-5 text-[10px] text-gray-500">{message}</div>}
    </div>
  );
}

function ServerBenchRuns({ onError }: { onError: (msg: string) => void }) {
  const [runs, setRuns] = useState<ServerBenchRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ServerBenchRunDetail | null>(null);
  const [form, setForm] = useState({
    suite: 'harder-v2',
    models: 'deepseek/deepseek-v4-pro',
    strategy: 'single' as 'single' | 'consensus' | 'variance',
    concurrency: 3,
    varianceRuns: 1,
  });
  const [starting, setStarting] = useState(false);
  const evtRef = useRef<EventSource | null>(null);

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => {
      if (evtRef.current) {
        evtRef.current.close();
        evtRef.current = null;
      }
    };
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await api.listBenchRuns(20);
      setRuns(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  const loadRun = useCallback(async (id: string) => {
    try {
      const data = await api.getBenchRun(id);
      setSelectedRun(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Poll running runs
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running' || r.status === 'pending');
    if (!hasRunning) return;
    const id = setInterval(() => { void loadRuns(); }, 3000);
    return () => { clearInterval(id); };
  }, [runs, loadRuns]);

  async function handleStart() {
    setStarting(true);
    try {
      const models = form.models
        ? form.models.split(',').map((m) => m.trim()).filter(Boolean).map((m) => {
            if (m.includes('/')) {
              const [provider, ...rest] = m.split('/');
              return { provider: provider, model: rest.join('/') };
            }
            return { provider: 'external', model: m };
          })
        : undefined;

      const res = await api.startBenchRun({
        suite: form.suite,
        models,
        strategy: form.strategy,
        concurrency: form.concurrency,
        varianceRuns: form.varianceRuns,
      });

      // Subscribe to SSE for live progress
      const es = new EventSource(api.benchRunStreamUrl(res.id));
      evtRef.current = es;
      es.addEventListener('task-completed', () => { void loadRuns(); void loadRun(res.id); });
      es.addEventListener('completed', () => { es.close(); evtRef.current = null; void loadRuns(); void loadRun(res.id); });
      es.addEventListener('failed', () => { es.close(); evtRef.current = null; void loadRuns(); });

      await loadRuns();
      await loadRun(res.id);
      onError('');
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
    setStarting(false);
  }

  async function handleCancel(id: string) {
    try {
      await api.cancelBenchRun(id);
      void loadRuns();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const hasRunning = runs.some((r) => r.status === 'running' || r.status === 'pending');

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm">Server-side benchmark runs</h3>

      <div className="bg-gray-50 p-3 rounded text-xs space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-500 mb-0.5">Suite</label>
            <select
              value={form.suite}
              onChange={(e) => { setForm((f) => ({ ...f, suite: e.target.value })); }}
              className="w-full border border-gray-200 rounded px-2 py-1"
            >
              <option value="harder-v2">harder-v2</option>
              <option value="hard-targeting">hard-targeting</option>
              <option value="harder">harder</option>
              <option value="fast">fast</option>
              <option value="synthetic">synthetic</option>
              <option value="swebench-lite">swebench-lite</option>
              <option value="deepswe">deepswe</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5">Strategy</label>
            <select
              value={form.strategy}
              onChange={(e) => { setForm((f) => ({ ...f, strategy: e.target.value as typeof f.strategy })); }}
              className="w-full border border-gray-200 rounded px-2 py-1"
            >
              <option value="single">single</option>
              <option value="consensus">consensus</option>
              <option value="variance">variance</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-gray-500 mb-0.5">Models (comma-separated provider/model)</label>
          <input
            type="text"
            value={form.models}
            onChange={(e) => { setForm((f) => ({ ...f, models: e.target.value })); }}
            className="w-full border border-gray-200 rounded px-2 py-1"
            placeholder="deepseek/deepseek-v4-pro,kimi/kimi-k3"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-500 mb-0.5">Concurrency</label>
            <input
              type="number"
              value={form.concurrency}
              onChange={(e) => { setForm((f) => ({ ...f, concurrency: Number(e.target.value) })); }}
              className="w-full border border-gray-200 rounded px-2 py-1"
              min={1}
              max={10}
            />
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5">Variance runs</label>
            <input
              type="number"
              value={form.varianceRuns}
              onChange={(e) => { setForm((f) => ({ ...f, varianceRuns: Number(e.target.value) })); }}
              className="w-full border border-gray-200 rounded px-2 py-1"
              min={1}
              max={20}
            />
          </div>
        </div>
        <button
          onClick={() => { void handleStart(); }}
          disabled={starting || hasRunning}
          className="w-full bg-blue-600 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {starting ? 'Starting…' : hasRunning ? 'Run in progress…' : 'Start server-side run'}
        </button>
      </div>

      {/* Run list */}
      <div className="space-y-1">
        {runs.length === 0 && <div className="text-xs text-gray-400">No runs yet</div>}
        {runs.map((run) => {
          const badge = statusBadge(run.status);
          return (
            <div
              key={run.id}
              className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer ${
                selectedRun?.id === run.id ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
              onClick={() => { void loadRun(run.id); }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="font-medium truncate">{run.suite}</span>
                <span className="text-gray-400">
                  {run.passed}/{run.totalTasks} passed
                </span>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <span>{formatDuration(run.totalDurationMs)}</span>
                {(run.status === 'running' || run.status === 'pending') && (
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleCancel(run.id); }}
                    className="text-red-500 hover:text-red-700"
                  >
                    cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected run detail */}
      {selectedRun && (
        <div className="bg-white border border-gray-200 rounded p-3 text-xs space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="font-medium">{selectedRun.suite} — {selectedRun.id.slice(0, 8)}</h4>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusBadge(selectedRun.status).cls}`}>
              {selectedRun.status}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Passed</div>
              <div className="font-medium text-green-600">{selectedRun.passed}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Failed</div>
              <div className="font-medium text-red-600">{selectedRun.failed}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Timeouts</div>
              <div className="font-medium text-yellow-600">{selectedRun.timeouts}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Duration</div>
              <div className="font-medium">{formatDuration(selectedRun.totalDurationMs)}</div>
            </div>
          </div>
          {(selectedRun.totalCostUsd != null || selectedRun.totalTokens != null) && (
            <div className="text-gray-500">
              {selectedRun.totalCostUsd != null && `Cost: $${selectedRun.totalCostUsd.toFixed(4)}`}
              {selectedRun.totalCostUsd != null && selectedRun.totalTokens != null && ' · '}
              {selectedRun.totalTokens != null && `Tokens: ${selectedRun.totalTokens.toLocaleString()}`}
            </div>
          )}
          {selectedRun.results && selectedRun.results.length > 0 && (
            <div className="space-y-1 max-h-60 overflow-auto">
              {selectedRun.results.map((result) => (
                <ServerBenchRunResultRow key={result.harnessTaskId} result={result} />
              ))}
            </div>
          )}
          {selectedRun.error && (
            <div className="bg-red-50 p-2 rounded text-red-700 text-[11px]">{selectedRun.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function BenchmarkPanel() {
  const [benchmarkFiles, setBenchmarkFiles] = useState<string[]>([]);
  const [abFiles, setAbFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>();
  const [selectedKind, setSelectedKind] = useState<'benchmark' | 'ab'>();
  const [report, setReport] = useState<BenchmarkReport | AbReport | null>(null);
  const [allReports, setAllReports] = useState<BenchmarkReport[]>([]);
  const [selectedResult, setSelectedResult] = useState<BenchmarkResult>();
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion>();
  const [runStatus, setRunStatus] = useState<BenchmarkRunStatus>({ running: false });
  const [runForm, setRunForm] = useState<BenchmarkRunBody>({ suite: 'synthetic', nTasks: undefined, provider: '', model: '', timeout: 120000 });
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState<{ file: string | null; timestamp?: string } | null>(null);
  const [comparison, setComparison] = useState<BenchmarkBaselineComparison | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  async function loadBaseline() {
    try {
      const data = await api.getBenchmarkBaseline();
      const report = data.report as unknown as BenchmarkReport | undefined;
      setBaseline({ file: data.file, timestamp: report?.timestamp });
    } catch {
      setBaseline(null);
    }
  }

  async function handleSetBaseline(file: string) {
    try {
      const data = await api.setBenchmarkBaseline(file);
      const report = data.report as unknown as BenchmarkReport | undefined;
      setBaseline({ file: data.file, timestamp: report?.timestamp });
      setComparison(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCompare(file: string) {
    if (comparison) {
      setComparison(null);
      return;
    }
    setCompareLoading(true);
    try {
      const data = await api.compareBenchmarkBaseline(file);
      setComparison(data);
      setError('');
    } catch (err) {
      setComparison(null);
      setError(err instanceof Error ? err.message : String(err));
    }
    setCompareLoading(false);
  }

  async function loadReports() {
    try {
      const data = await api.getBenchmarkReports();
      setBenchmarkFiles(data.benchmark);
      setAbFiles(data.ab);
      const reports = await Promise.all(
        data.benchmark.map((file) =>
          api.getBenchmarkReport(file).then((r) => r as unknown as BenchmarkReport).catch(() => null)
        )
      );
      setAllReports(reports.filter((r): r is BenchmarkReport => r !== null));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadPromptVersions() {
    try {
      const data = await api.getPromptVersions();
      setPromptVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadReport(file: string, kind: 'benchmark' | 'ab') {
    setSelectedFile(file);
    setSelectedKind(kind);
    setSelectedResult(undefined);
    setComparison(null);
    try {
      const data = kind === 'ab'
        ? ((await api.getAbReport(file)) as unknown as AbReport)
        : ((await api.getBenchmarkReport(file)) as unknown as BenchmarkReport);
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadRunStatus() {
    try {
      const status = await api.getBenchmarkRunStatus();
      setRunStatus(status);
    } catch (err) {
      setRunStatus({ running: false });
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startRun(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body: BenchmarkRunBody = {
        suite: runForm.suite,
        nTasks: runForm.nTasks,
        timeout: runForm.timeout,
      };
      if (runForm.provider?.trim()) body.provider = runForm.provider.trim();
      if (runForm.model?.trim()) body.model = runForm.model.trim();
      await api.runBenchmark(body as Record<string, unknown>);
      await loadRunStatus();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void loadReports();
    void loadPromptVersions();
    void loadRunStatus();
    void loadBaseline();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void loadRunStatus();
      if (runStatus.running) {
        void loadReports();
      }
    }, 3000);
    return () => {
      clearInterval(id);
    };
  }, [runStatus.running]);

  const benchmarkReport = selectedKind === 'benchmark' ? (report as BenchmarkReport) : undefined;
  const abReport = selectedKind === 'ab' ? (report as AbReport) : undefined;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6 text-sm">
      <ServerBenchRuns onError={(msg) => { setError(msg); }} />

      {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      <div>
        <h3 className="font-semibold mb-2">Run benchmark (CLI)</h3>
        <form onSubmit={(e) => { void startRun(e); }} className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-500 mb-0.5">Suite</label>
              <select
                value={runForm.suite}
                onChange={(e) => { setRunForm((f) => ({ ...f, suite: e.target.value as 'synthetic' | 'deep-swe' })); }}
                className="w-full border border-gray-200 rounded px-2 py-1"
              >
                <option value="synthetic">synthetic</option>
                <option value="deep-swe">deep-swe</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-500 mb-0.5">nTasks</label>
              <input
                type="number"
                value={runForm.nTasks ?? ''}
                onChange={(e) => { setRunForm((f) => ({ ...f, nTasks: e.target.value ? Number(e.target.value) : undefined })); }}
                className="w-full border border-gray-200 rounded px-2 py-1"
                placeholder="all"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-500 mb-0.5">Provider</label>
              <input
                type="text"
                value={runForm.provider}
                onChange={(e) => { setRunForm((f) => ({ ...f, provider: e.target.value })); }}
                className="w-full border border-gray-200 rounded px-2 py-1"
                placeholder="provider"
              />
            </div>
            <div>
              <label className="block text-gray-500 mb-0.5">Model</label>
              <input
                type="text"
                value={runForm.model}
                onChange={(e) => { setRunForm((f) => ({ ...f, model: e.target.value })); }}
                className="w-full border border-gray-200 rounded px-2 py-1"
                placeholder="model"
              />
            </div>
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5">Timeout (ms)</label>
            <input
              type="number"
              value={runForm.timeout}
              onChange={(e) => { setRunForm((f) => ({ ...f, timeout: Number(e.target.value) })); }}
              className="w-full border border-gray-200 rounded px-2 py-1"
            />
          </div>
          <button
            type="submit"
            disabled={runStatus.running}
            className="w-full bg-blue-600 text-white rounded px-3 py-1.5 disabled:opacity-50"
          >
            {runStatus.running ? 'Running…' : 'Run benchmark'}
          </button>
        </form>

        {runStatus.running && (
          <div className="mt-2 text-xs text-blue-700 bg-blue-50 p-2 rounded">
            Benchmark running (pid {runStatus.pid})
          </div>
        )}
        {!runStatus.running && runStatus.output && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-gray-500">Last run output</summary>
            <pre className="mt-1 bg-gray-50 p-2 rounded text-[10px] overflow-auto max-h-40">{runStatus.output}</pre>
          </details>
        )}
      </div>

      <ReportList
        title="Benchmark reports"
        files={benchmarkFiles}
        selected={selectedKind === 'benchmark' ? selectedFile : undefined}
        onSelect={(file) => { void loadReport(file, 'benchmark'); }}
      />

      <ReportList
        title="A/B reports"
        files={abFiles}
        selected={selectedKind === 'ab' ? selectedFile : undefined}
        onSelect={(file) => { void loadReport(file, 'ab'); }}
      />

      {benchmarkReport && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <h3 className="font-semibold">{benchmarkReport.suite}</h3>
              <div className="text-[10px] text-gray-500">{benchmarkReport.timestamp}</div>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs">
              {baseline?.file && (
                <span className="text-gray-500">
                  Baseline: <span className="font-medium" title={baseline.file}>{baseline.file}</span>
                  {baseline.timestamp && <span className="text-[10px] text-gray-400 ml-1">{baseline.timestamp}</span>}
                </span>
              )}
              <button
                onClick={() => { if (selectedFile) void handleSetBaseline(selectedFile); }}
                disabled={!selectedFile || baseline?.file === selectedFile}
                className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                {baseline?.file === selectedFile ? 'Current baseline' : 'Set as baseline'}
              </button>
              <button
                onClick={() => { if (selectedFile) void handleCompare(selectedFile); }}
                disabled={!selectedFile || !baseline?.file || compareLoading || baseline.file === selectedFile}
                className={`px-2 py-1 rounded disabled:opacity-50 ${
                  comparison ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {compareLoading ? 'Comparing…' : comparison ? 'Hide comparison' : 'Compare to baseline'}
              </button>
            </div>
          </div>
          {comparison && <BaselineComparisonView comparison={comparison} />}
          <BenchmarkSummary report={benchmarkReport} versions={promptVersions} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1 space-y-3">
              <F2pP2pSummary report={benchmarkReport} />
              <ScoreDistribution report={benchmarkReport} />
              <FailurePatterns report={benchmarkReport} />
            </div>
            <div className="md:col-span-2 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <DurationChart report={benchmarkReport} />
                <TokenChart report={benchmarkReport} />
              </div>
              <BenchmarkResults
                report={benchmarkReport}
                selectedResult={selectedResult}
                onSelectResult={setSelectedResult}
                versions={promptVersions}
              />
            </div>
          </div>
          {benchmarkReport.failureAnalysis && (
            <div className="bg-red-50 p-2 rounded text-xs text-red-700">
              <div className="font-medium mb-1">Failure analysis</div>
              <pre className="text-[10px] overflow-auto max-h-40">{JSON.stringify(benchmarkReport.failureAnalysis, null, 2)}</pre>
            </div>
          )}
          {selectedResult && (
            <ResultDetail
              result={selectedResult}
              version={promptVersions.find((v) => v.id === selectedResult.promptVersionId)}
            />
          )}
        </div>
      )}

      {abReport && (
        <div className="space-y-4">
          <h3 className="font-semibold">A/B: {abReport.baseline.name} vs {abReport.candidate.name}</h3>
          <div className="text-[10px] text-gray-500">{abReport.timestamp}</div>
          <AbComparison report={abReport} />
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-2">Pass rate trend</h3>
        <PassRateTrend reports={allReports} />
      </div>

      <div>
        <h3 className="font-semibold mb-2">Prompt version comparison</h3>
        <PromptVersionComparison reports={allReports} versions={promptVersions} />
      </div>

      <div>
        <h3 className="font-semibold mb-2">Prompt versions</h3>
        {promptVersions.length === 0 ? (
          <div className="text-xs text-gray-400">No prompt versions</div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-auto">
            {promptVersions.map((version) => (
              <button
                key={version.id}
                onClick={() => { setSelectedVersion(version); }}
                className={`w-full text-left bg-gray-50 p-2 rounded text-xs hover:bg-blue-50 ${
                  selectedVersion?.id === version.id ? 'ring-1 ring-blue-300' : ''
                }`}
              >
                <div className="font-medium truncate" title={version.name}>{version.name}</div>
                <div className="text-gray-500 truncate" title={version.sourcePath}>{version.sourcePath}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{version.hash}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedVersion && (
        <div className="bg-gray-50 p-3 rounded text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-medium">{selectedVersion.name}</span>
            <button
              onClick={() => { setSelectedVersion(undefined); }}
              className="text-gray-400 hover:text-gray-600"
            >
              close
            </button>
          </div>
          <div className="text-[10px] text-gray-400" title={selectedVersion.hash}>
            {selectedVersion.hash}
          </div>
          <details>
            <summary className="cursor-pointer text-gray-500">System prompt</summary>
            <pre className="mt-1 bg-white p-2 rounded text-[10px] overflow-auto max-h-64 whitespace-pre-wrap">
              {selectedVersion.systemPrompt}
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-gray-500">Tools prompt</summary>
            <pre className="mt-1 bg-white p-2 rounded text-[10px] overflow-auto max-h-64 whitespace-pre-wrap">
              {selectedVersion.textToolsPrompt}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
