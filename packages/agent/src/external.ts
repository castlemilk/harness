import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '@omega/db';
import type { AgentOptions } from '@omega/core';
import { Tracer } from './tracer.js';
import { getCurrentCommit, getDiff, getCurrentBranch, hasChanges, stageAllChanges, commit } from './git.js';
import { logger } from './logger.js';
import { spawnWithPty } from './pty-spawn.js';
import { extractOpencodeResult, opencodeRunLooksAborted, parseOpencodeMetrics } from './opencode-output.js';
import { parseClaudeCodeStreamJson } from './claude-code-output.js';
import { parseAgyMetrics } from './agy-output.js';
import { runCodexTurn, getCodexAvailability, type CodexTurnResult } from './codex-driver.js';
import { buildCodexTaskPrompt } from './codex-prompt.js';
import { deriveVerificationCommand } from './project-utils.js';
import { sanitizeForDb } from './utils.js';

const execFileAsync = promisify(execFile);

const CODEX_PHASES = ['investigating', 'editing', 'running', 'verifying', 'finalizing'] as const;
type CodexPhase = (typeof CODEX_PHASES)[number];
type CodexPhaseTimings = Partial<Record<CodexPhase, number>>;

interface CodexTimingMetrics {
  turnDurationMs: number;
  phaseTimings: CodexPhaseTimings;
}

interface CodexTimingTracker {
  turnStartedAt: number;
  activePhase?: { name: CodexPhase; startedAt: number };
  phaseTimings: CodexPhaseTimings;
}

function isCodexPhase(phase: string | null | undefined): phase is CodexPhase {
  return typeof phase === 'string' && (CODEX_PHASES as readonly string[]).includes(phase);
}

function addCodexPhaseDuration(tracker: CodexTimingTracker, endedAt: number): void {
  const activePhase = tracker.activePhase;
  if (!activePhase) return;

  const duration = Math.max(0, endedAt - activePhase.startedAt);
  tracker.phaseTimings[activePhase.name] = (tracker.phaseTimings[activePhase.name] ?? 0) + duration;
}

function recordCodexPhaseTransition(
  tracker: CodexTimingTracker,
  phase: string | null | undefined,
  timestamp: number,
): void {
  if (!isCodexPhase(phase) || tracker.activePhase?.name === phase) return;

  addCodexPhaseDuration(tracker, timestamp);
  tracker.activePhase = { name: phase, startedAt: timestamp };
}

function finishCodexTiming(tracker: CodexTimingTracker, turnEndedAt: number): CodexTimingMetrics {
  addCodexPhaseDuration(tracker, turnEndedAt);
  tracker.activePhase = undefined;
  return {
    turnDurationMs: Math.max(0, turnEndedAt - tracker.turnStartedAt),
    phaseTimings: tracker.phaseTimings,
  };
}

/**
 * Spawn a process with stdin closed and capture stdout/stderr.
 * Required for CLIs like `opencode run` that read stdin interactively
 * and would otherwise hang forever waiting for TUI input.
 */
function spawnWithStdinClosed(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => outChunks.push(d));
    child.stderr?.on('data', (d: Buffer) => errChunks.push(d));

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 5_000);
    }, options.timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        exitCode: code ?? 1,
      });
    });
  });
}

function buildAgentRunMetricsUpdate(
  spec: CliSpec,
  output: string
): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  turnCount?: number;
  toolCalls?: string;
  turnDurationMs?: number;
  phaseTimings?: string;
} {
  if (!spec.metricsParser) return {};
  try {
    const m = spec.metricsParser(output);
    return {
      promptTokens: m.inputTokens,
      completionTokens: m.outputTokens,
      totalTokens: m.totalTokens,
      costUsd: m.costUsd,
      turnCount: m.turns,
      toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : undefined,
      turnDurationMs: m.turnDurationMs,
      phaseTimings: m.phaseTimings ? JSON.stringify(m.phaseTimings) : undefined,
    };
  } catch (err) {
    logger.warn('External agent metrics parser failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

/**
 * Best-effort trace write: the narrative is diagnostics, and diagnostics must
 * never fail the run they describe (including under partial prisma mocks).
 */
async function tryTrace(
  prisma: PrismaClient,
  taskId: string,
  role: 'assistant' | 'system',
  content: string,
): Promise<void> {
  try {
    await prisma.taskTrace.create({ data: { taskId, role, content } });
  } catch (err) {
    logger.warn('Could not record external agent trace', {
      taskId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ExternalAgentOptions extends AgentOptions {
  /** Which external agent CLI to drive. */
  cli: ExternalCli;
  /** Timeout for the external agent run. Default: adaptive by complexity. */
  timeoutMs?: number;
  /** Model for the codex app-server driver. Default: codex global config default. */
  model?: string | null;
  /** Reasoning effort for the codex app-server driver. */
  effort?: string | null;
}

function timeoutForComplexity(complexity: string | undefined): number {
  switch (complexity) {
    case 'simple': return 5 * 60_000;
    case 'medium': return 15 * 60_000;
    case 'complex': return 30 * 60_000;
    default: return 10 * 60_000;
  }
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
  args: (prompt: string, cwd?: string) => string[];
  env?: NodeJS.ProcessEnv;
  /** Spawn via PTY instead of execFile. Required for CLIs that gate stdout on isatty(). */
  pty?: boolean;
  /** Post-process captured stdout before storing. */
  outputTransform?: (raw: string) => string;
  /** Extract structured metrics (tokens, cost, tool calls, turns) from stdout. */
  metricsParser?: (raw: string) => ExtractedMetrics;
}

interface ExtractedMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  turns?: number;
  toolCalls?: Record<string, number>;
  turnDurationMs?: number;
  phaseTimings?: Record<string, number>;
}

function parseCodexMetrics(raw: string): ExtractedMetrics {
  const envelope = JSON.parse(raw) as {
    turns?: number;
    commandCount?: number;
    fileChangeCount?: number;
    turnDurationMs?: number;
    phaseTimings?: Record<string, number>;
  };
  const toolCalls: Record<string, number> = {};
  if (envelope.commandCount) toolCalls.command = envelope.commandCount;
  if (envelope.fileChangeCount) toolCalls.fileChange = envelope.fileChangeCount;
  const phaseTimings = envelope.phaseTimings && typeof envelope.phaseTimings === 'object'
    ? Object.fromEntries(
      Object.entries(envelope.phaseTimings).filter(([, duration]) => typeof duration === 'number' && Number.isFinite(duration)),
    )
    : undefined;
  return {
    turns: envelope.turns,
    toolCalls: Object.keys(toolCalls).length > 0 ? toolCalls : undefined,
    turnDurationMs: typeof envelope.turnDurationMs === 'number' ? envelope.turnDurationMs : undefined,
    phaseTimings,
  };
}

function cliSpec(cli: ExternalCli, model?: string): CliSpec {
  switch (cli) {
    case 'codex':
      return {
        command: 'codex',
        args: (prompt) => ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', prompt],
        metricsParser: parseCodexMetrics,
      };
    case 'claude-code':
      return {
        command: 'claude',
        // Model is caller-selectable (Task.model / options.model); absent
        // keeps the CLI's own default, exactly as before.
        args: (prompt) => [
          '-p', prompt,
          '--output-format', 'stream-json',
          '--verbose',
          ...(model ? ['--model', model] : []),
        ],
        pty: true,
        metricsParser: parseClaudeCodeStreamJson,
      };
    case 'agy':
      return {
        command: 'agy',
        // JSON print mode so the run's token usage comes back with it; without
        // it agy prints prose only and the run records no usage at all.
        args: (prompt, cwd) => [
          '-p', prompt,
          '--output-format', 'json',
          '--dangerously-skip-permissions',
          ...(cwd ? ['--add-dir', cwd] : []),
        ],
        pty: true,
        metricsParser: parseAgyMetrics,
      };
    case 'gemini-cli':
      // @deprecated — gemini-cli was retired June 2026, use agy instead
      logger.warn('gemini-cli is deprecated, use agy instead');
      return {
        command: 'agy',
        args: (prompt, cwd) => [
          '-p', prompt,
          '--output-format', 'json',
          '--dangerously-skip-permissions',
          ...(cwd ? ['--add-dir', cwd] : []),
        ],
        metricsParser: parseAgyMetrics,
        pty: true,
      };
    case 'opencode':
      // opencode `run` forks a headless server that stays running after the
      // prompt completes, causing the parent to hang until timeout. The eval
      // runner's poll-based timeout will eventually catch and report this.
      return {
        command: 'opencode',
        // Model is caller-selectable (Task.model / options.model); big-pickle
        // stays the default so existing runs keep their behaviour.
        args: (prompt, cwd) => ['run', prompt, '--format', 'json', '--model', model ?? 'opencode/big-pickle', '--auto', '--port', String(4096 + Math.floor(Math.random() * 1000)), ...(cwd ? ['--dir', cwd] : [])],
        outputTransform: extractOpencodeResult,
        metricsParser: parseOpencodeMetrics,
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
      currentTurn: 1,
    },
  });

  const spec = cliSpec(options.cli, options.model ?? undefined);
  const available = await commandExists(spec.command);
  if (!available) {
    const message = `External agent CLI '${spec.command}' not found in PATH`;
    await prisma.task.update({ where: { id: taskId }, data: { status: 'failed', error: message } });
    await prisma.agentRun.update({ where: { id: agentRun.id }, data: { resultStatus: 'failed' } });
    rootSpan.recordError(new Error(message));
    await rootSpan.end('error');
    return { status: 'failed', diff: '', output: message };
  }

  const codexDriverAvailable = options.cli === 'codex' ? (await getCodexAvailability()).available : false;

  const prompt = [
    `Task: ${task.title}`,
    task.description ? `Description:\n${task.description}` : '',
    '',
    'Implement the task in the current repository. Make the code changes, run the project build/test command, and ensure it passes before finishing.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let codexPrompt = '';
  if (options.cli === 'codex') {
    const verificationCommand = await deriveVerificationCommand(options.projectPath);
    codexPrompt = buildCodexTaskPrompt({
      title: task.title,
      description: task.description ?? undefined,
      verificationCommand,
    });
  }

  let output = '';
  let success = false;
  let rawOutput = '';
  let codexTiming: CodexTimingMetrics | undefined;
  try {
    const runSpan = tracer.startSpan(`external.${options.cli}`, rootSpan.toContext());
    try {
      if (options.cli === 'codex' && codexDriverAvailable) {
        const timingTracker: CodexTimingTracker = {
          turnStartedAt: Date.now(),
          phaseTimings: {},
        };
        let result: CodexTurnResult;
        try {
          result = await runCodexTurn(options.projectPath, codexPrompt, {
            timeoutMs: options.timeoutMs ?? timeoutForComplexity(options.complexity),
            threadName: `task:${taskId} ${task.title}`.slice(0, 96),
            model: options.model,
            effort: options.effort,
            onProgress: (message, phase) => {
              runSpan.addEvent('codex.progress', { message, phase: phase ?? undefined });
              const prev = timingTracker.activePhase?.name;
              recordCodexPhaseTransition(timingTracker, phase, Date.now());
              logger.debug(`codex: ${message}`, { taskId, phase: phase ?? undefined });

              if (isCodexPhase(phase) && prev !== phase) {
                void prisma.agentRun.update({
                  where: { id: agentRun.id },
                  data: { currentPhase: phase, currentPhaseStartedAt: new Date() },
                }).catch((err: unknown) => {
                  logger.warn(
                    `Failed to record codex phase: ${err instanceof Error ? err.message : String(err)}`,
                    { taskId },
                  );
                });
              }
            },
          });
        } finally {
          codexTiming = finishCodexTiming(timingTracker, Date.now());
          runSpan.setAttributes({ ...codexTiming });
        }
        success = result.status === 'completed';
        output = result.finalMessage;
        rawOutput = JSON.stringify({
          model: options.model ?? null,
          effort: options.effort ?? null,
          turns: 1,
          status: result.status,
          threadId: result.threadId,
          turnId: result.turnId,
          commandCount: result.commandExecutions.length,
          fileChangeCount: result.fileChanges.length,
          touchedFileCount: result.touchedFiles.length,
          ...codexTiming,
        });
      } else {
        // Bounded retry for a specific, observed failure mode: the free-tier
        // gateway drops the stream mid-session, `opencode run` exits 0 with a
        // half-finished transcript, and the run used to be recorded as "the
        // model produced no patch". One retry with a fresh session; a session
        // that ended cleanly (or actually changed files) is never retried.
        const maxAttempts = options.cli === 'opencode' ? 2 : 1;
        const spawnTimeoutMs = options.timeoutMs ?? timeoutForComplexity(options.complexity);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const attemptStartedAt = Date.now();
          let stdout: string;
          let stderr: string;

          if (spec.pty) {
            // PTY path — required for CLIs that gate stdout on isatty()
            const timeoutMs = options.timeoutMs ?? timeoutForComplexity(options.complexity);
            const result = await spawnWithPty(spec.command, spec.args(prompt, options.projectPath), {
              cwd: options.projectPath,
              env: spec.env,
              timeoutMs,
            });
            stdout = result.stdout;
            stderr = result.stderr;
          } else {
            const result = await spawnWithStdinClosed(
              spec.command,
              spec.args(prompt, options.projectPath),
              {
                cwd: options.projectPath,
                env: spec.env,
                timeoutMs: options.timeoutMs ?? timeoutForComplexity(options.complexity),
              },
            );
            stdout = result.stdout;
            stderr = result.stderr;
          }

          // Keep the raw stdout around for metrics parsing — the outputTransform
          // strips it down to plain text and the metricsParser needs the JSONL.
          rawOutput = `${stdout}\n${stderr}`.trim();

          // Apply output transform if present (e.g. opencode JSONL → clean text)
          output = spec.outputTransform ? spec.outputTransform(rawOutput) : rawOutput;

          if (
            options.cli === 'opencode'
            && attempt < maxAttempts
            && opencodeRunLooksAborted(rawOutput)
            && !(await hasChanges(options.projectPath))
            // A near-timeout attempt was killed, not dropped — retrying would
            // double the wall-clock for a session that was probably working.
            && Date.now() - attemptStartedAt < spawnTimeoutMs * 0.8
          ) {
            logger.warn('opencode session aborted mid-stream with no changes; retrying', {
              taskId,
              attempt,
            });
            await tryTrace(
              prisma,
              taskId,
              'system',
              `opencode session aborted mid-stream (attempt ${String(attempt)}); retrying with a fresh session.`,
            );
            continue;
          }
          break;
        }

        success = true;
      }
      await runSpan.end('ok');
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      output = `${e.stdout ?? ''}\n${e.stderr ?? e.message ?? String(err)}`.trim();

      // Apply output transform even on error (partial output may be useful)
      if (spec.outputTransform) {
        output = spec.outputTransform(output);
      }

      if (options.cli === 'codex' && codexTiming && !rawOutput) {
        rawOutput = JSON.stringify({
          model: options.model ?? null,
          effort: options.effort ?? null,
          turns: 1,
          status: 'failed',
          threadId: null,
          turnId: null,
          commandCount: 0,
          fileChangeCount: 0,
          touchedFileCount: 0,
          ...codexTiming,
        });
      }

      runSpan.recordError(err);
      await runSpan.end('error');
    }

    // The session narrative is the ONLY reviewable record of what the CLI
    // agent did — without this trace, a failed run's task row held a
    // 300-char excerpt and every "no patch produced" was undiagnosable
    // (the first full-suite review had to reverse-engineer failures from
    // opencode's own log files). Bounded; best-effort.
    if (output.trim()) {
      await tryTrace(prisma, taskId, 'assistant', sanitizeForDb(output.trim().slice(0, 24_000)) ?? '');
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
        model: (options.cli === 'codex' || options.cli === 'opencode' || options.cli === 'claude-code') && options.model ? options.model : options.cli,
      },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        resultStatus: passed ? 'done' : 'failed',
        ...buildAgentRunMetricsUpdate(spec, rawOutput),
      },
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
