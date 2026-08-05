import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Task } from '@omega/core';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export { execFileAsync };

export function maxStepsForComplexity(complexity: string | undefined): number {
  switch (complexity) {
    case 'simple':
      return 60;
    case 'medium':
      return 180;
    case 'complex':
      return 350;
    default:
      return 120;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function tryInstall(cmd: string, args: string[], cwd: string, timeoutMs: number, label: string): Promise<void> {
  try {
    logger.info(`Installing ${label} dependencies in worktree`, { cwd, command: `${cmd} ${args.join(' ')}` });
    await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      env: {
        ...process.env,
        COREPACK_INTEGRITY_KEYS: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
      },
    });
  } catch (err) {
    logger.warn(`${label} dependency install failed`, {
      cwd,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', cmd], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function nodeDependenciesInstalled(projectPath: string): Promise<boolean> {
  if (await pathExists(path.join(projectPath, 'node_modules'))) return true;
  if (await pathExists(path.join(projectPath, '.pnp.cjs'))) return true;
  return false;
}

async function packageHasDependencies(projectPath: string): Promise<boolean> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const section = pkg[key];
      if (section && typeof section === 'object' && Object.keys(section).length > 0) {
        return true;
      }
    }
  } catch {
    // ignore malformed package.json
  }
  return false;
}

export async function installWorktreeDependencies(projectPath: string): Promise<void> {
  const hasDenoConfig =
    (await pathExists(path.join(projectPath, 'deno.json'))) ||
    (await pathExists(path.join(projectPath, 'deno.jsonc')));
  const hasNodePackage =
    (await pathExists(path.join(projectPath, 'package.json'))) ||
    (await pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) ||
    (await pathExists(path.join(projectPath, 'package-lock.json'))) ||
    (await pathExists(path.join(projectPath, 'yarn.lock')));
  if (hasDenoConfig && !hasNodePackage) {
    return;
  }
  const hasPackageJson = await pathExists(path.join(projectPath, 'package.json'));
  if (hasPackageJson) {
    if (await nodeDependenciesInstalled(projectPath)) return;

    const needsDependencies = await packageHasDependencies(projectPath);
    if (!needsDependencies) {
      return;
    }

    const attempts: string[] = [];
    const hasPnpmLock = await pathExists(path.join(projectPath, 'pnpm-lock.yaml'));
    const hasYarnLock = await pathExists(path.join(projectPath, 'yarn.lock'));

    let packageManager = '';
    try {
      const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as { packageManager?: string };
      packageManager = pkg.packageManager ?? '';
    } catch {
      // ignore malformed package.json
    }

    if (hasPnpmLock) {
      if (await commandExists('corepack')) {
        await tryInstall('corepack', ['pnpm@10.18.0', 'install', '--prefer-offline'], projectPath, 300_000, 'node (corepack pnpm)');
        attempts.push('corepack pnpm@10.18.0 install');
        if (await nodeDependenciesInstalled(projectPath)) return;
      } else if (await commandExists('pnpm')) {
        await tryInstall('pnpm', ['install', '--prefer-offline'], projectPath, 300_000, 'node (pnpm)');
        attempts.push('pnpm install');
        if (await nodeDependenciesInstalled(projectPath)) return;
      }
    }

    if (hasYarnLock) {
      if (/^yarn@[2-9]/.test(packageManager) && (await commandExists('corepack'))) {
        await tryInstall('corepack', ['yarn', 'install'], projectPath, 300_000, 'node (corepack yarn)');
        attempts.push('corepack yarn install');
        if (await nodeDependenciesInstalled(projectPath)) return;
      }
      if (await commandExists('yarn')) {
        await tryInstall('yarn', ['install'], projectPath, 300_000, 'node (yarn)');
        attempts.push('yarn install');
        if (await nodeDependenciesInstalled(projectPath)) return;
        await tryInstall('yarn', ['install', '--ignore-scripts'], projectPath, 300_000, 'node (yarn ignore-scripts)');
        attempts.push('yarn install --ignore-scripts');
        if (await nodeDependenciesInstalled(projectPath)) return;
      }
    }

    if (!hasPnpmLock && !hasYarnLock) {
      await tryInstall('npm', ['ci'], projectPath, 300_000, 'node (npm)');
      attempts.push('npm ci');
      if (await nodeDependenciesInstalled(projectPath)) return;
    }
    await tryInstall('npm', ['install'], projectPath, 300_000, 'node (npm)');
    attempts.push('npm install');
    if (await nodeDependenciesInstalled(projectPath)) return;
    await tryInstall('npm', ['install', '--ignore-scripts'], projectPath, 300_000, 'node (npm ignore-scripts)');
    attempts.push('npm install --ignore-scripts');
    if (await nodeDependenciesInstalled(projectPath)) return;

    throw new Error(`Dependency install failed: node_modules is missing after attempts: ${attempts.join(', ')}`);
  }

  const hasPyproject = await pathExists(path.join(projectPath, 'pyproject.toml'));
  const hasSetupPy = await pathExists(path.join(projectPath, 'setup.py'));
  const hasRequirements = await pathExists(path.join(projectPath, 'requirements.txt'));
  if (hasPyproject || hasSetupPy || hasRequirements) {
    const systemPy = (await pathExists('/opt/homebrew/bin/python3')) || (await pathExists('/usr/bin/python3')) ? 'python3' : 'python';
    const venvPath = path.join(projectPath, '.venv');
    const venvPython = path.join(venvPath, 'bin', 'python');
    const venvExists = await pathExists(venvPython);
    if (!venvExists) {
      await tryInstall(systemPy, ['-m', 'venv', '.venv'], projectPath, 120_000, 'python (venv)');
      if (!(await pathExists(venvPython))) {
        if (hasRequirements) {
          await tryInstall(systemPy, ['-m', 'pip', 'install', '--break-system-packages', '-r', 'requirements.txt'], projectPath, 300_000, 'python (requirements fallback)');
        }
        if (hasPyproject || hasSetupPy) {
          await tryInstall(systemPy, ['-m', 'pip', 'install', '--break-system-packages', '-e', '.'], projectPath, 300_000, 'python (editable fallback)');
        }
        return;
      }
    }
    if (hasRequirements) {
      await tryInstall(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], projectPath, 300_000, 'python (requirements)');
    }
    if (hasPyproject || hasSetupPy) {
      await tryInstall(venvPython, ['-m', 'pip', 'install', '-e', '.'], projectPath, 300_000, 'python (editable)');
    }
    return;
  }

  if (await pathExists(path.join(projectPath, 'Cargo.toml'))) {
    await tryInstall('cargo', ['fetch'], projectPath, 300_000, 'rust');
    return;
  }

  if (await pathExists(path.join(projectPath, 'go.mod'))) {
    await tryInstall('go', ['mod', 'download'], projectPath, 180_000, 'go');
  }
}

export function deadlineMsForComplexity(complexity: string | undefined): number {
  switch (complexity) {
    case 'simple': return 5 * 60_000;
    case 'medium': return 15 * 60_000;
    case 'complex': return 90 * 60_000;
    default: return 10 * 60_000;
  }
}

export function explorationBudgetForComplexity(complexity: string | undefined): { beforeFirstEdit: number; betweenEdits: number } {
  switch (complexity) {
    case 'simple': return { beforeFirstEdit: 8, betweenEdits: 4 };
    case 'medium': return { beforeFirstEdit: 12, betweenEdits: 6 };
    case 'complex': return { beforeFirstEdit: 20, betweenEdits: 8 };
    default: return { beforeFirstEdit: 10, betweenEdits: 5 };
  }
}

export function taskMentionsPublicApi(task: Task): boolean {
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase();
  return /\b(public api|api surface|method[ -]?signature|export[ -]?function|interface|type export)\b/.test(text);
}

export function taskLikelyHasTests(task: Task, skillContext?: string): boolean {
  const text = `${task.title} ${task.description ?? ''} ${skillContext ?? ''}`.toLowerCase();
  return /\b(test|spec|assert|should |verify)\b/.test(text);
}

export async function projectHasTestableArtifacts(projectPath: string): Promise<boolean> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as Record<string, Record<string, string>>;
    const scripts = pkg.scripts;
    return Object.values(scripts).some((s) => looksLikeTestCommand(s));
  } catch {
    return false;
  }
}

const TEST_COMMAND_PATTERNS = [
  /\btest\b/,
  /\bvitest\b/,
  /\bjest\b/,
  /\bmocha\b/,
  /\bava\b/,
  /\btape\b/,
  /\bnode --test\b/,
  /\brun test\b/,
  /\bnpm test\b/,
  /\bpytest\b/,
  /\bcargo test\b/,
  /\bgo test\b/,
  /\brace\b/,
];

export function looksLikeTestCommand(command: string): boolean {
  return TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

async function packageManagerPrefix(projectPath: string, pkg: { packageManager?: string }): Promise<string> {
  if (await pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await pathExists(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  const pm = pkg.packageManager ?? '';
  if (pm.startsWith('pnpm')) return 'pnpm';
  if (pm.startsWith('yarn')) return 'yarn';
  return 'npm';
}

export async function deriveVerificationCommand(projectPath: string): Promise<string | undefined> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string>; packageManager?: string };
    const scripts = pkg.scripts ?? {};
    const manager = await packageManagerPrefix(projectPath, pkg);
    const steps: string[] = [];
    if (typeof scripts.build === 'string' && scripts.build.trim()) {
      steps.push(manager === 'npm' ? 'npm run build' : `${manager} build`);
    }
    if (typeof scripts.test === 'string' && scripts.test.trim()) {
      steps.push(`${manager} test`);
    }
    if (steps.length > 0) return steps.join(' && ');
  } catch {
    // ignore malformed package.json
  }

  if (await pathExists(path.join(projectPath, 'Cargo.toml'))) return 'cargo test';
  if (await pathExists(path.join(projectPath, 'go.mod'))) return 'go test ./...';
  if (await pathExists(path.join(projectPath, 'pyproject.toml'))) return 'python3 -m pytest -q';

  return undefined;
}

export function toCoreTask(row: {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  complexity: string;
  tags: string | null;
  provider: string | null;
  model: string | null;
  result: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as Task['status'],
    complexity: row.complexity as Task['complexity'],
    tags: row.tags ? JSON.parse(row.tags) as string[] : [],
    assignedModel: row.provider && row.model ? { provider: row.provider, model: row.model } : undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function isTypeScriptProject(projectPath: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises');
    await fs.access(path.join(projectPath, 'tsconfig.json'));
    return true;
  } catch {
    return false;
  }
}

export function isInsideProject(projectPath: string, target: string): boolean {
  const root = path.resolve(projectPath);
  return target === root || target.startsWith(root + path.sep);
}

const FORBIDDEN_WRITE_PATTERNS = [
  /\/(test|tests)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /^(test|tests)\//,
  /[/](test|tests)$/i,
];

export function isForbiddenWritePath(filePath: string): boolean {
  return FORBIDDEN_WRITE_PATTERNS.some((pattern) => pattern.test(filePath));
}
