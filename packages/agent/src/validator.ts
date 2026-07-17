import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface ValidationSummary {
  lint: { passed: boolean; output: string };
  test: { passed: boolean; output: string };
  build: { passed: boolean; output: string };
  allPassed: boolean;
}

async function runStep(
  projectPath: string,
  command: string,
  args: string[]
): Promise<{ passed: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: projectPath,
      timeout: 300_000,
    });
    return { passed: true, output: stdout + stderr };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
    return { passed: false, output };
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
    return { command: 'pnpm', installArgs: ['install', '--prefer-offline'] };
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

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', cmd], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function validateNodeProject(projectPath: string): Promise<ValidationSummary> {
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
    if (await commandExists(pm.command)) {
      await runStep(projectPath, pm.command, pm.installArgs);
    }
  }

  // npm requires the `run` subcommand for custom scripts; pnpm/yarn accept the
  // script name directly.
  const scriptArgs = (script: string): string[] =>
    pm.command === 'npm' && script !== 'test' ? ['run', script] : [script];

  const lint = (await fileHasScript(projectPath, 'lint'))
    ? await runStep(projectPath, pm.command, scriptArgs('lint'))
    : pass();
  const test = (await fileHasScript(projectPath, 'test'))
    ? await runStep(projectPath, pm.command, scriptArgs('test'))
    : pass();
  const build = (await fileHasScript(projectPath, 'build'))
    ? await runStep(projectPath, pm.command, scriptArgs('build'))
    : pass();

  return { lint, test, build, allPassed: lint.passed && test.passed && build.passed };
}

function pass(): { passed: boolean; output: string } {
  return { passed: true, output: 'skipped (no script or project marker)' };
}

export async function validateProject(projectPath: string): Promise<ValidationSummary> {
  const hasPackageJson = await pathExists(path.join(projectPath, 'package.json'));
  if (hasPackageJson) {
    return validateNodeProject(projectPath);
  }

  // Non-Node projects: we currently do not impose a validation harness. Future
  // work can add pytest, go test, cargo test, etc.
  return { lint: pass(), test: pass(), build: pass(), allPassed: true };
}
