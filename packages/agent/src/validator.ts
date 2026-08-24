import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  boundedExecutionTimeoutMs,
  type ExecutionDeadlineOptions,
} from './project-utils.js';

const execFileAsync = promisify(execFile);
const MIN_VALIDATION_STEP_TIMEOUT_MS = 60_000;

export interface ValidationSummary {
  lint: { passed: boolean; output: string };
  test: { passed: boolean; output: string };
  build: { passed: boolean; output: string };
  allPassed: boolean;
}

const COREPACK_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  COREPACK_INTEGRITY_KEYS: '0',
  COREPACK_ENABLE_AUTO_PIN: '0',
};

async function runStep(
  projectPath: string,
  command: string,
  args: string[],
  options: ExecutionDeadlineOptions,
): Promise<{ passed: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: projectPath,
      timeout: Math.max(
        MIN_VALIDATION_STEP_TIMEOUT_MS,
        boundedExecutionTimeoutMs(300_000, options),
      ),
      signal: options.signal,
      env: command === 'corepack' ? COREPACK_ENV : undefined,
    });
    return { passed: true, output: stdout + stderr };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
    return { passed: false, output };
  }
}

function isDeadlineAbort(options: ExecutionDeadlineOptions): boolean {
  return options.deadlineMs !== undefined
    && options.signal?.reason instanceof DOMException
    && options.signal.reason.name === 'TimeoutError';
}

function throwIfCallerCancelled(options: ExecutionDeadlineOptions): void {
  if (!options.signal?.aborted || isDeadlineAbort(options)) return;
  throw options.signal.reason instanceof Error
    ? options.signal.reason
    : new DOMException('Operation aborted', 'AbortError');
}

/**
 * Keep explicit caller cancellation abortable while allowing validation's
 * minimum budget to outlive the agent's ordinary wall-clock deadline.
 */
function validationExecutionOptions(options: ExecutionDeadlineOptions): {
  options: ExecutionDeadlineOptions;
  dispose: () => void;
} {
  if (!options.signal) return { options, dispose: () => undefined };

  const controller = new AbortController();
  const forwardCallerCancellation = (): void => {
    if (!isDeadlineAbort(options)) controller.abort(options.signal?.reason);
  };
  if (options.signal.aborted) {
    forwardCallerCancellation();
  } else {
    options.signal.addEventListener('abort', forwardCallerCancellation, { once: true });
  }

  return {
    options: { ...options, signal: controller.signal },
    dispose: () => options.signal?.removeEventListener('abort', forwardCallerCancellation),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileHasScript(projectPath: string, script: string): Promise<boolean> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    const value = pkg.scripts?.[script];
    return typeof value === 'string' && value.length > 0 && value !== `echo "Error: no ${script} specified"`;
  } catch {
    return false;
  }
}

async function detectNodePm(projectPath: string): Promise<{ command: string; installArgs: string[] } | undefined> {
  if (await pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
    // Corepack on Node 22.9 fails pnpm signature verification; pin a
    // compatible version for agent-triggered installs.
    return { command: 'corepack', installArgs: ['pnpm@10.18.0', 'install', '--prefer-offline'] };
  }
  if (await pathExists(path.join(projectPath, 'yarn.lock'))) {
    return { command: 'yarn', installArgs: ['install'] };
  }
  if (await pathExists(path.join(projectPath, 'package.json'))) {
    return { command: 'npm', installArgs: ['install'] };
  }
  return undefined;
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

async function commandExists(cmd: string, options: ExecutionDeadlineOptions): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', cmd], {
      // Floored for the same reason `runStep` is: past the deadline an
      // unfloored budget collapses to 1ms, and this probe silently reporting
      // "missing" makes the whole dependency install get skipped.
      timeout: Math.max(5_000, boundedExecutionTimeoutMs(10_000, options)),
      signal: options.signal,
    });
    return true;
  } catch {
    return false;
  }
}

async function validateNodeProject(
  projectPath: string,
  options: ExecutionDeadlineOptions,
): Promise<ValidationSummary> {
  const pm = await detectNodePm(projectPath);
  if (!pm) {
    // No package.json — nothing to validate.
    return { lint: pass(), test: pass(), build: pass(), allPassed: true };
  }

  // Ensure dependencies are present before validating, but only when the
  // project actually declares them. Installing in a zero-dependency project
  // creates untracked files (package-lock, node_modules) that break patch
  // validation during finish.
  if (
    !(await pathExists(path.join(projectPath, 'node_modules'))) &&
    (await packageHasDependencies(projectPath))
  ) {
    if (await commandExists(pm.command, options)) {
      await runStep(projectPath, pm.command, pm.installArgs, options);
    }
  }

  // npm requires the `run` subcommand for custom scripts; pnpm/yarn accept the
  // script name directly. Corepack pnpm needs the version prefix.
  const scriptArgs = (script: string): string[] => {
    if (pm.command === 'corepack') {
      return ['pnpm@10.18.0', script];
    }
    if (pm.command === 'npm' && script !== 'test') {
      return ['run', script];
    }
    return [script];
  };

  const lint = (await fileHasScript(projectPath, 'lint'))
    ? await runStep(projectPath, pm.command, scriptArgs('lint'), options)
    : pass();
  const test = (await fileHasScript(projectPath, 'test'))
    ? await runStep(projectPath, pm.command, scriptArgs('test'), options)
    : pass();
  const build = (await fileHasScript(projectPath, 'build'))
    ? await runStep(projectPath, pm.command, scriptArgs('build'), options)
    : pass();

  return { lint, test, build, allPassed: lint.passed && test.passed && build.passed };
}

function pass(): { passed: boolean; output: string } {
  return { passed: true, output: 'skipped (no script or project marker)' };
}

export async function validateProject(
  projectPath: string,
  options: ExecutionDeadlineOptions = {},
): Promise<ValidationSummary> {
  throwIfCallerCancelled(options);
  const managedOptions = validationExecutionOptions(options);
  try {
    const hasPackageJson = await pathExists(path.join(projectPath, 'package.json'));
    // Non-Node projects currently have no imposed validation harness. Future
    // work can add pytest, go test, cargo test, and similar checks here.
    const summary = hasPackageJson
      ? await validateNodeProject(projectPath, managedOptions.options)
      : { lint: pass(), test: pass(), build: pass(), allPassed: true };
    throwIfCallerCancelled(options);
    return summary;
  } finally {
    managedOptions.dispose();
  }
}
