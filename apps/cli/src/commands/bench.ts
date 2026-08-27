import { Command } from 'commander';
import path from 'node:path';
import { omegaReportsDir } from '@omega/core';

function collectTaskIds(value: string, previous: string[]): string[] {
  return previous.concat(value);
}
import {
  runBenchmark,
  syntheticSuite,
  fastSuite,
  deepSuite,
  hardSuite,
  hardTargetedSuite,
  harderSuite,
  loadDeepSWESuite,
  loadSWebenchLiteSuite,
  runPierBenchmark,
  writeReport,
  printSummary,
  compareReports,
  generateTrend,
  runConsensusEval,
  runStrategyEval,
  analyseFailures,
  loadOptimisationContext,
  buildOptimisePrompt,
  submitOptimiseTask,
  ensureProject,
  runModelEval,
  runHarnessEval,
  writeModelEvalReport,
  parseModelList,
  loadSuiteTasks,
  runVarianceEval,
  runDeepSWEGoldenCorpus,
  formatDeepSWEGoldenSummary,
  printVarianceSummary,
  saveBenchmarkHistory,
  getCostPerPassRate,
  getPassRateTrend,
  type BenchmarkTask,
  STRATEGY_PROMPTS,
  type StrategyName,
} from '@omega/bench';
import { getApiUrl } from '../api.js';

async function waitForApi(apiUrl: string, maxMs = 10000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiUrl}/projects`);
      if (res.ok) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Harness API is not ready at ${apiUrl}. Run \`omega ui\` or \`omega console\` first.`);
}

function currentProject(apiUrl: string): Promise<{ id: string }> {
  const cwd = process.cwd();
  const name = path.basename(cwd);
  return ensureProject(apiUrl, `bench-${name}`, cwd);
}

function isFreeOpenRouterModel(provider?: string, model?: string): boolean {
  return provider === 'openrouter' && !!model && (model.endsWith(':free') || model === 'openrouter/free');
}

/** Run the consensus path (best-of-N across models) + persist. Shared by runCmd --strategy consensus and consensusCmd. */
async function runConsensusCli(opts: {
  apiUrl: string;
  suiteName: string;
  tasks: BenchmarkTask[];
  models: string;
  timeoutMs: number;
  tokenBudget?: number;
  projectPrefix: string;
  baseline?: string;
}): Promise<void> {
  if (opts.tasks.length === 0) {
    console.log('No benchmark tasks to run.');
    return;
  }

  const models = opts.models.split(',').map((m) => m.trim()).filter(Boolean).map((m) => {
    // Accepted formats:
    //   provider/model      → e.g. "minimax/MiniMax-M3", "deepseek/deepseek-v4-pro"
    //   external:<cli>      → e.g. "external:agy", "external:claude-code"
    //   <cli> alone         → assumed external, e.g. "agy", "opencode"
    if (m.startsWith('external:')) {
      return { provider: 'external', model: m.slice('external:'.length) };
    }
    if (m.includes('/')) {
      const [provider, ...rest] = m.split('/');
      return { provider, model: rest.join('/') };
    }
    return { provider: 'external', model: m };
  });
  if (models.length === 0) {
    throw new Error('--models is required for --strategy consensus (e.g. "external:agy,minimax/MiniMax-M3")');
  }

  console.log(
    `Running ${String(opts.tasks.length)} tasks across ${String(models.length)} agents in parallel: ${models.map((m) => `${m.provider}/${m.model}`).join(', ')}`,
  );

  const results = await runConsensusEval(opts.tasks, {
    apiUrl: opts.apiUrl,
    models,
    timeoutMs: opts.timeoutMs,
    tokenBudget: opts.tokenBudget,
    projectPrefix: opts.projectPrefix,
    suiteName: opts.suiteName,
    onTaskProgress: (taskId, report) => {
      const winner = report.winner
        ? `winner: ${report.winner.provider}/${report.winner.model}`
        : 'no winner';
      console.log(
        `  ${report.passed ? '✓' : '✗'} ${taskId} (${String(report.candidates.length)} candidates, ${winner})`,
      );
    },
  });

  if (opts.baseline) {
    console.log('--baseline comparison only applies to single mode; skipping.');
  }

  const reportFile = await writeModelEvalReport(results, opts.suiteName);
  const consensus = results[0];
  if (consensus.report.consensus) {
    const c = consensus.report.consensus;
    console.log(
      `\nConsensus: ${String(c.passed)}/${String(c.total)} passed (${(c.passRate * 100).toFixed(0)}%)`,
    );
    console.log(`  total cost: $${c.totalCostUsd.toFixed(2)}  total tokens: ${c.totalTokens.toLocaleString()}`);
    console.log(`  wins by model:`, c.winsByModel);
    console.log(`\nReport written to ${reportFile}`);
  }

  // Persist consensus results to benchmark history.
  try {
    const { PrismaClient } = await import('@omega/db/generated');
    const prisma = new PrismaClient();
    await saveBenchmarkHistory(prisma, consensus.report, {
      provider: 'consensus',
      model: models.map((m) => m.model).join('+'),
      reportPath: reportFile,
      metadata: { winsByModel: consensus.report.consensus?.winsByModel },
    });
    await prisma.$disconnect();
  } catch {
    // history persistence is best-effort
  }
}

/** Run the strategy path (prompt variants) + persist. Shared by runCmd --strategy strategy and strategyCmd. */
async function runStrategyCli(opts: {
  apiUrl: string;
  suiteName: string;
  tasks: BenchmarkTask[];
  strategies: string;
  timeoutMs: number;
  tokenBudget?: number;
  projectPrefix: string;
  provider?: string;
  model?: string;
  auto?: boolean;
  baseline?: string;
}): Promise<void> {
  if (opts.tasks.length === 0) {
    console.log('No benchmark tasks to run.');
    return;
  }

  const raw = opts.strategies;
  const strategies = raw.split(',').map((s) => s.trim()).filter(Boolean) as StrategyName[];
  const validStrategies = Object.keys(STRATEGY_PROMPTS);
  const unknown = strategies.filter((s) => !validStrategies.includes(s));
  if (unknown.length > 0) {
    throw new Error(`Unknown strategy: ${unknown.join(', ')}. Allowed: ${validStrategies.join(' | ')}`);
  }
  const autoStrategies = opts.auto ?? false;

  console.log(
    autoStrategies
      ? `Running ${String(opts.tasks.length)} tasks with auto-selected strategies`
      : `Running ${String(opts.tasks.length)} tasks across ${String(strategies.length)} strategies: ${strategies.join(', ')}`,
  );

  const result = await runStrategyEval(opts.tasks, {
    apiUrl: opts.apiUrl,
    strategies,
    timeoutMs: opts.timeoutMs,
    tokenBudget: opts.tokenBudget,
    projectPrefix: opts.projectPrefix,
    provider: opts.provider,
    model: opts.model,
    suiteName: opts.suiteName,
    autoStrategies,
    onProgress: (taskId, report) => {
      const w = report.winner ?? 'none';
      console.log(
        `  ${report.passed ? '✓' : '✗'} ${taskId} (${String(report.candidates.length)} strategies, winner: ${w})`,
      );
    },
  });

  if (opts.baseline) {
    console.log('--baseline comparison only applies to single mode; skipping.');
  }

  console.log(
    `\nUnion pass rate: ${result.summary.unionPassRate.toFixed(0)}% (${String(result.tasks.filter((r) => r.passed).length)}/${String(result.tasks.length)})`,
  );
  console.log(`\nPer-strategy pass rate:`);
  for (const [name, s] of Object.entries(result.summary.perStrategy)) {
    console.log(
      `  ${name.padEnd(24)} ${String(s.passes)}/${String(s.runs)} (${(s.passRate * 100).toFixed(0)}%)  avg ${String(Math.round(s.avgDurationMs / 1000))}s`,
    );
  }
  console.log(`\nWins by strategy:`, result.summary.winsByStrategy);

  // Analyze failures from traces.
  const insights = analyseFailures(result.tasks);
  if (insights.length > 0) {
    console.log(`\n--- Failure Analysis (${String(insights.length)} tasks failed across all strategies) ---`);
    for (const insight of insights) {
      console.log(`\n  ${insight.taskName}:`);
      console.log(`    Reason: ${insight.reason}`);
      if (insight.toolAnomalies.length > 0) {
        console.log(`    Tool anomalies: ${insight.toolAnomalies.join('; ')}`);
      }
      if (insight.topErrors.length > 0) {
        console.log(`    Top errors:`);
        for (const err of insight.topErrors.slice(0, 3)) {
          console.log(`      ${err}`);
        }
      }
      console.log(`    Suggestion: ${insight.suggestion}`);
    }
  }

  // Persist a JSON report for later analysis.
  const reportPath = `${omegaReportsDir()}/strategy-${opts.suiteName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fs = await import('node:fs/promises');
  await fs.mkdir(omegaReportsDir(), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        suite: opts.suiteName,
        strategies,
        summary: result.summary,
        failureInsights: insights,
        tasks: result.tasks.map((t) => ({
          taskId: t.task.id,
          passed: t.passed,
          winner: t.winner,
          durationMs: t.durationMs,
          totalTokens: t.totalTokens,
          totalCostUsd: t.totalCostUsd,
          candidates: t.candidates,
        })),
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\nReport written to ${reportPath}`);
}

const runCmd = new Command('run')
  .description('Run a benchmark suite')
  .option('--suite <name>', 'suite name: synthetic | fast | deep | hard | harder | harder-v2 | hard-targeting | deep-swe | swebench-lite | pier', 'synthetic')
  .option('--path <dir>', 'path to DeepSWE tasks directory (for deep-swe/pier) or SWE-bench JSON file (for swebench-lite)')
  .option('--n-tasks <n>', 'limit number of tasks (for deep-swe/pier/swebench-lite)', parseInt)
  .option('--sample-seed <n>', 'seed for deterministic sampling (for deep-swe/pier/swebench-lite)', parseInt)
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--repo <repo>', 'filter to specific repo (for swebench-lite, repeatable)', collectTaskIds, [])
  .option('--timeout <ms>', 'per-task timeout in ms', '1800000')
  .option('--output-dir <dir>', 'report output directory (single mode only; consensus/strategy write to omegaReportsDir())')
  .option('--project-prefix <prefix>', 'project name prefix for created harness projects', 'bench')
  .option('--provider <name>', 'provider to use for benchmark tasks')
  .option('--model <model>', 'model to use for benchmark tasks')
  .option('--docker', 'run DeepSWE verifiers in Docker (required for most Node.js tasks)')
  .option('--token-budget <n>', 'per-task token cap; free models commonly need 50k+', parseInt)
  .option('--agent <name>', 'Pier agent to use (e.g. mini-swe-agent)', 'mini-swe-agent')
  .option('--env-file <file>', 'Pier env file with API credentials')
  .option('--jobs-dir <dir>', 'Pier jobs directory')
  .option('--n-concurrent <n>', 'Pier concurrent trials', parseInt)
  .option('--pier-extra <arg>', 'extra Pier CLI arg (repeatable)', collectTaskIds, [])
  .option('--baseline <file>', 'compare against a baseline report after run (single mode only); exit non-zero on regression')
  .option('--fail-on-regression', 'exit with code 1 if pass rate drops vs baseline (used with --baseline)')
  .option('--strategy <mode>', 'eval mode: single | consensus | strategy (default: single)', 'single')
  .option('--models <list>', 'comma-separated provider/model list (required for --strategy consensus, e.g. "external:agy,minimax/MiniMax-M3")')
  .option('--strategies <list>', 'comma-separated strategies for --strategy strategy (default: default,verify-before-finish,research-first)')
  .option('--auto', 'auto-select strategies via classifyTask (strategy mode only)')
  .action(async (opts: {
    suite: string;
    path?: string;
    nTasks?: number;
    sampleSeed?: number;
    taskId: string[];
    repo: string[];
    timeout: string;
    outputDir?: string;
    projectPrefix: string;
    provider?: string;
    model?: string;
    docker?: boolean;
    tokenBudget?: number;
    agent?: string;
    envFile?: string;
    jobsDir?: string;
    nConcurrent?: number;
    pierExtra: string[];
    baseline?: string;
    failOnRegression?: boolean;
    strategy: string;
    models?: string;
    strategies?: string;
    auto?: boolean;
  }) => {
    if (opts.strategy !== 'single' && opts.suite === 'pier') {
      throw new Error('--strategy only applies to the harness suites, not pier');
    }
    if (!['single', 'consensus', 'strategy'].includes(opts.strategy)) {
      throw new Error(`Unknown --strategy value: ${opts.strategy}. Allowed: single | consensus | strategy`);
    }
    if (opts.strategy === 'consensus' && !opts.models) {
      throw new Error('--models is required for --strategy consensus (e.g. "external:agy,minimax/MiniMax-M3")');
    }

    const timeoutMs = Number(opts.timeout);
    const outputDir = opts.outputDir ?? omegaReportsDir();

    if (isFreeOpenRouterModel(opts.provider, opts.model) && opts.tokenBudget !== undefined && opts.tokenBudget < 50_000) {
      console.warn('OpenRouter free models commonly need 50k+ tokens because prompt tokens accumulate across turns; this cap may stop a correct patch before finish.');
    }

    if (opts.suite === 'pier') {
      if (!opts.path) {
        throw new Error('--path is required for the pier suite');
      }
      // Pier expects model names like "kimi/moonshot-v1-128k".
      let pierModel = opts.model;
      if (pierModel && opts.provider && !pierModel.includes('/')) {
        pierModel = `${opts.provider}/${pierModel}`;
      }
      const report = await runPierBenchmark({
        tasksDir: opts.path,
        agent: opts.agent,
        model: pierModel,
        nTasks: opts.nTasks,
        sampleSeed: opts.sampleSeed,
        taskIds: opts.taskId.length > 0 ? opts.taskId : undefined,
        jobsDir: opts.jobsDir,
        envFile: opts.envFile ? path.resolve(opts.envFile) : undefined,
        nConcurrent: opts.nConcurrent,
        timeoutMs,
        extraArgs: opts.pierExtra.length > 0 ? opts.pierExtra : undefined,
        suiteName: 'pier',
      });
      const reportFile = await writeReport(report, outputDir);
      printSummary(report);
      console.log(`\nReport written to ${reportFile}`);
      return;
    }

    const apiUrl = getApiUrl();
    await waitForApi(apiUrl);

    const { tasks, suiteName } = await loadSuiteTasks({
      suite: opts.suite,
      path: opts.path,
      nTasks: opts.nTasks,
      sampleSeed: opts.sampleSeed,
      taskIds: opts.taskId,
      repos: opts.repo,
      useDocker: opts.docker,
      mode: opts.strategy === 'single' ? 'run' : (opts.strategy as 'consensus' | 'strategy'),
    });

    if (tasks.length === 0) {
      console.log('No benchmark tasks to run.');
      return;
    }

    if (opts.strategy === 'consensus') {
      await runConsensusCli({
        apiUrl,
        suiteName,
        tasks,
        models: opts.models ?? '',
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
        baseline: opts.baseline,
      });
      return;
    }

    if (opts.strategy === 'strategy') {
      await runStrategyCli({
        apiUrl,
        suiteName,
        tasks,
        strategies: opts.strategies ?? 'default,verify-before-finish,research-first',
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
        provider: opts.provider,
        model: opts.model,
        auto: opts.auto,
        baseline: opts.baseline,
      });
      return;
    }

    console.log(`Running ${String(tasks.length)} benchmark tasks against ${apiUrl}`);
    const report = await runBenchmark(tasks, {
      apiUrl,
      suiteName,
      timeoutMs,
      projectPrefix: opts.projectPrefix,
      provider: opts.provider,
      model: opts.model,
      tokenBudget: opts.tokenBudget,
      onProgress: (result) => {
        const symbol = result.evaluation.passed ? '✓' : '✗';
        const status = result.evaluation.passed && result.status !== 'done'
          ? `${result.status}; evaluation passed`
          : result.status;
        console.log(`${symbol} ${result.task.name} [${status}] ${String(result.durationMs)}ms`);
      },
    });

    const reportFile = await writeReport(report, outputDir);
    printSummary(report);
    console.log(`\nReport written to ${reportFile}`);

    // Persist to benchmark history for cost-per-pass-rate tracking.
    try {
      const { PrismaClient } = await import('@omega/db/generated');
      const prisma = new PrismaClient();
      await saveBenchmarkHistory(prisma, report, {
        provider: opts.provider,
        model: opts.model,
        reportPath: reportFile,
      });
      await prisma.$disconnect();
    } catch {
      // history persistence is best-effort; don't fail the bench run
    }

    // Baseline comparison
      if (opts.baseline) {
        const baselinePath = opts.baseline;
        const text = await compareReports({ baseline: baselinePath, candidate: reportFile });
        console.log('\n' + text);
        if (opts.failOnRegression) {
          const baselineReport = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(baselinePath, 'utf-8'))) as { passed: number; total: number };
        const baseRate = baselineReport.total > 0 ? baselineReport.passed / baselineReport.total : 0;
        const candRate = report.total > 0 ? report.passed / report.total : 0;
        if (candRate < baseRate) {
          console.error(`\nRegression detected: pass rate dropped from ${String(Math.round(baseRate * 100))}% to ${String(Math.round(candRate * 100))}%`);
          process.exit(1);
        }
      }
    }
  });

const optimiseCmd = new Command('optimise')
  .description('Create a self-improve task from the latest benchmark report')
  .option('--output-dir <dir>', 'report output directory')
  .action(async (opts: { outputDir?: string }) => {
    const apiUrl = getApiUrl();
    await waitForApi(apiUrl);

    const context = await loadOptimisationContext(apiUrl, opts.outputDir ?? omegaReportsDir());
    if (!context) {
      console.log('No benchmark report found. Run `omega bench run` first.');
      return;
    }

    const project = await currentProject(apiUrl);
    const prompt = buildOptimisePrompt(
      context.report,
      context.failedResult,
      context.traceFlowText
    );
    const task = await submitOptimiseTask(apiUrl, project.id, prompt);
    console.log(`Created self-improve task ${task.id}`);
    console.log(`Run \`omega task run ${task.id}\` to execute it.`);
  });

const compareCmd = new Command('compare')
  .description('Diff two benchmark reports (baseline vs candidate)')
  .requiredOption('--baseline <file>', 'baseline report JSON path')
  .requiredOption('--candidate <file>', 'candidate report JSON path')
  .option('--task <id>', 'only show a specific task')
  .option('--write <file>', 'also write the markdown to this path')
  .action(
    async (opts: {
      baseline: string;
      candidate: string;
      task?: string;
      write?: string;
    }) => {
      const text = await compareReports({
        baseline: opts.baseline,
        candidate: opts.candidate,
        taskId: opts.task,
      });
      console.log(text);
      if (opts.write) {
        const fs = await import('node:fs/promises');
        await fs.writeFile(opts.write, text, 'utf-8');
        console.log(`\nWrote ${opts.write}`);
      }
    }
  );

const evalCmd = new Command('eval')
  .description('Run a benchmark suite across multiple models and compare results')
  .option('--suite <name>', 'suite name: synthetic | fast | deep | hard | harder | hard-targeting | deep-swe | swebench-lite', 'deep')
  .option('--models <list>', 'comma-separated models as provider/model or model (default provider kimi)', 'kimi/moonshot-v1-128k')
  .option('--harnesses <list>', 'comma-separated external agent harnesses (codex, claude-code, agy, opencode, cursor-cli, aider) to evaluate instead of internal models')
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--repo <repo>', 'filter to specific repo (for swebench-lite, repeatable)', collectTaskIds, [])
  .option('--path <dir>', 'path to DeepSWE tasks directory (for hard/deep-swe) or SWE-bench JSON file (for swebench-lite)')
  .option('--timeout <ms>', 'per-task timeout in ms', '600000')
  .option('--token-budget <n>', 'per-task token cap', parseInt)
  .option('--project-prefix <prefix>', 'project name prefix for created harness projects', 'eval')
  .action(async (opts: {
    suite: string;
    models: string;
    harnesses?: string;
    taskId: string[];
    repo: string[];
    path?: string;
    timeout: string;
    tokenBudget?: number;
    projectPrefix: string;
  }) => {
    const apiUrl = getApiUrl();
    await waitForApi(apiUrl);

    let tasks;
    if (opts.suite === 'fast') {
      tasks = fastSuite();
    } else if (opts.suite === 'deep') {
      tasks = deepSuite();
    } else if (opts.suite === 'synthetic') {
      tasks = syntheticSuite();
    } else if (opts.suite === 'hard') {
      if (!opts.path) throw new Error('--path is required for the hard suite');
      tasks = await hardSuite(opts.path);
    } else if (opts.suite === 'harder') {
      tasks = harderSuite();
    } else if (opts.suite === 'hard-targeting') {
      tasks = hardTargetedSuite();
    } else if (opts.suite === 'deep-swe') {
      if (!opts.path) throw new Error('--path is required for the deep-swe suite');
      tasks = await loadDeepSWESuite({ tasksDir: opts.path });
    } else if (opts.suite === 'swebench-lite') {
      if (!opts.path) throw new Error('--path is required for the swebench-lite suite (path to JSON file)');
      tasks = await loadSWebenchLiteSuite({
        datasetPath: path.resolve(opts.path),
        taskIds: opts.taskId.length > 0 ? opts.taskId : undefined,
        repos: opts.repo.length > 0 ? opts.repo : undefined,
      });
    } else {
      throw new Error(`Unknown suite: ${opts.suite}`);
    }
    if (opts.taskId.length > 0) {
      tasks = tasks.filter((t) => opts.taskId.includes(t.id));
    }

    const timeoutMs = Number(opts.timeout);

    if (opts.harnesses) {
      const harnesses = opts.harnesses.split(',').map((h) => h.trim()).filter(Boolean);
      console.log(`Running ${String(tasks.length)} tasks across ${String(harnesses.length)} external harness(es): ${harnesses.join(', ')}`);
      const results = await runHarnessEval(tasks, {
        apiUrl,
        harnesses,
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
        suiteName: opts.suite,
        onHarnessProgress: (cli, report) => {
          console.log(`✓ external:${cli}: ${String(report.passed)}/${String(report.total)} passed (${(report.totalDurationMs / 1000).toFixed(1)}s)`);
        },
      });
      const reportFile = await writeModelEvalReport(results, opts.suite);
      console.log(`\nHarness eval report written to ${reportFile}`);

      // Persist per-harness results to benchmark history.
      try {
        const { PrismaClient } = await import('@omega/db/generated');
        const prisma = new PrismaClient();
        for (const r of results) {
          await saveBenchmarkHistory(prisma, r.report, {
            provider: 'external',
            model: r.model,
            reportPath: reportFile,
          });
        }
        await prisma.$disconnect();
      } catch {
        // history persistence is best-effort
      }
      return;
    }

    const models = parseModelList(opts.models);
    console.log(`Running ${String(tasks.length)} tasks across ${String(models.length)} model(s): ${models.map((m) => `${m.provider}/${m.model}`).join(', ')}`);

    const results = await runModelEval(tasks, {
      apiUrl,
      models,
      timeoutMs,
      tokenBudget: opts.tokenBudget,
      projectPrefix: opts.projectPrefix,
      suiteName: opts.suite,
      onModelProgress: (m, report) => {
        console.log(`✓ ${m.provider}/${m.model}: ${String(report.passed)}/${String(report.total)} passed (${(report.totalDurationMs / 1000).toFixed(1)}s)`);
      },
    });

    const reportFile = await writeModelEvalReport(results, opts.suite);
    console.log(`\nModel eval report written to ${reportFile}`);

    // Persist per-model results to benchmark history.
    try {
      const { PrismaClient } = await import('@omega/db/generated');
      const prisma = new PrismaClient();
      for (const r of results) {
        await saveBenchmarkHistory(prisma, r.report, {
          provider: r.provider,
          model: r.model,
          reportPath: reportFile,
        });
      }
      await prisma.$disconnect();
    } catch {
      // history persistence is best-effort
    }
  });

const trendCmd = new Command('trend')
  .description('Show pass-rate trend across benchmark reports')
  .option('--suite <name>', 'filter to a specific suite')
  .option('--last <n>', 'show only the last N entries', parseInt)
  .option('--output-dir <dir>', 'report output directory')
  .action(async (opts: { suite?: string; last?: number; outputDir?: string }) => {
    const text = await generateTrend({
      outputDir: opts.outputDir,
      suite: opts.suite,
      last: opts.last,
    });
    console.log(text);
  });

const goldenCmd = new Command('golden')
  .description(
    'Re-grade the stored golden patches through the verifier and diff against expected outcomes. ' +
      'No model runs: this pins GRADING, not capability, and takes minutes rather than hours.'
  )
  .option('--tasks-dir <dir>', 'deep-swe tasks directory', path.join(process.cwd(), 'deep-swe', 'tasks'))
  .option(
    '--manifest <file>',
    'golden manifest path',
    path.join(process.cwd(), 'packages', 'bench', 'fixtures', 'deepswe-golden', 't1-shakedown', 'manifest.json')
  )
  .option('--task <id>', 'only replay this task (repeatable)', collectTaskIds, [])
  .option('--no-docker', 'grade with the local verifier instead of Docker')
  .action(async (opts: { tasksDir: string; manifest: string; task: string[]; docker: boolean }) => {
    const result = await runDeepSWEGoldenCorpus({
      manifestPath: opts.manifest,
      tasksDir: opts.tasksDir,
      taskIds: opts.task.length > 0 ? opts.task : undefined,
      useDocker: opts.docker,
    });
    console.log(formatDeepSWEGoldenSummary(result));
    // Drift in a grading corpus is a failure signal, not information.
    if (result.matched !== result.total) process.exitCode = 1;
  });

const consensusCmd = new Command('consensus')
  .description(
    'Run multiple agents in parallel on each task and pick the first passing patch (best-of-N by eval). ' +
      'Pass rate = fraction of tasks where ANY agent succeeded. ' +
      'Cost = sum across all agents.',
  )
  .option('--suite <name>', 'suite name: fast | deep | harder | harder-v2 | hard-targeting | hard', 'harder')
  .option(
    '--models <list>',
    'comma-separated models as provider/model (e.g. "external:agy,minimax/MiniMax-M3,deepseek/deepseek-v4-pro")',
  )
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--path <dir>', 'path to DeepSWE tasks directory (for hard suite)')
  .option('--timeout <ms>', 'per-agent per-task timeout in ms', '600000')
  .option('--token-budget <n>', 'per-agent token cap', parseInt)
  .option('--project-prefix <prefix>', 'project name prefix for created harness projects', 'consensus')
  .action(
    async (opts: {
      suite: string;
      models: string;
      taskId: string[];
      path?: string;
      timeout: string;
      tokenBudget?: number;
      projectPrefix: string;
    }) => {
      if (!opts.models) {
        throw new Error('--models is required for consensus (e.g. "external:agy,minimax/MiniMax-M3")');
      }
      const apiUrl = getApiUrl();
      await waitForApi(apiUrl);

      const { tasks, suiteName } = await loadSuiteTasks({
        suite: opts.suite,
        path: opts.path,
        taskIds: opts.taskId,
        mode: 'consensus',
      });

      const timeoutMs = Number(opts.timeout);

      await runConsensusCli({
        apiUrl,
        suiteName,
        tasks,
        models: opts.models,
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
      });
    },
  );

const strategyCmd = new Command('strategy')
  .description(
    'Run each task with N harness strategies (prompt variants) to find which ' +
      'strategies help which task types. First-passing strategy wins the task. ' +
      'Output: per-(task, strategy) pass/fail plus a per-strategy summary showing ' +
      'which strategies are most useful for which capability categories.',
  )
  .option('--suite <name>', 'suite name: fast | deep | harder | harder-v2 | hard-targeting', 'hard-targeting')
  .option(
    '--strategies <list>',
    'comma-separated strategies: default,verify-before-finish,research-first,concise,plan-then-execute',
    'default,verify-before-finish,research-first'
  )
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--timeout <ms>', 'per-strategy per-task timeout in ms', '300000')
  .option('--token-budget <n>', 'per-strategy token cap', parseInt)
  .option('--project-prefix <prefix>', 'project name prefix', 'strategy')
  .option('--provider <name>', 'override provider (e.g. minimax)')
  .option('--model <model>', 'override model (e.g. MiniMax-M3)')
  .option('--auto', 'auto-select strategies based on task classification (overrides --strategies)')
  .action(
    async (opts: {
      suite: string;
      strategies: string;
      taskId: string[];
      timeout: string;
      tokenBudget?: number;
      projectPrefix: string;
      provider?: string;
      model?: string;
      auto?: boolean;
    }) => {
      const apiUrl = getApiUrl();
      await waitForApi(apiUrl);

      const { tasks, suiteName } = await loadSuiteTasks({
        suite: opts.suite,
        taskIds: opts.taskId,
        mode: 'strategy',
      });

      const timeoutMs = Number(opts.timeout);

      await runStrategyCli({
        apiUrl,
        suiteName,
        tasks,
        strategies: opts.strategies,
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
        provider: opts.provider,
        model: opts.model,
        auto: opts.auto,
      });
    },
  );

const adversarialCmd = new Command('adversarial')
  .description('Generate adversarial test cases for a benchmark task')
  .option('--suite <name>', 'suite to pull base task from: fast | harder | hard-targeting', 'hard-targeting')
  .option('--task-id <id>', 'base task id to generate adversarial variants for (required)')
  .option('--count <n>', 'number of adversarial variants to generate', '3')
  .option('--provider <name>', 'provider for generating tests', 'deepseek')
  .option('--model <model>', 'model for generating tests', 'deepseek-v4-pro')
  .option('--output <path>', 'output JSON path')
  .action(
    async (opts: {
      suite: string;
      taskId: string;
      count: string;
      provider: string;
      model: string;
      output?: string;
    }) => {
      if (!opts.taskId) {
        throw new Error('--task-id is required');
      }

      let tasks;
      if (opts.suite === 'fast') {
        tasks = fastSuite();
      } else if (opts.suite === 'harder') {
        tasks = harderSuite();
      } else if (opts.suite === 'hard-targeting') {
        tasks = hardTargetedSuite();
      } else {
        throw new Error(`Unknown suite: ${opts.suite}`);
      }

      const baseTask = tasks.find((t) => t.id === opts.taskId);
      if (!baseTask) {
        throw new Error(`Task ${opts.taskId} not found in suite ${opts.suite}`);
      }

      const { generateAdversarialTests, saveAdversarialTasks } = await import('@omega/bench');
      const apiUrl = getApiUrl();
      await waitForApi(apiUrl);

      console.log(`Generating ${opts.count} adversarial variants for: ${baseTask.title}`);
      const adversarialTasks = await generateAdversarialTests({
        apiUrl,
        provider: opts.provider,
        model: opts.model,
        baseTask,
        count: parseInt(opts.count),
      });

      if (adversarialTasks.length === 0) {
        console.log('No adversarial tasks generated.');
        return;
      }

      const outputPath = opts.output ?? `${omegaReportsDir()}/adversarial-${opts.taskId}-${String(Date.now())}.json`;
      await saveAdversarialTasks(adversarialTasks, outputPath);

      console.log(`\nGenerated ${String(adversarialTasks.length)} adversarial tasks:`);
      for (const task of adversarialTasks) {
        console.log(`  ${task.id}: ${task.title}`);
        console.log(`    Wrong fix: ${task.wrongFixHint}`);
      }
      console.log(`\nSaved to ${outputPath}`);
    },
  );

const varianceCmd = new Command('variance')
  .description(
    'Run each task N times to measure pass-rate variance and confidence intervals. ' +
      'Identifies stable vs volatile tasks.',
  )
  .option('--suite <name>', 'suite name: fast | deep | harder | hard-targeting', 'hard-targeting')
  .option('--n-runs <n>', 'number of runs per task', '5')
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--timeout <ms>', 'per-task timeout in ms', '300000')
  .option('--token-budget <n>', 'per-task token cap', parseInt)
  .option('--project-prefix <prefix>', 'project name prefix', 'variance')
  .option('--provider <name>', 'provider to use')
  .option('--model <model>', 'model to use')
  .option('--output <path>', 'output JSON path')
  .action(
    async (opts: {
      suite: string;
      nRuns: string;
      taskId: string[];
      timeout: string;
      tokenBudget?: number;
      projectPrefix: string;
      provider?: string;
      model?: string;
      output?: string;
    }) => {
      const apiUrl = getApiUrl();
      await waitForApi(apiUrl);

      let tasks;
      if (opts.suite === 'fast') {
        tasks = fastSuite();
      } else if (opts.suite === 'deep') {
        tasks = deepSuite();
      } else if (opts.suite === 'harder') {
        tasks = harderSuite();
      } else if (opts.suite === 'hard-targeting') {
        tasks = hardTargetedSuite();
      } else {
        throw new Error(`Unknown suite: ${opts.suite}`);
      }
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }

      const nRuns = parseInt(opts.nRuns, 10);
      const timeoutMs = Number(opts.timeout);

      console.log(
        `Running ${String(tasks.length)} tasks × ${String(nRuns)} runs each`,
      );

      const report = await runVarianceEval(tasks, {
        apiUrl,
        timeoutMs,
        projectPrefix: opts.projectPrefix,
        provider: opts.provider,
        model: opts.model,
        tokenBudget: opts.tokenBudget,
        nRuns,
        onProgress: (taskId, run, result) => {
          const symbol = result.evaluation.passed ? '✓' : '✗';
          console.log(`  ${symbol} ${taskId} run ${String(run + 1)}/${String(nRuns)}`);
        },
      });

      printVarianceSummary(report);

      const reportPath = opts.output ?? `${omegaReportsDir()}/variance-${opts.suite}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const fs = await import('node:fs/promises');
      await fs.mkdir(omegaReportsDir(), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
      console.log(`\nReport written to ${reportPath}`);
    },
  );

const costCmd = new Command('cost')
  .description('Show cost-per-pass-rate analysis across providers/models')
  .option('--suite <name>', 'filter to a specific suite')
  .option('--api-url <url>', 'harness API URL')
  .action(async (opts: { suite?: string; apiUrl?: string }) => {
    const { PrismaClient } = await import('@omega/db/generated');
    const prisma = new PrismaClient();
    try {
      const results = await getCostPerPassRate(prisma, opts.suite);
      if (results.length === 0) {
        console.log('No benchmark history found. Run `omega bench run` first.');
        return;
      }
      console.log('\n=== Cost per Pass Rate ===');
      console.log(`${'Provider/Model'.padEnd(35)} ${'Runs'.padStart(5)} ${'Pass%'.padStart(6)} ${'Cost'.padStart(10)} ${'$/pass%'.padStart(10)} ${'Avg dur'.padStart(8)}`);
      console.log('-'.repeat(80));
      for (const r of results) {
        const costStr = r.totalCostUsd < 0.01 ? `$${r.totalCostUsd.toFixed(4)}` : `$${r.totalCostUsd.toFixed(2)}`;
        const cppStr = r.costPerPassPercent === Infinity ? '∞' : `$${r.costPerPassPercent.toFixed(4)}`;
        console.log(
          `${r.provider}/${r.model}`.padEnd(35) +
          String(r.totalRuns).padStart(5) +
          `${(r.passRate * 100).toFixed(0)}%`.padStart(6) +
          costStr.padStart(10) +
          cppStr.padStart(10) +
          `${(r.avgDurationMs / 1000).toFixed(1)}s`.padStart(8),
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  });

const historyCmd = new Command('history')
  .description('Show benchmark pass-rate trend over time')
  .option('--suite <name>', 'filter to a specific suite')
  .option('--provider <name>', 'filter to a specific provider')
  .option('--model <model>', 'filter to a specific model')
  .option('--last <n>', 'show only the last N entries', '10')
  .action(async (opts: { suite?: string; provider?: string; model?: string; last?: string }) => {
    const { PrismaClient } = await import('@omega/db/generated');
    const prisma = new PrismaClient();
    try {
      const limit = parseInt(opts.last ?? '10', 10);
      const trend = await getPassRateTrend(prisma, opts.suite ?? '', opts.provider, opts.model, limit);
      if (trend.length === 0) {
        console.log('No benchmark history found. Run `omega bench run` first.');
        return;
      }
      console.log('\n=== Pass Rate Trend ===');
      console.log(`${'Date'.padEnd(12)} ${'Pass%'.padStart(6)} ${'Tasks'.padStart(6)} ${'Passed'.padStart(7)} ${'Cost'.padStart(10)}`);
      console.log('-'.repeat(50));
      for (const entry of trend) {
        const date = entry.timestamp.slice(0, 10);
        const costStr = entry.totalCostUsd != null ? `$${entry.totalCostUsd.toFixed(2)}` : '-';
        console.log(
          date.padEnd(12) +
          `${(entry.passRate * 100).toFixed(0)}%`.padStart(6) +
          String(entry.totalTasks).padStart(6) +
          String(entry.passed).padStart(7) +
          costStr.padStart(10),
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  });

const serverRunCmd = new Command('server-run')
  .description('Run a benchmark suite server-side (full routing, retries, and escalation handled by the server)')
  .requiredOption('--suite <name>', 'suite name: synthetic | fast | harder | harder-v2 | hard-targeting | swebench-lite | deepswe')
  .option('--models <list>', 'comma-separated models as provider/model (e.g. "deepseek/deepseek-v4-pro,kimi/kimi-k3")')
  .option('--strategy <name>', 'strategy: single | consensus | variance', 'single')
  .option('--variance-runs <n>', 'number of runs per task (for variance strategy)', '1')
  .option('--concurrency <n>', 'max concurrent tasks', '3')
  .option('--timeout <ms>', 'per-task timeout in ms', '600000')
  .option('--token-budget <n>', 'per-task token cap', parseInt)
  .option('--n-tasks <n>', 'limit number of tasks', parseInt)
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--api-url <url>', 'harness API URL')
  .option('--swebench-dataset <path>', 'path to SWE-bench dataset JSON (for swebench-lite suite)')
  .option('--swebench-repos <list>', 'comma-separated repos to filter (e.g. "flask,requests")')
  .option('--deepswe-tasks-dir <path>', 'path to DeepSWE tasks directory (for deepswe suite)')
  .option('--deepswe-docker', 'use Docker for DeepSWE verification')
  .action(async (opts: {
    suite: string;
    models?: string;
    strategy: string;
    varianceRuns: string;
    concurrency: string;
    timeout: string;
    tokenBudget?: number;
    nTasks?: number;
    taskId: string[];
    apiUrl?: string;
    swebenchDataset?: string;
    swebenchRepos?: string;
    deepsweTasksDir?: string;
    deepsweDocker?: boolean;
  }) => {
    const apiUrl = opts.apiUrl ?? getApiUrl();
    await waitForApi(apiUrl);

    const models = opts.models
      ? opts.models.split(',').map((m) => m.trim()).filter(Boolean).map((m) => {
          if (m.includes('/')) {
            const [provider, ...rest] = m.split('/');
            return { provider: provider, model: rest.join('/') };
          }
          return { provider: 'external', model: m };
        })
      : undefined;

    // Start the run
    const res = await fetch(`${apiUrl}/bench/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suite: opts.suite,
        models,
        strategy: opts.strategy,
        varianceRuns: parseInt(opts.varianceRuns, 10),
        concurrency: parseInt(opts.concurrency, 10),
        timeoutMs: parseInt(opts.timeout, 10),
        tokenBudget: opts.tokenBudget,
        nTasks: opts.nTasks,
        taskIds: opts.taskId.length > 0 ? opts.taskId : undefined,
        swebench: opts.suite === 'swebench-lite' ? {
          datasetPath: opts.swebenchDataset,
          repos: opts.swebenchRepos?.split(',').map((r) => r.trim()).filter(Boolean),
        } : undefined,
        deepswe: opts.suite === 'deepswe' ? {
          tasksDir: opts.deepsweTasksDir ?? '',
          useDocker: opts.deepsweDocker,
        } : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      console.error(`Failed to start benchmark run: ${body.error ?? res.statusText}`);
      process.exit(1);
    }

    const { id: runId } = await res.json() as { id: string };
    console.log(`Benchmark run started: ${runId}`);
    console.log(`Suite: ${opts.suite} | Models: ${opts.models ?? 'default'} | Concurrency: ${opts.concurrency}`);
    console.log('Streaming progress...\n');

    // Subscribe to SSE stream
    const sseRes = await fetch(`${apiUrl}/bench/run/${runId}/stream`);
    if (!sseRes.ok || !sseRes.body) {
      console.error('Failed to subscribe to benchmark stream');
      process.exit(1);
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ') && eventType) {
          try {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
            handleServerRunEvent(eventType, data);
          } catch {
            // ignore parse errors
          }
          eventType = '';
        }
      }
    }

    // Fetch final state
    const finalRes = await fetch(`${apiUrl}/bench/run/${runId}`);
    if (finalRes.ok) {
      const final = await finalRes.json() as {
        passed: number;
        failed: number;
        timeouts: number;
        totalDurationMs: number;
        totalCostUsd: number | null;
        status: string;
        config: string;
      };
      console.log(`\n=== Benchmark Complete ===`);
      console.log(`Status: ${final.status}`);
      console.log(`Passed: ${String(final.passed)}/${String(final.passed + final.failed + final.timeouts)}`);
      console.log(`Duration: ${(final.totalDurationMs / 1000).toFixed(1)}s`);
      if (final.totalCostUsd != null) {
        console.log(`Cost: $${final.totalCostUsd.toFixed(2)}`);
      }
    }
  });

function handleServerRunEvent(type: string, data: Record<string, unknown>): void {
  switch (type) {
    case 'started':
      console.log(`Run started for suite: ${data.suite as string}`);
      break;
    case 'task-started':
      console.log(`  → ${data.taskName as string} [${data.model as string}]`);
      break;
    case 'task-completed': {
      const symbol = data.passed ? '✓' : '✗';
      const dur = typeof data.durationMs === 'number' ? `${(data.durationMs / 1000).toFixed(1)}s` : '';
      const winner = typeof data.winnerModel === 'string' ? ` (winner: ${data.winnerModel})` : '';
      const variance = typeof data.variancePassRate === 'number' ? ` (${(data.variancePassRate * 100).toFixed(0)}% pass rate)` : '';
      console.log(`  ${symbol} ${data.taskName as string} (${dur})${winner}${variance}`);
      break;
    }
    case 'completed': {
      const s = data.summary as { total: number; passed: number; failed: number; timeouts: number; totalDurationMs: number; winsByModel?: Record<string, number> } | undefined;
      if (s) {
        console.log(`\n  Total: ${String(s.passed)}/${String(s.total)} passed (${(s.totalDurationMs / 1000).toFixed(1)}s)`);
        if (s.winsByModel && Object.keys(s.winsByModel).length > 0) {
          console.log(`  Wins by model:`, s.winsByModel);
        }
      }
      break;
    }
    case 'failed':
      console.error(`  ✗ Run failed: ${data.error as string}`);
      break;
  }
}

export const benchCmd = new Command('bench')
  .description('Run benchmarks and optimise prompts')
  .addCommand(runCmd)
  .addCommand(serverRunCmd)
  .addCommand(evalCmd)
  .addCommand(optimiseCmd)
  .addCommand(compareCmd)
  .addCommand(trendCmd)
  .addCommand(goldenCmd)
  .addCommand(consensusCmd)
  .addCommand(strategyCmd)
  .addCommand(adversarialCmd)
  .addCommand(varianceCmd)
  .addCommand(costCmd)
  .addCommand(historyCmd);
