import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BenchmarkTask, BenchmarkEvaluation, EvaluationContext } from '../types.js';

const execFileAsync = promisify(execFile);

export interface DeepSWEOptions {
  tasksDir: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
}

interface DeepSWETaskToml {
  task?: {
    name?: string;
  };
  metadata?: {
    display_title?: string;
    display_description?: string;
    original_title?: string;
    repository_url?: string;
    base_commit_hash?: string;
    language?: string;
    task_id?: string;
  };
}

function parseToml(raw: string): DeepSWETaskToml {
  // Lightweight TOML parser sufficient for the top-level scalar fields we need.
  const result: DeepSWETaskToml = { task: {}, metadata: {} };
  let section: 'task' | 'metadata' | undefined;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      const name = trimmed.slice(1, -1).split('.')[0];
      if (name === 'task' || name === 'metadata') section = name;
      continue;
    }
    if (!section || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Remove surrounding quotes.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (section === 'task') {
      result.task ??= {};
      (result.task as Record<string, string>)[key] = value;
    } else {
      result.metadata ??= {};
      (result.metadata as Record<string, string>)[key] = value;
    }
  }
  return result;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function readTask(taskDir: string): Promise<{ toml: DeepSWETaskToml; instruction: string }> {
  const tomlRaw = await fs.readFile(path.join(taskDir, 'task.toml'), 'utf-8');
  const instructionRaw = await fs.readFile(path.join(taskDir, 'instruction.md'), 'utf-8');
  return { toml: parseToml(tomlRaw), instruction: instructionRaw };
}

async function cloneRepo(repoUrl: string, commit: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await execFileAsync('git', ['clone', repoUrl, targetPath], { timeout: 120000 });
  await execFileAsync('git', ['-C', targetPath, 'checkout', commit], { timeout: 60000 });
}

export async function loadDeepSWESuite(options: DeepSWEOptions): Promise<BenchmarkTask[]> {
  const entries = await fs.readdir(options.tasksDir, { withFileTypes: true });
  const taskDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(options.tasksDir, e.name));

  let loaded: { dir: string; toml: DeepSWETaskToml; instruction: string }[] = [];
  for (const dir of taskDirs) {
    try {
      const data = await readTask(dir);
      loaded.push({ dir, ...data });
    } catch {
      // Skip directories that don't look like DeepSWE tasks.
    }
  }

  if (options.taskIds && options.taskIds.length > 0) {
    loaded = loaded.filter((t) => {
      const id = t.toml.metadata?.task_id ?? path.basename(t.dir);
      return options.taskIds?.includes(id);
    });
  }

  if (options.nTasks && options.nTasks > 0 && options.nTasks < loaded.length) {
    const seed = options.sampleSeed ?? 0;
    const rnd = mulberry32(seed);
    loaded = loaded
      .map((t) => ({ t, sort: rnd() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, options.nTasks)
      .map((x) => x.t);
  }

  const tasks: BenchmarkTask[] = [];
  for (const { dir, toml, instruction } of loaded) {
    const id = toml.metadata?.task_id ?? path.basename(dir);
    const title = toml.metadata?.display_title ?? toml.metadata?.original_title ?? id;
    const repo = toml.metadata?.repository_url;
    const commit = toml.metadata?.base_commit_hash;

    tasks.push({
      id: `deepswe-${id}`,
      name: id,
      title,
      description: instruction,
      complexity: 'complex',
      setup: async (projectPath: string) => {
        if (!repo || !commit) {
          throw new Error(`DeepSWE task ${id} is missing repository_url or base_commit_hash`);
        }
        await cloneRepo(repo, commit, projectPath);
      },
      evaluate: (ctx: EvaluationContext): Promise<BenchmarkEvaluation> => {
        const hasDiff = ctx.diffs.length > 0 && ctx.diffs.some((d) => d.patch.trim().length > 0);
        const done = ctx.agentRun?.resultStatus === 'done';
        const passed = done && hasDiff;
        return Promise.resolve({
          passed,
          message: passed
            ? `Agent finished and produced a diff (${String(ctx.diffs[0]?.patch.length ?? 0)} chars)`
            : `Agent status=${ctx.agentRun?.resultStatus ?? 'unknown'}, diff=${hasDiff ? 'yes' : 'no'}`,
        });
      },
    });
  }
  return tasks;
}
