/**
 * SWE-bench Lite adapter: loads tasks from the SWE-bench Lite dataset,
 * clones repos at base commits, and verifies fixes by running FAIL_TO_PASS tests.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BenchmarkTask, BenchmarkEvaluation, EvaluationContext } from '../types.js';

const execFileAsync = promisify(execFile);

export interface SWebenchOptions {
  datasetPath: string;
  nTasks?: number;
  sampleSeed?: number;
  taskIds?: string[];
  repos?: string[];
  timeoutMs?: number;
}

interface SWebenchTask {
  repo: string;
  instance_id: string;
  base_commit: string;
  patch: string;
  test_patch: string;
  problem_statement: string;
  hints_text: string;
  created_at: string;
  version: string;
  FAIL_TO_PASS: string;
  PASS_TO_PASS: string;
  environment_setup_commit: string;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CACHE_DIR = path.join(process.env.HOME ?? '~', '.omega', 'cache', 'swebench-repos');

async function cloneRepo(repo: string, commit: string, targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const repoUrl = `https://github.com/${repo}.git`;
  const cacheName = `${repo.replace('/', '_')}.git`;
  const cachePath = path.join(CACHE_DIR, cacheName);

  // Use cached bare repo if available, otherwise clone and cache
  if (!(await fs.access(cachePath).then(() => true, () => false))) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await execFileAsync('git', ['clone', '--bare', repoUrl, cachePath], { timeout: 300000 });
  }

  // Clone from cache (instant local copy)
  await execFileAsync('git', ['clone', cachePath, targetPath], { timeout: 60000 });
  await execFileAsync('git', ['-C', targetPath, 'checkout', commit], { timeout: 60000 });
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeout ?? 600000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exitCode: e.code ?? 1,
    };
  }
}

function parseTestIds(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];
  let ids: string[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) ids = parsed.map(String);
    else return [];
  } catch {
    ids = raw.split('\n').filter(Boolean);
  }
  // Convert SWE-bench format "test_name (module.Class)" to pytest format "path/to/file.py::Class::test_name"
  return ids.map((id) => {
    const m = /^(\w+)\s*\(([^)]+)\)$/.exec(id);
    if (m) {
      const [, testFunc, testClass] = m;
      // Convert module.Class to path/file.py::Class::testFunc
      const parts = testClass.split('.');
      if (parts.length >= 2) {
        const modulePath = parts.slice(0, -1).join('/');
        const className = parts[parts.length - 1];
        return `${modulePath}.py::${className}::${testFunc}`;
      }
    }
    // Already in pytest format or unknown format — pass through
    return id;
  });
}

async function installPythonDeps(projectPath: string): Promise<string> {
  const has = (f: string) => fs.access(path.join(projectPath, f)).then(() => true, () => false);
  const venvPath = path.join(projectPath, '.venv');
  const pipBin = path.join(venvPath, 'bin', 'pip');
  const pythonBin = path.join(venvPath, 'bin', 'python');

  const candidates = ['python3.12', 'python3.11', 'python3.10', 'python3'];
  let pythonCmd = '';
  for (const c of candidates) {
    const check = await runCommand('which', [c], { timeout: 5000 });
    if (check.exitCode === 0) { pythonCmd = c; break; }
  }
  if (!pythonCmd) throw new Error('No Python interpreter found');

  await fs.rm(venvPath, { recursive: true, force: true }).catch(() => undefined);
  await runCommand(pythonCmd, ['-m', 'venv', venvPath], { cwd: projectPath, timeout: 120000 });
  await runCommand(pipBin, ['install', '--upgrade', 'pip'], { cwd: projectPath, timeout: 120000 }).catch(() => undefined);
  await runCommand(pipBin, ['install', 'setuptools'], { cwd: projectPath, timeout: 120000 }).catch(() => undefined);

  if (await has('pyproject.toml') || await has('setup.py')) {
    const r = await runCommand(pipBin, ['install', '-e', '.'], { cwd: projectPath, timeout: 600000 });
    if (r.exitCode !== 0) {
      console.warn(`[swebench] pip install -e . failed: ${r.stderr.slice(-300)}`);
      await runCommand(pipBin, ['install', '.'], { cwd: projectPath, timeout: 600000 }).catch(() => undefined);
    }
  }
  if (await has('requirements.txt')) {
    await runCommand(pipBin, ['install', '-r', 'requirements.txt'], { cwd: projectPath, timeout: 600000 }).catch(() => undefined);
  }

  await runCommand(pipBin, ['install', 'pytest'], { cwd: projectPath, timeout: 120000 }).catch(() => undefined);

  return pythonBin;
}

async function findTestFile(projectPath: string, relativePath: string): Promise<string | null> {
  const candidates = [
    relativePath,
    `tests/${relativePath}`,
    `test/${relativePath}`,
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(projectPath, candidate));
      return candidate;
    } catch { /* empty */ }
  }
  // Search for the file
  const fileName = path.basename(relativePath);
  try {
    const result = await runCommand('find', [projectPath, '-name', fileName, '-type', 'f'], { timeout: 10000 });
    if (result.exitCode === 0 && result.stdout.trim()) {
      const first = result.stdout.trim().split('\n')[0];
      return path.relative(projectPath, first);
    }
  } catch { /* empty */ }
  return null;
}

async function runF2PTests(
  projectPath: string,
  pythonBin: string,
  testIds: string[]
): Promise<{ passed: boolean; output: string; passedCount: number; failedCount: number }> {
  if (testIds.length === 0) {
    return { passed: true, output: 'No FAIL_TO_PASS tests', passedCount: 0, failedCount: 0 };
  }

  // Resolve test file paths
  const resolvedIds: string[] = [];
  for (const id of testIds) {
    const parts = id.split('::');
    if (parts.length >= 2 && parts[0].endsWith('.py')) {
      const filePath = parts[0];
      const resolved = await findTestFile(projectPath, filePath);
      if (resolved) {
        resolvedIds.push([resolved, ...parts.slice(1)].join('::'));
      } else {
        resolvedIds.push(id);
      }
    } else {
      resolvedIds.push(id);
    }
  }

  const args = ['-m', 'pytest', '-x', '-v', '--tb=short', '--no-header', '-q', ...resolvedIds];
  const result = await runCommand(pythonBin, args, {
    cwd: projectPath,
    timeout: 300000,
    env: { PYTHONPATH: projectPath, PYTHONDONTWRITEBYTECODE: '1' },
  });

  const output = `${result.stdout}\n${result.stderr}`;
  const passedMatch = /(\d+) passed/.exec(output);
  const failedMatch = /(\d+) failed/.exec(output);
  const errorMatch = /(\d+) error/.exec(output);
  const passedCount = passedMatch ? parseInt(passedMatch[1]) : 0;
  const failedCount = (failedMatch ? parseInt(failedMatch[1]) : 0) + (errorMatch ? parseInt(errorMatch[1]) : 0);

  return {
    passed: result.exitCode === 0 && failedCount === 0,
    output: output.slice(-4096),
    passedCount,
    failedCount,
  };
}

async function runP2PTests(
  projectPath: string,
  pythonBin: string,
  testIds: string[]
): Promise<{ passed: boolean; output: string }> {
  if (testIds.length === 0) return { passed: true, output: 'No PASS_TO_PASS tests' };

  // Resolve test file paths
  const resolvedIds: string[] = [];
  for (const id of testIds) {
    const parts = id.split('::');
    if (parts.length >= 2 && parts[0].endsWith('.py')) {
      const filePath = parts[0];
      const resolved = await findTestFile(projectPath, filePath);
      if (resolved) {
        resolvedIds.push([resolved, ...parts.slice(1)].join('::'));
      } else {
        resolvedIds.push(id);
      }
    } else {
      resolvedIds.push(id);
    }
  }

  const args = ['-m', 'pytest', '-v', '--tb=short', '--no-header', '-q', ...resolvedIds];
  const result = await runCommand(pythonBin, args, {
    cwd: projectPath,
    timeout: 300000,
    env: { PYTHONPATH: projectPath, PYTHONDONTWRITEBYTECODE: '1' },
  });

  const output = `${result.stdout}\n${result.stderr}`;
  return {
    passed: result.exitCode === 0,
    output: output.slice(-4096),
  };
}

function buildDescription(task: SWebenchTask): string {
  return `Repository: ${task.repo}
Base commit: ${task.base_commit}
Version: ${task.version || 'unknown'}

## Problem Statement

${task.problem_statement}

${task.hints_text ? `\n## Hints\n\n${task.hints_text}` : ''}

## Instructions

1. Understand the issue described above
2. Find the relevant code in the repository using search/list_files/read_file
3. Implement a fix that resolves the issue
4. Ensure your fix does not break existing tests
5. Run the test suite to verify your changes

## Build/Run Commands

This is a Python project. Use:
- Install deps: pip install -e . (or pip install -r requirements.txt)
- Run tests: python -m pytest <test_files>
- Run specific test: python -m pytest path/to/test.py::test_name

SCOPE CONSTRAINT: Only edit source files directly related to the issue. Do NOT modify test files, CI configs, documentation, or build configs unless absolutely necessary.`;
}

export async function loadSWebenchLiteSuite(options: SWebenchOptions): Promise<BenchmarkTask[]> {
  const raw = await fs.readFile(options.datasetPath, 'utf-8');
  const allTasks = JSON.parse(raw) as SWebenchTask[];

  let tasks = allTasks;

  if (options.taskIds && options.taskIds.length > 0) {
    const ids = options.taskIds;
    tasks = tasks.filter((t) => ids.includes(t.instance_id));
  }
  if (options.repos && options.repos.length > 0) {
    const repos = options.repos;
    tasks = tasks.filter((t) => repos.includes(t.repo));
  }
  if (options.nTasks && options.nTasks > 0 && options.nTasks < tasks.length) {
    const seed = options.sampleSeed ?? 0;
    const rnd = mulberry32(seed);
    tasks = tasks
      .map((t) => ({ t, sort: rnd() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, options.nTasks)
      .map((x) => x.t);
  }

  const benchmarkTasks: BenchmarkTask[] = [];

  for (const task of tasks) {
    const failToPass = parseTestIds(task.FAIL_TO_PASS);
    const passToPass = parseTestIds(task.PASS_TO_PASS);
    const testPatch = task.test_patch;

    benchmarkTasks.push({
      id: `swebench-${task.instance_id}`,
      name: task.instance_id,
      title: `${task.repo} — ${task.problem_statement.split('\n')[0].slice(0, 80)}`,
      description: buildDescription(task),
      complexity: 'medium',
      tags: [task.repo, task.instance_id],
      setup: async (projectPath: string) => {
        await cloneRepo(task.repo, task.base_commit, projectPath);

        await installPythonDeps(projectPath);

        if (testPatch && testPatch.trim().length > 0) {
          const patchFile = path.join(projectPath, '.swebench-test-patch.patch');
          await fs.writeFile(patchFile, testPatch, 'utf-8');
          await runCommand('git', ['-C', projectPath, 'apply', '--check', patchFile], { timeout: 30000 }).catch(() => undefined);
          await runCommand('git', ['-C', projectPath, 'apply', patchFile], { timeout: 30000 }).catch(() => undefined);
          await fs.rm(patchFile, { force: true });
        }

        const gitignorePath = path.join(projectPath, '.gitignore');
        try {
          const existing = await fs.readFile(gitignorePath, 'utf-8');
          if (!existing.includes('.venv/')) {
            await fs.writeFile(gitignorePath, `${existing}\n.venv/\n`, 'utf-8');
          }
        } catch {
          await fs.writeFile(gitignorePath, '.venv/\n', 'utf-8');
        }
      },
      evaluate: async (ctx: EvaluationContext): Promise<BenchmarkEvaluation> => {
        const venvPath = path.join(ctx.projectPath, '.venv');
        const pythonBin = path.join(venvPath, 'bin', 'python');
        let pythonExists = false;
        try { await fs.access(pythonBin); pythonExists = true; } catch { /* empty */ }

        const finalPython = pythonExists ? pythonBin : 'python3';

        const f2pResult = await runF2PTests(ctx.projectPath, finalPython, failToPass);
        const p2pResult = await runP2PTests(ctx.projectPath, finalPython, passToPass.slice(0, 50));

        const passed = f2pResult.passed && p2pResult.passed;

        return {
          passed,
          score: passed ? 1 : f2pResult.passedCount / (f2pResult.passedCount + f2pResult.failedCount),
          message: passed
            ? `SWE-bench verified: f2p ${String(f2pResult.passedCount)}/${String(failToPass.length)} passed, p2p ${p2pResult.passed ? 'ok' : 'fail'}`
            : `SWE-bench failed: f2p ${String(f2pResult.passedCount)}/${String(failToPass.length)} passed (${String(f2pResult.failedCount)} failed), p2p ${p2pResult.passed ? 'ok' : 'fail'}`,
          metrics: {
            f2p_passed: f2pResult.passedCount,
            f2p_failed: f2pResult.failedCount,
            f2p_total: failToPass.length,
            p2p_passed: p2pResult.passed ? 1 : 0,
            f2p_output: f2pResult.output.slice(-2048),
            p2p_output: p2pResult.output.slice(-2048),
          },
        };
      },
    });
  }

  return benchmarkTasks;
}
