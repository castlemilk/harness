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
  runPierBenchmark,
  writeReport,
  printSummary,
  compareReports,
  generateTrend,
  runConsensusEval,
  runStrategyEval,
  loadOptimisationContext,
  buildOptimisePrompt,
  submitOptimiseTask,
  ensureProject,
  runModelEval,
  runHarnessEval,
  writeModelEvalReport,
  parseModelList,
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
  .option('--suite <name>', 'suite name: synthetic | fast | hard | harder | hard-targeting | deep-swe | pier', 'synthetic')
  .option('--path <dir>', 'path to DeepSWE tasks directory (for deep-swe/pier suites)')
  .option('--n-tasks <n>', 'limit number of tasks (for deep-swe/pier)', parseInt)
  .option('--sample-seed <n>', 'seed for deterministic sampling (for deep-swe/pier)', parseInt)
  .option('--task-id <id>', 'run only specific DeepSWE task(s) by id (repeatable)', collectTaskIds, [])
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
    } else if (opts.suite === 'hard-targeting') {
      tasks = hardTargetedSuite();
      if (opts.taskId.length > 0) {
        tasks = tasks.filter((t) => opts.taskId.includes(t.id));
      }
      suiteName = 'hard-targeting';
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
  .option('--suite <name>', 'suite name: synthetic | fast | deep | hard | harder | hard-targeting | deep-swe', 'deep')
  .option('--models <list>', 'comma-separated models as provider/model or model (default provider kimi)', 'kimi/moonshot-v1-128k')
  .option('--harnesses <list>', 'comma-separated external agent harnesses (codex, claude-code, agy, opencode, cursor-cli, aider) to evaluate instead of internal models')
  .option('--task-id <id>', 'run only specific task(s) by id (repeatable)', collectTaskIds, [])
  .option('--path <dir>', 'path to DeepSWE tasks directory (for hard/deep-swe suites)')
  .option('--timeout <ms>', 'per-task timeout in ms', '600000')
  .option('--token-budget <n>', 'per-task token cap', parseInt)
  .option('--project-prefix <prefix>', 'project name prefix for created harness projects', 'eval')
  .action(async (opts: {
    suite: string;
    models: string;
    harnesses?: string;
    taskId: string[];
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

      console.log(
        `Running ${String(tasks.length)} tasks across ${String(strategies.length)} strategies: ${strategies.join(', ')}`,
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

export const benchCmd = new Command('bench')
  .description('Run benchmarks and optimise prompts')
  .addCommand(runCmd)
  .addCommand(evalCmd)
  .addCommand(optimiseCmd)
  .addCommand(compareCmd)
  .addCommand(trendCmd)
  .addCommand(consensusCmd)
  .addCommand(strategyCmd);
