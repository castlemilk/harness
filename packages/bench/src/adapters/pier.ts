import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { omegaJobsDir } from '@omega/core';
import type { BenchmarkTask, BenchmarkEvaluation, BenchmarkResult, BenchmarkReport } from '../types.js';

export interface PierOptions {
  tasksDir: string;
  agent?: string;
  model?: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  jobsDir?: string;
  envFile?: string;
  nConcurrent?: number;
  timeoutMs?: number;
  extraArgs?: string[];
}

interface PierResultJson {
  id: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  n_total_trials: number;
  stats: {
    n_completed_trials: number;
    n_errored_trials: number;
    n_running_trials: number;
    n_pending_trials: number;
    n_cancelled_trials: number;
    n_retries: number;
    evals: Record<string, unknown>;
    n_input_tokens: number | null;
    n_cache_tokens: number | null;
    n_output_tokens: number | null;
    cost_usd: number | null;
  };
}

interface RewardJson {
  reward?: number;
  f2p?: number;
  f2p_total?: number;
  f2p_passed?: number;
  p2p?: number;
  p2p_total?: number;
  p2p_passed?: number;
  partial?: number;
  apply_failed?: boolean;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function listTaskDirs(tasksDir: string): Promise<string[]> {
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(tasksDir, e.name))
    .sort();
}

async function readTaskToml(taskDir: string): Promise<Record<string, string | undefined>> {
  const raw = await fs.readFile(path.join(taskDir, 'task.toml'), 'utf-8');
  const meta: Record<string, string | undefined> = {};
  let section: string | undefined;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      section = trimmed.slice(1, -1).split('.')[0];
      continue;
    }
    if (!section || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (section === 'metadata' || section === 'task') {
      meta[key] = value;
    }
  }
  return meta;
}

function sampleTasks(taskDirs: string[], n: number, seed: number): string[] {
  const rand = mulberry32(seed);
  const shuffled = [...taskDirs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

function pierArgs(opts: PierOptions, taskPath: string): string[] {
  const args = [
    'run',
    '-p',
    taskPath,
    '--agent',
    opts.agent ?? 'mini-swe-agent',
    '--model',
    opts.model ?? 'openai/glm-5.2',
    '-y',
  ];
  if (opts.jobsDir) args.push('--jobs-dir', opts.jobsDir);
  if (opts.envFile) args.push('--env-file', opts.envFile);
  if (opts.nConcurrent !== undefined) args.push('--n-concurrent', String(opts.nConcurrent));
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

async function waitForPierDone(jobsDir: string, timeoutMs: number): Promise<PierResultJson> {
  const start = Date.now();
  const resultPath = path.join(jobsDir, 'result.json');
  while (Date.now() - start <= timeoutMs) {
    try {
      const raw = await fs.readFile(resultPath, 'utf-8');
      const result = JSON.parse(raw) as PierResultJson;
      if (result.finished_at) return result;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Pier job in ${jobsDir} timed out after ${String(timeoutMs)}ms`);
}

async function runPierForTask(taskDir: string, opts: PierOptions): Promise<{ reward: RewardJson; trajectory: string; jobDir: string }> {
  const resolvedTaskDir = path.resolve(taskDir);
  const taskName = path.basename(resolvedTaskDir);
  const jobTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jobsDir =
    opts.jobsDir ?? path.join(omegaJobsDir(), `pier-${jobTimestamp}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(jobsDir, { recursive: true });

  const args = pierArgs(opts, resolvedTaskDir);
  const proc = spawn('pier', args, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const timeoutMs = opts.timeoutMs ?? 3600000;
  const started = Date.now();
  let exited = false;
  const killTimer = setTimeout(() => {
    proc.kill('SIGTERM');
    // Escalate to SIGKILL if the process ignores SIGTERM.
    setTimeout(() => {
      if (!exited) proc.kill('SIGKILL');
    }, 10_000).unref();
  }, timeoutMs);

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn pier: ${err.message}`));
    });
    proc.on('close', (code) => {
      exited = true;
      resolve(code ?? 1);
    });
  });
  clearTimeout(killTimer);

  if (exitCode !== 0) {
    throw new Error(`Pier failed for ${taskName} (exit ${String(exitCode)}):\n${stderr}\n${stdout}`);
  }

  const elapsed = Date.now() - started;
  await waitForPierDone(jobsDir, Math.max(timeoutMs - elapsed, 30_000));
  const trialDirs = await fs.readdir(jobsDir, { withFileTypes: true });
  const trialDir = trialDirs.find((e) => e.isDirectory() && e.name.startsWith(taskName));
  if (!trialDir) {
    throw new Error(`No trial directory found for ${taskName} in ${jobsDir}`);
  }
  const trialPath = path.join(jobsDir, trialDir.name);

  let reward: RewardJson = {};
  try {
    const rewardRaw = await fs.readFile(path.join(trialPath, 'verifier', 'reward.json'), 'utf-8');
    reward = JSON.parse(rewardRaw) as RewardJson;
  } catch {
    // reward file missing -> score 0
  }

  let trajectory = '';
  try {
    trajectory = await fs.readFile(path.join(trialPath, 'agent', 'trajectory.json'), 'utf-8');
  } catch {
    // trajectory missing
  }

  return { reward, trajectory, jobDir: jobsDir };
}

export async function loadPierSuite(options: PierOptions): Promise<BenchmarkTask[]> {
  const { tasksDir, nTasks, sampleSeed = 0, taskIds } = options;
  const resolvedTasksDir = path.resolve(tasksDir);
  let taskDirs = await listTaskDirs(resolvedTasksDir);
  if (taskIds && taskIds.length > 0) {
    const selected = new Set(taskIds);
    taskDirs = taskDirs.filter((d) => selected.has(path.basename(d)));
  } else if (nTasks !== undefined && nTasks > 0 && nTasks < taskDirs.length) {
    taskDirs = sampleTasks(taskDirs, nTasks, sampleSeed);
  }

  const tasks: BenchmarkTask[] = [];
  for (const taskDir of taskDirs) {
    const meta = await readTaskToml(taskDir);
    const id = path.basename(taskDir);
    const title = meta.display_title ?? meta.name ?? id;

    tasks.push({
      id,
      name: title,
      title,
      complexity: 'complex',
      setup: async () => {
        // Pier handles repo setup itself.
      },
      evaluate: async (): Promise<BenchmarkEvaluation> => {
        const { reward } = await runPierForTask(taskDir, options);
        // DeepSWE scoring is all-or-nothing: reward is 1 only when every
        // fail-to-pass test passes. Partial credit does not count as a pass.
        const passed = reward.reward === 1;
        return {
          passed,
          score: reward.reward ?? 0,
          message: passed ? 'Pier verifier passed' : 'Pier verifier failed',
          metrics: {
            reward: reward.reward ?? 0,
            f2p: reward.f2p ?? 0,
            f2p_total: reward.f2p_total ?? 0,
            p2p: reward.p2p ?? 0,
            p2p_total: reward.p2p_total ?? 0,
            partial: reward.partial ?? 0,
            apply_failed: reward.apply_failed ? 1 : 0,
          },
        };
      },
    });
  }
  return tasks;
}

export async function runPierBenchmark(options: PierOptions & { suiteName?: string }): Promise<BenchmarkReport> {
  const tasks = await loadPierSuite(options);
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    suite: options.suiteName ?? 'pier',
    total: tasks.length,
    passed: 0,
    failed: 0,
    timeouts: 0,
    totalDurationMs: 0,
    results: [],
  };

  for (const task of tasks) {
    const start = Date.now();
    let status: BenchmarkResult['status'] = 'failed';
    let evaluation: BenchmarkEvaluation = { passed: false, message: 'Task did not complete' };
    let result: BenchmarkResult | null = null;

    try {
      evaluation = await task.evaluate({
        apiUrl: '',
        taskId: '',
        projectPath: '',
        projectId: '',
        diffs: [],
      });
      status = evaluation.passed ? 'done' : 'failed';
    } catch (err) {
      evaluation = {
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const durationMs = Date.now() - start;
    result = {
      task,
      harnessTaskId: '',
      durationMs,
      status,
      evaluation,
      spanCount: 0,
    };

    if (evaluation.passed) report.passed++;
    else report.failed++;

    report.totalDurationMs += durationMs;
    report.results.push(result);
  }

  return report;
}
