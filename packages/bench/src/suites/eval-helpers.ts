import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationContext, BenchmarkEvaluation } from '../types.js';

const execFileAsync = promisify(execFile);

export function applyLatestPatch(): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const patch = ctx.diffs
      .slice()
      .reverse()
      .find((d) => typeof d.patch === 'string' && d.patch.length > 0)?.patch;
    if (!patch) {
      return { passed: false, message: 'No diff patch available to evaluate' };
    }
    const tmp = path.join(ctx.projectPath, '.bench-apply.patch');
    await fs.writeFile(tmp, patch.endsWith('\n') ? patch : `${patch}\n`, 'utf-8');
    try {
      // Try strict apply first (fast, catches real conflicts).
      await execFileAsync('git', ['apply', '--whitespace=nowarn', tmp], { cwd: ctx.projectPath, timeout: 10_000 });
      return { passed: true, message: 'Applied model patch' };
    } catch {
      // Fallback: --3way uses merge-based application which is more forgiving
      // when the working tree has drifted slightly from the patch context.
      try {
        await execFileAsync('git', ['apply', '--3way', '--whitespace=nowarn', tmp], { cwd: ctx.projectPath, timeout: 10_000 });
        return { passed: true, message: 'Applied model patch (3way)' };
      } catch (err) {
        const e = err as { stderr?: string; message?: string };
        return { passed: false, message: `Failed to apply patch: ${e.stderr ?? e.message ?? 'unknown'}` };
      }
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  };
}

export async function runScript(ctx: EvaluationContext, script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [script], { cwd: ctx.projectPath, timeout: 10_000 });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', exitCode: e.code ?? 1 };
  }
}

export function expectScriptOutput(script: string, text: string): (ctx: EvaluationContext) => Promise<BenchmarkEvaluation> {
  return async (ctx) => {
    const { stdout, stderr, exitCode } = await runScript(ctx, script);
    const out = `${stdout}\n${stderr}`;
    if (exitCode !== 0) {
      return { passed: false, message: `${script} exited ${String(exitCode)}: ${out.trim() || '(no output)'}` };
    }
    const found = out.includes(text);
    return {
      passed: found,
      message: found ? `${script} passed` : `${script} output missing "${text}"`,
    };
  };
}
