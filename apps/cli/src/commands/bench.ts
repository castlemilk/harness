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
  loadDeepSWESuite,
  runPierBenchmark,
  writeReport,
  printSummary,
  compareReports,
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
  .option('--suite <name>', 'suite name: synthetic | fast | hard | deep-swe | pier', 'synthetic')
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
  .option('--suite <name>', 'suite name: synthetic | fast | deep | hard | deep-swe', 'deep')
  .option('--models <list>', 'comma-separated models as provider/model or model (default provider kimi)', 'kimi/moonshot-v1-128k')
  .option('--harnesses <list>', 'comma-separated external agent harnesses (codex, claude-code, gemini-cli, opencode, cursor-cli, aider) to evaluate instead of internal models')
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

export const benchCmd = new Command('bench')
  .description('Run benchmarks and optimise prompts')
  .addCommand(runCmd)
  .addCommand(evalCmd)
  .addCommand(optimiseCmd)
  .addCommand(compareCmd);
