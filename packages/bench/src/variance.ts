import { runBenchmark, type BenchmarkTask, type BenchmarkResult } from './index.js';

export interface VarianceTaskResult {
  taskId: string;
  taskName: string;
  runs: number;
  passes: number;
  passRate: number;
  ci95Low: number;
  ci95High: number;
  results: boolean[];
  avgDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface VarianceReport {
  timestamp: string;
  suite: string;
  nRuns: number;
  totalTasks: number;
  overallPassRate: number;
  overallCi95Low: number;
  overallCi95High: number;
  tasks: VarianceTaskResult[];
  summary: {
    stable: number;
    unstable: number;
    alwaysFail: number;
    alwaysPass: number;
    avgCostPerTask: number;
    totalCostUsd: number;
    totalTokens: number;
  };
}

function wilsonCi(p: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const spread = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)];
}

export interface RunVarianceOptions {
  apiUrl: string;
  timeoutMs: number;
  projectPrefix: string;
  provider?: string;
  model?: string;
  tokenBudget?: number;
  nRuns?: number;
  onProgress?: (taskId: string, run: number, result: BenchmarkResult) => void;
}

export async function runVarianceEval(
  tasks: BenchmarkTask[],
  options: RunVarianceOptions,
): Promise<VarianceReport> {
  const nRuns = options.nRuns ?? 5;
  const taskResults: VarianceTaskResult[] = [];

  for (const task of tasks) {
    const runBools: boolean[] = [];
    let totalDurationMs = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;

    for (let run = 0; run < nRuns; run++) {
      const result = await runBenchmark([task], {
        apiUrl: options.apiUrl,
        suiteName: 'variance',
        timeoutMs: options.timeoutMs,
        projectPrefix: `${options.projectPrefix}-r${String(run)}`,
        provider: options.provider,
        model: options.model,
        tokenBudget: options.tokenBudget,
      });

      const firstResult = result.results[0];
      const passed = firstResult.evaluation.passed;
      runBools.push(passed);
      totalDurationMs += result.totalDurationMs;
      totalTokens += firstResult.usage?.totalTokens ?? firstResult.agentRun?.totalTokens ?? 0;
      totalCostUsd += firstResult.agentRun?.costUsd ?? 0;

      options.onProgress?.(task.id, run, firstResult);
    }

    const passes = runBools.filter(Boolean).length;
    const passRate = passes / nRuns;
    const [ci95Low, ci95High] = wilsonCi(passRate, nRuns);

    taskResults.push({
      taskId: task.id,
      taskName: task.name,
      runs: nRuns,
      passes,
      passRate,
      ci95Low,
      ci95High,
      results: runBools,
      avgDurationMs: Math.round(totalDurationMs / nRuns),
      totalTokens,
      totalCostUsd,
    });
  }

  const totalPassRates = taskResults.map((t) => t.passRate);
  const overallPassRate = totalPassRates.reduce((a, b) => a + b, 0) / totalPassRates.length;
  const totalPassed = taskResults.reduce((sum, t) => sum + t.passes, 0);
  const totalRuns = taskResults.reduce((sum, t) => sum + t.runs, 0);
  const [overallCiLow, overallCiHigh] = wilsonCi(totalPassed / totalRuns, totalRuns);

  const stable = taskResults.filter((t) => t.passRate >= 0.8 || t.passRate <= 0.2).length;
  const unstable = taskResults.filter((t) => t.passRate > 0.2 && t.passRate < 0.8).length;
  const alwaysFail = taskResults.filter((t) => t.passRate === 0).length;
  const alwaysPass = taskResults.filter((t) => t.passRate === 1).length;
  const totalCost = taskResults.reduce((sum, t) => sum + t.totalCostUsd, 0);

  return {
    timestamp: new Date().toISOString(),
    suite: 'variance',
    nRuns,
    totalTasks: tasks.length,
    overallPassRate,
    overallCi95Low: overallCiLow,
    overallCi95High: overallCiHigh,
    tasks: taskResults,
    summary: {
      stable,
      unstable,
      alwaysFail,
      alwaysPass,
      avgCostPerTask: tasks.length > 0 ? totalCost / tasks.length : 0,
      totalCostUsd: totalCost,
      totalTokens: taskResults.reduce((sum, t) => sum + t.totalTokens, 0),
    },
  };
}

export function printVarianceSummary(report: VarianceReport): void {
  console.log(`\n=== Variance Report (${String(report.nRuns)} runs per task) ===`);
  console.log(
    `Overall: ${(report.overallPassRate * 100).toFixed(1)}% ` +
    `(95% CI: ${(report.overallCi95Low * 100).toFixed(1)}%–${(report.overallCi95High * 100).toFixed(1)}%)`,
  );
  console.log(`Tasks: ${String(report.totalTasks)} total, ${String(report.summary.alwaysPass)} always-pass, ${String(report.summary.alwaysFail)} always-fail, ${String(report.summary.stable)} stable, ${String(report.summary.unstable)} unstable`);
  console.log(`Cost: $${report.summary.totalCostUsd.toFixed(2)} total, $${report.summary.avgCostPerTask.toFixed(2)}/task avg`);

  console.log(`\nPer-task results:`);
  for (const task of report.tasks) {
    const ciWidth = task.ci95High - task.ci95Low;
    const stability = ciWidth < 0.2 ? 'stable' : ciWidth < 0.5 ? 'moderate' : 'volatile';
    console.log(
      `  ${task.taskName.padEnd(30)} ${String(task.passes).padStart(2)}/${String(task.runs)} ` +
      `(${(task.passRate * 100).toFixed(0).padStart(3)}%) ` +
      `[${(task.ci95Low * 100).toFixed(0)}%–${(task.ci95High * 100).toFixed(0)}%] ` +
      `${stability.padEnd(8)} $${task.totalCostUsd.toFixed(2)}`,
    );
  }
}
