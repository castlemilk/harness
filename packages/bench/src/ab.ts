import type { BenchmarkReport, BenchmarkResult, BenchmarkTask } from './types.js';
import { runBenchmark, type RunnerOptions } from './runner.js';

export interface PromptVersionSpec {
  name: string;
  systemPrompt: string;
  textToolsPrompt: string;
}

export interface AbBenchmarkReport {
  timestamp: string;
  baseline: PromptVersionSpec;
  candidate: PromptVersionSpec;
  baselineReport: BenchmarkReport;
  candidateReport: BenchmarkReport;
  delta: {
    passRate: number;
    passedDelta: number;
    durationMsDelta: number;
    promptTokensDelta: number;
    completionTokensDelta: number;
    totalTokensDelta: number;
  };
  perTask: {
    taskId: string;
    taskName: string;
    baselinePassed: boolean;
    candidatePassed: boolean;
    baselineTokens?: number;
    candidateTokens?: number;
  }[];
}

interface AbRunOptions extends Omit<RunnerOptions, 'suiteName'> {
  suiteName?: string;
}

function passRate(report: BenchmarkReport): number {
  return report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0;
}

function findResult(report: BenchmarkReport, taskId: string): BenchmarkResult | undefined {
  return report.results.find((r) => r.task.id === taskId);
}

export function buildAbReport(
  baseline: PromptVersionSpec,
  candidate: PromptVersionSpec,
  baselineReport: BenchmarkReport,
  candidateReport: BenchmarkReport
): AbBenchmarkReport {
  const baselineRate = passRate(baselineReport);
  const candidateRate = passRate(candidateReport);

  const taskIds = new Set<string>();
  for (const r of baselineReport.results) taskIds.add(r.task.id);
  for (const r of candidateReport.results) taskIds.add(r.task.id);

  const perTask = Array.from(taskIds).map((taskId) => {
    const base = findResult(baselineReport, taskId);
    const cand = findResult(candidateReport, taskId);
    return {
      taskId,
      taskName: base?.task.name ?? cand?.task.name ?? taskId,
      baselinePassed: base?.evaluation.passed ?? false,
      candidatePassed: cand?.evaluation.passed ?? false,
      baselineTokens: base?.usage?.totalTokens,
      candidateTokens: cand?.usage?.totalTokens,
    };
  });

  return {
    timestamp: new Date().toISOString(),
    baseline,
    candidate,
    baselineReport,
    candidateReport,
    delta: {
      passRate: candidateRate - baselineRate,
      passedDelta: candidateReport.passed - baselineReport.passed,
      durationMsDelta: candidateReport.totalDurationMs - baselineReport.totalDurationMs,
      promptTokensDelta: (candidateReport.totalUsage?.promptTokens ?? 0) - (baselineReport.totalUsage?.promptTokens ?? 0),
      completionTokensDelta: (candidateReport.totalUsage?.completionTokens ?? 0) - (baselineReport.totalUsage?.completionTokens ?? 0),
      totalTokensDelta: (candidateReport.totalUsage?.totalTokens ?? 0) - (baselineReport.totalUsage?.totalTokens ?? 0),
    },
    perTask,
  };
}

export async function runAbBenchmark(
  tasks: BenchmarkTask[],
  baseline: PromptVersionSpec,
  candidate: PromptVersionSpec,
  options: AbRunOptions
): Promise<AbBenchmarkReport> {
  const suiteName = options.suiteName ?? 'ab';

  const baselineReport = await runBenchmark(tasks, {
    ...options,
    suiteName: `${suiteName}-baseline`,
  });

  const candidateReport = await runBenchmark(tasks, {
    ...options,
    suiteName: `${suiteName}-candidate`,
  });

  return buildAbReport(baseline, candidate, baselineReport, candidateReport);
}

function deltaSymbol(value: number): string {
  if (value > 0) return '+';
  if (value < 0) return '';
  return '';
}

function formatDelta(value: number): string {
  return `${deltaSymbol(value)}${String(value)}`;
}

export function formatAbReport(report: AbBenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Omega A/B Benchmark Report');
  lines.push('');
  lines.push(`- Timestamp: ${report.timestamp}`);
  lines.push(`- Baseline: ${report.baseline.name}`);
  lines.push(`- Candidate: ${report.candidate.name}`);
  lines.push('');

  lines.push('## Summary');
  lines.push(`| Metric | Baseline | Candidate | Delta |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| Pass rate | ${String(passRate(report.baselineReport))}% | ${String(passRate(report.candidateReport))}% | ${formatDelta(report.delta.passRate)}% |`);
  lines.push(`| Passed | ${String(report.baselineReport.passed)}/${String(report.baselineReport.total)} | ${String(report.candidateReport.passed)}/${String(report.candidateReport.total)} | ${formatDelta(report.delta.passedDelta)} |`);
  lines.push(`| Duration | ${formatDuration(report.baselineReport.totalDurationMs)} | ${formatDuration(report.candidateReport.totalDurationMs)} | ${formatDuration(report.delta.durationMsDelta)} |`);
  lines.push(`| Tokens | ${String(report.baselineReport.totalUsage?.totalTokens ?? 0)} | ${String(report.candidateReport.totalUsage?.totalTokens ?? 0)} | ${formatDelta(report.delta.totalTokensDelta)} |`);
  lines.push('');

  lines.push('## Per-task comparison');
  lines.push(`| Task | Baseline | Candidate | Token delta |`);
  lines.push(`|---|---|---|---|`);
  for (const t of report.perTask) {
    const tokenDelta = t.baselineTokens !== undefined && t.candidateTokens !== undefined ? formatDelta(t.candidateTokens - t.baselineTokens) : '-';
    lines.push(`| ${t.taskName} | ${t.baselinePassed ? 'pass' : 'fail'} | ${t.candidatePassed ? 'pass' : 'fail'} | ${tokenDelta} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
