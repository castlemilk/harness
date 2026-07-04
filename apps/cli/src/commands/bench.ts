import { Command } from 'commander';
import path from 'node:path';
import {
  runBenchmark,
  syntheticSuite,
  loadDeepSWESuite,
  writeReport,
  printSummary,
  loadOptimisationContext,
  buildOptimisePrompt,
  submitOptimiseTask,
  ensureProject,
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
  .option('--suite <name>', 'suite name: synthetic | deep-swe', 'synthetic')
  .option('--path <dir>', 'path to DeepSWE tasks directory (for deep-swe suite)')
  .option('--n-tasks <n>', 'limit number of tasks (for deep-swe)', parseInt)
  .option('--sample-seed <n>', 'seed for deterministic sampling (for deep-swe)', parseInt)
  .option('--timeout <ms>', 'per-task timeout in ms', '120000')
  .option('--output-dir <dir>', 'report output directory', '.omega/reports')
  .option('--provider <name>', 'provider to use for benchmark tasks')
  .option('--model <model>', 'model to use for benchmark tasks')
  .option('--docker', 'run DeepSWE verifiers in Docker (required for most Node.js tasks)')
  .action(async (opts: {
    suite: string;
    path?: string;
    nTasks?: number;
    sampleSeed?: number;
    timeout: string;
    outputDir: string;
    provider?: string;
    model?: string;
    docker?: boolean;
  }) => {
    const apiUrl = getApiUrl();
    await waitForApi(apiUrl);

    const timeoutMs = Number(opts.timeout);
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
        useDocker: opts.docker,
      });
      suiteName = 'deep-swe';
    } else if (opts.suite === 'synthetic') {
      tasks = syntheticSuite();
      suiteName = 'synthetic';
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
      provider: opts.provider,
      model: opts.model,
      onProgress: (result) => {
        const symbol = result.evaluation.passed ? '✓' : '✗';
        console.log(`${symbol} ${result.task.name} [${result.status}] ${String(result.durationMs)}ms`);
      },
    });

    const reportFile = await writeReport(report, opts.outputDir);
    printSummary(report);
    console.log(`\nReport written to ${reportFile}`);
  });

const optimiseCmd = new Command('optimise')
  .description('Create a self-improve task from the latest benchmark report')
  .option('--output-dir <dir>', 'report output directory', '.omega/reports')
  .action(async (opts: { outputDir: string }) => {
    const apiUrl = getApiUrl();
    await waitForApi(apiUrl);

    const context = await loadOptimisationContext(apiUrl, opts.outputDir);
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

export const benchCmd = new Command('bench')
  .description('Run benchmarks and optimise prompts')
  .addCommand(runCmd)
  .addCommand(optimiseCmd);
