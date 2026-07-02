import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, output: message };
  }
}

export async function validateProject(projectPath: string): Promise<ValidationSummary> {
  const lint = await runStep(projectPath, 'pnpm', ['lint']);
  const test = await runStep(projectPath, 'pnpm', ['test']);
  const build = await runStep(projectPath, 'pnpm', ['build']);

  return {
    lint,
    test,
    build,
    allPassed: lint.passed && test.passed && build.passed,
  };
}
