import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '@omega/db';
import type { AgentOptions } from '@omega/core';
import { Tracer } from './tracer.js';
import { getCurrentCommit, getDiff, getCurrentBranch, hasChanges, stageAllChanges, commit } from './git.js';
import { logger } from './logger.js';
import { spawnWithPty } from './pty-spawn.js';
import { extractOpencodeResult } from './opencode-output.js';

const execFileAsync = promisify(execFile);

export interface ExternalAgentOptions extends AgentOptions {
  /** Which external agent CLI to drive. */
  cli: ExternalCli;
  /** Timeout for the external agent run. Default 15 minutes. */
  timeoutMs?: number;
}

export type ExternalCli =
  | 'codex'
  | 'claude-code'
  | 'agy'
  | 'opencode'
  | 'cursor-cli'
  | 'aider'
  | 'gemini-cli'; // @deprecated — use 'agy'

interface CliSpec {
  command: string;
  args: (prompt: string) => string[];
  env?: NodeJS.ProcessEnv;
  /** Spawn via PTY instead of execFile. Required for CLIs that gate stdout on isatty(). */
  pty?: boolean;
  /** Post-process captured stdout before storing. */
  outputTransform?: (raw: string) => string;
}

function cliSpec(cli: ExternalCli): CliSpec {
  switch (cli) {
    case 'codex':
      return {
        command: 'codex',
        args: (prompt) => ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', prompt],
      };
    case 'claude-code':
      return {
        command: 'claude',
        args: (prompt) => ['-p', prompt],
      };
    case 'agy':
      return {
        command: 'agy',
        args: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
        pty: true,
      };
    case 'gemini-cli':
      // @deprecated — gemini-cli was retired June 2026, use agy instead
      logger.warn('gemini-cli is deprecated, use agy instead');
      return {
        command: 'agy',
        args: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
        pty: true,
      };
    case 'opencode':
      return {
        command: 'opencode',
        args: (prompt) => ['run', prompt, '--format', 'json', '--model', 'opencode/big-pickle'],
        outputTransform: extractOpencodeResult,
      };
    case 'cursor-cli':
      return {
        command: 'cursor-agent',
        args: (prompt) => ['-p', prompt],
      };
    case 'aider':
      return {
        command: 'aider',
        args: (prompt) => ['--message', prompt, '--yes'],
      };
    default:
      throw new Error(`Unsupported external cli: ${String(cli)}`);
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', cmd], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function sanitizeForDb(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code !== 0x00 && !(code >= 0x01 && code <= 0x08) && code !== 0x0b && code !== 0x0c && !(code >= 0x0e && code <= 0x1f);
    })
    .join('');
}

/**
 * Drive an external coding-agent CLI (Codex, Claude Code, agy, OpenCode,
 * Cursor CLI, Aider) to complete a task in the project. The external agent
 * edits the working tree; we capture the git diff and record it as the
 * task's result.
 */
export async function runExternalAgentTask(
  prisma: PrismaClient,
  taskId: string,
  options: ExternalAgentOptions,
): Promise<{ status: 'done' | 'failed'; diff: string; output: string }> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  const tracer = new Tracer(prisma, taskId);
  const rootSpan = tracer.startSpan('external.task');
  rootSpan.setAttributes({ cli: options.cli, project: options.projectName });

  const [baseBranch, baseCommit] = await Promise.all([
    getCurrentBranch(options.projectPath),
    getCurrentCommit(options.projectPath),
  ]);
  const branch = baseBranch.success ? baseBranch.output : `external/${taskId}`;
  const baseCommitSha = baseCommit.success ? baseCommit.output : '';

  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      branch,
      baseCommit: baseCommitSha,
      resultStatus: 'running',
    },
  });

  const spec = cliSpec(options.cli);
  const available = await commandExists(spec.command);
  if (!available) {
    const message = `External agent CLI '${spec.command}' not found in PATH`;
    await prisma.task.update({ where: { id: taskId }, data: { status: 'failed', error: message } });
    await prisma.agentRun.update({ where: { id: agentRun.id }, data: { resultStatus: 'failed' } });
    rootSpan.recordError(new Error(message));
    await rootSpan.end('error');
    return { status: 'failed', diff: '', output: message };
  }

  const prompt = [
    `Task: ${task.title}`,
    task.description ? `Description:\n${task.description}` : '',
    '',
    'Implement the task in the current repository. Make the code changes, run the project build/test command, and ensure it passes before finishing.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let output = '';
  let success = false;
  try {
    const runSpan = tracer.startSpan(`external.${options.cli}`, rootSpan.toContext());
    try {
      let stdout: string;
      let stderr: string;

      if (spec.pty) {
        // PTY path — required for CLIs that gate stdout on isatty()
        const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
        const result = await spawnWithPty(spec.command, spec.args(prompt), {
          cwd: options.projectPath,
          env: spec.env,
          timeoutMs,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        const result = await execFileAsync(spec.command, spec.args(prompt), {
          cwd: options.projectPath,
          timeout: options.timeoutMs ?? 15 * 60 * 1000,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, ...spec.env },
        });
        stdout = result.stdout;
        stderr = result.stderr;
      }

      output = `${stdout}\n${stderr}`.trim();

      // Apply output transform if present (e.g. opencode JSONL → clean text)
      if (spec.outputTransform) {
        output = spec.outputTransform(output);
      }

      success = true;
      await runSpan.end('ok');
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      output = `${e.stdout ?? ''}\n${e.stderr ?? e.message ?? String(err)}`.trim();

      // Apply output transform even on error (partial output may be useful)
      if (spec.outputTransform) {
        output = spec.outputTransform(output);
      }

      runSpan.recordError(err);
      await runSpan.end('error');
    }

    // Commit any changes the external agent left uncommitted so the diff is stable.
    if (await hasChanges(options.projectPath)) {
      await stageAllChanges(options.projectPath);
      await commit(options.projectPath, `external(${options.cli}): ${task.title}`, true);
    }

    const diff = await getDiff(options.projectPath, baseCommitSha);
    const patch = diff.output;
    const hasPatch = patch.trim().length > 0;

    if (patch) {
      await prisma.taskDiff.create({
        data: { taskId, branch, patch: sanitizeForDb(patch) ?? '' },
      });
    }

    // Benchmark tasks are evaluated by re-applying the stored patch to a clean
    // checkout (same flow as the internal agent). Reset the project so the
    // bench evaluator can apply it; keep changes for non-benchmark tasks.
    const taskTags = task.tags ? (JSON.parse(task.tags) as string[]) : [];
    if (taskTags.includes('benchmark') && baseCommitSha) {
      try {
        await execFileAsync('git', ['-C', options.projectPath, 'checkout', '-f', baseCommitSha], { timeout: 60_000 });
        await execFileAsync('git', ['-C', options.projectPath, 'clean', '-fd'], { timeout: 60_000 });
      } catch (err) {
        logger.warn('Failed to reset project after external benchmark run', {
          projectPath: options.projectPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const passed = success && hasPatch;
    const summary = passed
      ? `External agent (${options.cli}) completed the task.\n\n${output.slice(-1000)}`
      : `External agent (${options.cli}) ${success ? 'produced no changes' : 'failed'}.\n\n${output.slice(-1000)}`;

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: passed ? 'done' : 'failed',
        result: sanitizeForDb(summary),
        error: passed ? null : sanitizeForDb(summary),
        provider: options.cli,
        model: options.cli,
      },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: { resultStatus: passed ? 'done' : 'failed' },
    });
    rootSpan.setAttributes({ passed, diffBytes: patch.length });
    await rootSpan.end(passed ? 'ok' : 'error');
    logger.info('External agent task finished', { taskId, cli: options.cli, passed });
    return { status: passed ? 'done' : 'failed', diff: patch, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootSpan.recordError(err);
    await rootSpan.end('error');
    await prisma.task.update({ where: { id: taskId }, data: { status: 'failed', error: sanitizeForDb(message) } });
    await prisma.agentRun.update({ where: { id: agentRun.id }, data: { resultStatus: 'failed' } });
    return { status: 'failed', diff: '', output: message };
  }
}
