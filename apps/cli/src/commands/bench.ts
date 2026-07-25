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
  harderV2Suite,
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
  runVarianceEval,
  printVarianceSummary,
  saveBenchmarkHistory,
  getCostPerPassRate,
  getPassRateTrend,
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

const runCmd = new Command('run')
  .description('Run a benchmark suite')
  .option('--suite <name>', 'suite name: synthetic | fast | hard | harder | harder-v2 | hard-targeting | deep-swe | swebench-lite | pier', 'synthetic')
  .option('--path <dir>', 'path to DeepSWE tasks directory (for deep-swe/pier) or SWE-bench JSON file (for swebench-lite)')
  .option('--n-tasks <n>', 'limit number of tasks (for deep-swe/pier/swebench-lite)', parseInt)
  .option('--sample-seed <n>', 'seed for deterministic sampling (for deep-swe/pier/swebench-lite)', parseInt)
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--repo <repo>', 'filter to specific repo (for swebench-lite, repeatable)', collectTaskIds, [])
  .option('--timeout <ms>', 'per-task timeout in ms', '1800000')
  .option('--output-dir <dir>', 'report output directory')
  .option('--project-prefix <prefix>', 'project name prefix for created harness projects', 'bench')
  .option('--provider <name>', 'provider to use for benchmark tasks')
  .option('--model <model>', 'model to use for benchmark tasks')
  .option('--docker', 'run DeepSWE verifiers in Docker (required for most Node.js tasks)')
  .option('--token-budget <n>', 'per-task token cap; abort agent loop if exceeded', parseInt)
  .option('--agent <name>', 'Pier agent to use (e.g. mini-swe-agent)', 'mini-swe-agent')
  .option('--env-file <file>', 'Pier env file with API credentials')
  .option('--jobs-dir <dir>', 'Pier jobs directory')
  .option('--n-concurrent <n>', 'Pier concurrent trials', parseInt)
  .option('--pier-extra <arg>', 'extra Pier CLI arg (repeatable)', collectTaskIds, [])
  .option('--baseline <file>', 'compare against a baseline report after run; exit non-zero on regression')
  .option('--fail-on-regression', 'exit with code 1 if pass rate drops vs baseline (used with --baseline)')
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
  }) => {
    const timeoutMs = Number(opts.timeout);
    const outputDir = opts.outputDir ?? omegaReportsDir();

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

    let tasks;
    let suiteName: string;

    if (opts.suite === 'deep-swe') {
      if (!opts.path) {
        throw new Error('--path is required for the deep-swe suite');
      }
      tasks = await loadDeepSWESuite({
        tasksDir: opts.path,
        nTasks: opts.nTasks,
        sampleSeed: opts.sampleSeed,
        taskIds: opts.taskId.length > 0 ? opts.taskId : undefined,
        useDocker: opts.docker,
      });
      suiteName = 'deep-swe';
    } else if (opts.suite === 'synthetic') {
      tasks = syntheticSuite();
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }
      suiteName = 'synthetic';
    } else if (opts.suite === 'fast') {
      tasks = fastSuite();
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }
      suiteName = 'fast';
    } else if (opts.suite === 'hard') {
      if (!opts.path) {
        throw new Error('--path is required for the hard suite');
      }
      tasks = await hardSuite(opts.path);
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }
      suiteName = 'hard';
    } else if (opts.suite === 'harder') {
      tasks = harderSuite();
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }
      suiteName = 'harder';
    } else if (opts.suite === 'harder-v2') {
      tasks = harderV2Suite();
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }
      suiteName = 'harder-v2';
    } else if (opts.suite === 'hard-targeting') {
      tasks = hardTargetedSuite();
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }
      suiteName = 'hard-targeting';
    } else if (opts.suite === 'swebench-lite') {
      if (!opts.path) {
        throw new Error('--path is required for the swebench-lite suite (path to JSON file)');
      }
      tasks = await loadSWebenchLiteSuite({
        datasetPath: path.resolve(opts.path),
        nTasks: opts.nTasks,
        sampleSeed: opts.sampleSeed,
        taskIds: opts.taskId.length > 0 ? opts.taskId : undefined,
        repos: opts.repo.length > 0 ? opts.repo : undefined,
      });
      suiteName = 'swebench-lite';
    } else {
      throw new Error(`Unknown suite: ${opts.suite}`);
    }

    if (tasks.length === 0) {
      console.log('No benchmark tasks to run.');
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
        console.log(`${symbol} ${result.task.name} [${result.status}] ${String(result.durationMs)}ms`);
      },
    });

    const reportFile = await writeReport(report, outputDir);
    printSummary(report);
    console.log(`\nReport written to ${reportFile}`);

    // Persist to benchmark history for cost-per-pass-rate tracking.
    try {
      const { PrismaClient } = await import('@omega/db');
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
      const text = await compareReports({ baseline: opts.baseline, candidate: reportFile });
      console.log('\n' + text);
      if (opts.failOnRegression) {
        const baselineReport = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(opts.baseline!, 'utf-8'))) as { passed: number; total: number };
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
        const { PrismaClient } = await import('@omega/db');
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
      const { PrismaClient } = await import('@omega/db');
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

const consensusCmd = new Command('consensus')
  .description(
    'Run multiple agents in parallel on each task and pick the first passing patch (best-of-N by eval). ' +
      'Pass rate = fraction of tasks where ANY agent succeeded. ' +
      'Cost = sum across all agents.',
  )
  .option('--suite <name>', 'suite name: fast | deep | harder | hard-targeting | hard', 'harder')
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

      let tasks;
      if (opts.suite === 'fast') {
        tasks = fastSuite();
      } else if (opts.suite === 'deep') {
        tasks = deepSuite();
      } else if (opts.suite === 'harder') {
        tasks = harderSuite();
      } else if (opts.suite === 'hard-targeting') {
        tasks = hardTargetedSuite();
      } else if (opts.suite === 'hard') {
        if (!opts.path) throw new Error('--path is required for the hard suite');
        tasks = await hardSuite(opts.path);
      } else {
        throw new Error(`Unknown suite: ${opts.suite}`);
      }
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
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

      const timeoutMs = Number(opts.timeout);

      console.log(
        `Running ${String(tasks.length)} tasks across ${String(models.length)} agents in parallel: ${models.map((m) => `${m.provider}/${m.model}`).join(', ')}`,
      );

      const results = await runConsensusEval(tasks, {
        apiUrl,
        models,
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
        suiteName: opts.suite,
        onTaskProgress: (taskId, report) => {
          const winner = report.winner
            ? `winner: ${report.winner.provider}/${report.winner.model}`
            : 'no winner';
          console.log(
            `  ${report.passed ? '✓' : '✗'} ${taskId} (${report.candidates.length} candidates, ${winner})`,
          );
        },
      });

      const reportFile = await writeModelEvalReport(results, opts.suite);
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
        const { PrismaClient } = await import('@omega/db');
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
    },
  );

const strategyCmd = new Command('strategy')
  .description(
    'Run each task with N harness strategies (prompt variants) to find which ' +
      'strategies help which task types. First-passing strategy wins the task. ' +
      'Output: per-(task, strategy) pass/fail plus a per-strategy summary showing ' +
      'which strategies are most useful for which capability categories.',
  )
  .option('--suite <name>', 'suite name: fast | deep | harder | hard-targeting', 'hard-targeting')
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

      const strategies = opts.strategies.split(',').map((s) => s.trim()).filter(Boolean) as Array<
        'default' | 'verify-before-finish' | 'research-first' | 'concise' | 'plan-then-execute'
      >;
      const timeoutMs = Number(opts.timeout);
      const autoStrategies = opts.auto ?? false;

      console.log(
        autoStrategies
          ? `Running ${String(tasks.length)} tasks with auto-selected strategies`
          : `Running ${String(tasks.length)} tasks across ${String(strategies.length)} strategies: ${strategies.join(', ')}`,
      );

      const result = await runStrategyEval(tasks, {
        apiUrl,
        strategies,
        timeoutMs,
        tokenBudget: opts.tokenBudget,
        projectPrefix: opts.projectPrefix,
        provider: opts.provider,
        model: opts.model,
        suiteName: opts.suite,
        autoStrategies,
        onProgress: (taskId, report) => {
          const w = report.winner ?? 'none';
          console.log(
            `  ${report.passed ? '✓' : '✗'} ${taskId} (${String(report.candidates.length)} strategies, winner: ${w})`,
          );
        },
      });

      console.log(
        `\nUnion pass rate: ${result.summary.unionPassRate.toFixed(0)}% (${result.tasks.filter((r) => r.passed).length}/${result.tasks.length})`,
      );
      console.log(`\nPer-strategy pass rate:`);
      for (const [name, s] of Object.entries(result.summary.perStrategy)) {
        console.log(
          `  ${name.padEnd(24)} ${s.passes}/${s.runs} (${(s.passRate * 100).toFixed(0)}%)  avg ${Math.round(s.avgDurationMs / 1000)}s`,
        );
      }
      console.log(`\nWins by strategy:`, result.summary.winsByStrategy);

      // Analyze failures from traces.
      const insights = analyseFailures(result.tasks);
      if (insights.length > 0) {
        console.log(`\n--- Failure Analysis (${insights.length} tasks failed across all strategies) ---`);
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
      const reportPath = `${omegaReportsDir()}/strategy-${opts.suite}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const fs = await import('node:fs/promises');
      await fs.mkdir(omegaReportsDir(), { recursive: true });
      await fs.writeFile(
        reportPath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            suite: opts.suite,
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

      const outputPath = opts.output ?? `${omegaReportsDir()}/adversarial-${opts.taskId}-${Date.now()}.json`;
      await saveAdversarialTasks(adversarialTasks, outputPath);

      console.log(`\nGenerated ${adversarialTasks.length} adversarial tasks:`);
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
    const { PrismaClient } = await import('@omega/db');
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
    const { PrismaClient } = await import('@omega/db');
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

export const benchCmd = new Command('bench')
  .description('Run benchmarks and optimise prompts')
  .addCommand(runCmd)
  .addCommand(evalCmd)
  .addCommand(optimiseCmd)
  .addCommand(compareCmd)
  .addCommand(trendCmd)
  .addCommand(consensusCmd)
  .addCommand(strategyCmd)
  .addCommand(adversarialCmd)
  .addCommand(varianceCmd)
  .addCommand(costCmd)
  .addCommand(historyCmd);
