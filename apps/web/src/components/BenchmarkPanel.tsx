import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { TraceFlow } from './TraceFlow.js';

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

export interface BenchmarkResult {
  task: BenchmarkTask;
  harnessTaskId: string;
  durationMs: number;
  status: 'done' | 'failed' | 'timeout';
  evaluation: BenchmarkEvaluation;
  agentRun?: BenchmarkAgentRun;
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
        <span className={statusColor(result.status)}>{result.status}</span>
      </div>
      <div className="flex justify-between text-gray-500 mt-0.5">
        <span>{formatDuration(result.durationMs)}</span>
        <span>{result.agentRun?.totalTokens ?? result.usage?.totalTokens ?? 0} tokens</span>
      </div>
      <div className="flex justify-between text-gray-400 text-[10px] mt-0.5">
        <span>score {result.evaluation.score ?? '—'}</span>
        <span>{f2pBadge(result.evaluation.metrics) ?? ''}</span>
      </div>
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
  const [filter, setFilter] = useState<'all' | 'done' | 'failed' | 'timeout'>('all');
  const filtered = report.results.filter((r) => (filter === 'all' ? true : r.status === filter));
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
          <option value="done">done</option>
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
          <div className="font-medium mb-1">Failure analysis</div>
          {result.evaluation.message ? (
            <div>{result.evaluation.message}</div>
          ) : (
            <div className="text-red-500">No failure message recorded.</div>
          )}
          {result.agentRun?.validationSummary && (
            <pre className="mt-2 bg-white p-2 rounded text-[10px] overflow-auto max-h-40">
              {result.agentRun.validationSummary}
            </pre>
          )}
        </div>
      )}

      <MetricsGrid metrics={result.evaluation.metrics} />
      <VerifierLogs metrics={result.evaluation.metrics} />

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
    <div className="p-4 space-y-6 text-sm border-t border-gray-200">
      <div>
        <h3 className="font-semibold mb-2">Run benchmark</h3>
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

      {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

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
          <h3 className="font-semibold">{benchmarkReport.suite}</h3>
          <div className="text-[10px] text-gray-500">{benchmarkReport.timestamp}</div>
          <BenchmarkSummary report={benchmarkReport} versions={promptVersions} />
          <BenchmarkResults
            report={benchmarkReport}
            selectedResult={selectedResult}
            onSelectResult={setSelectedResult}
            versions={promptVersions}
          />
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
