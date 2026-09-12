import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SampleTest {
  input: string;
  output: string;
}

export interface SampleTestSummary {
  ran: boolean;
  passed: number;
  total: number;
  fail?: { input: string; expected: string; got: string };
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function runSampleTests(
  workspaceDir: string,
  tests: SampleTest[] | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<SampleTestSummary> {
  const total = tests?.length ?? 0;
  if (!tests || total === 0) return { ran: false, passed: 0, total: 0 };

  const solutionPath = path.join(workspaceDir, 'solution.py');
  try {
    const stat = await fs.stat(solutionPath);
    if (!stat.isFile()) return { ran: false, passed: 0, total: 0 };
  } catch {
    return { ran: false, passed: 0, total: 0 };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let passed = 0;
  for (const test of tests) {
    const input = test.input;
    const expected = test.output;
    const got = await runOne(solutionPath, input, timeoutMs);
    if (got === expected.trim()) {
      passed += 1;
      continue;
    }
    return {
      ran: true,
      passed,
      total,
      fail: { input, expected, got },
    };
  }
  return { ran: true, passed, total };
}

function runOne(solutionPath: string, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn('python3', [solutionPath], { stdio: ['pipe', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const finish = (got: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(got);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      finish(`<runtime error: ${error.message.slice(0, 200)}>`);
    });
    child.on('close', (code: number | null) => {
      if (timedOut) {
        finish('<timed out (>10s)>');
      } else if (code !== 0 && !stdout.trim()) {
        finish(`<runtime error: ${stderr.slice(0, 200)}>`);
      } else {
        finish(stdout.trim());
      }
    });
    child.stdin.on('error', () => {
      child.stdin.destroy();
    });
    child.stdin.end(input);
  });
}

export function samplePassFeedback(total: number): string {
  return `[SAMPLE TESTS: PASSED all ${String(total)} public samples -- the solution looks correct.] `;
}

export function sampleFailFeedback(
  passed: number,
  total: number,
  fail: { input: string; expected: string; got: string },
): string {
  return `[SAMPLE TESTS: FAILED -- passed ${String(passed)}/${String(total)}. The current solution is WRONG. First failing case: input=${JSON.stringify(fail.input)} expected=${JSON.stringify(fail.expected)} got=${JSON.stringify(fail.got)}. Fix the bug or, if this approach keeps failing, switch to a DIFFERENT approach.] `;
}