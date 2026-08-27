import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  boundedExecutionTimeoutMs,
  type ExecutionDeadlineOptions,
} from './project-utils.js';

const execFileAsync = promisify(execFile);

// Corepack on Node 22.9 fails pnpm/yarn signature verification and auto-pins
// an incompatible version. Use a pinned pnpm@10.18.0 via corepack for all
// agent-triggered pnpm commands.
const COREPACK_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  COREPACK_INTEGRITY_KEYS: '0',
  COREPACK_ENABLE_AUTO_PIN: '0',
};

export async function hasTsConfig(projectPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectPath, 'tsconfig.json'));
    return true;
  } catch {
    return false;
  }
}

export async function detectTsRunner(projectPath: string): Promise<'tsx' | 'ts-node' | undefined> {
  for (const runner of ['tsx', 'ts-node'] as const) {
    try {
      await execFileAsync('npx', [runner, '--version'], { cwd: projectPath, timeout: 15_000 });
      return runner;
    } catch {
      // try next
    }
  }
  return undefined;
}

export async function runTypeScriptScript(
  projectPath: string,
  script: string
): Promise<{ success: boolean; output: string }> {
  const runner = await detectTsRunner(projectPath);
  if (runner) {
    try {
      const { stdout, stderr } = await execFileAsync('npx', [runner, '-e', script], {
        cwd: projectPath,
        timeout: 30_000,
      });
      return { success: true, output: stdout + stderr };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      return {
        success: false,
        output: (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err)),
      };
    }
  }
  return { success: false, output: 'No TypeScript runner (tsx or ts-node) available.' };
}

export async function runTypeCheck(
  projectPath: string,
  options: ExecutionDeadlineOptions = {},
): Promise<{ success: boolean; output: string }> {
  if (!(await hasTsConfig(projectPath))) {
    return { success: true, output: 'No tsconfig.json; skipping TypeScript typecheck.' };
  }

  // Prefer project-specific typecheck script if it exists.
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    const typeCheckScript = pkg.scripts?.typecheck ?? pkg.scripts?.['type-check'];
    if (typeCheckScript) {
      const { stdout, stderr } = await execFileAsync('corepack', ['pnpm@10.18.0', 'run', 'typecheck'], {
        cwd: projectPath,
        timeout: boundedExecutionTimeoutMs(300_000, options),
        signal: options.signal,
        env: COREPACK_ENV,
      });
      return { success: true, output: stdout + stderr };
    }
  } catch {
    // fall through to tsc --noEmit
  }

  try {
    const { stdout, stderr } = await execFileAsync('npx', ['tsc', '--noEmit'], {
      cwd: projectPath,
      timeout: boundedExecutionTimeoutMs(300_000, options),
      signal: options.signal,
    });
    return { success: true, output: stdout + stderr };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err)),
    };
  }
}
