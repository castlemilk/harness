import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '@omega/db';
import type { AgentOptions } from '@omega/core';
import { Tracer } from './tracer.js';
import { getCurrentCommit, getGradedDiff, getCurrentBranch, hasChanges, stageAllChanges, commit } from './git.js';
import { logger } from './logger.js';
import { spawnWithPty } from './pty-spawn.js';
import { extractOpencodeResult, extractOpencodeSessionId, opencodeRunLooksAborted, parseOpencodeMetrics } from './opencode-output.js';
import { parseClaudeCodeStreamJson } from './claude-code-output.js';
import { parseAgyMetrics } from './agy-output.js';
import { runCodexTurn, getCodexAvailability, type CodexTurnResult } from './codex-driver.js';
import { buildCodexTaskPrompt } from './codex-prompt.js';
import { validationSummaryWithPatchAudit } from './patch-audit.js';
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
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; aborted: boolean }> {
  if (options.signal?.aborted) {
    return Promise.reject(
      options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('External agent process cancelled', 'AbortError'),
    );
  }

  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // A separate process group lets cancellation terminate helper/server
      // children launched by the CLI instead of orphaning them.
      detached: process.platform !== 'win32',
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => outChunks.push(d));
    child.stderr?.on('data', (d: Buffer) => errChunks.push(d));

    let settled = false;
    let timedOut = false;
    let aborted = false;
    let terminationRequested = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const killChild = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid !== undefined) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* ignore */
        }
      }
    };
    const terminate = (reason: 'timeout' | 'abort'): void => {
      if (settled || terminationRequested) return;
      terminationRequested = true;
      timedOut = reason === 'timeout';
      aborted = reason === 'abort';
      killChild('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (!settled) killChild('SIGKILL');
      }, reason === 'abort' ? 1_000 : 5_000);
    };
    const timer = setTimeout(() => {
      terminate('timeout');
    }, options.timeoutMs);
    const onAbort = (): void => {
      terminate('abort');
    };
    if (options.signal?.aborted) {
      onAbort();
    } else {
      options.signal?.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        exitCode: code ?? 1,
        timedOut,
        aborted,
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
  /** Exact compatible session to resume for a retry of the same task/CLI. */
  resumeSession?: ExternalSessionRef;
}

function timeoutForComplexity(complexity: string | undefined): number {
  switch (complexity) {
    case 'simple': return 5 * 60_000;
    case 'medium': return 15 * 60_000;
    case 'complex': return 30 * 60_000;
    default: return 10 * 60_000;
  }
}

export function remainingExternalRunMs(deadlineMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, deadlineMs - nowMs);
}

export function formatExternalDeadlineNotice(startedAtMs: number, deadlineMs: number): string {
  return [
    `Wall-clock budget started (UTC): ${new Date(startedAtMs).toISOString()}.`,
    `Absolute wall-clock deadline (UTC): ${new Date(deadlineMs).toISOString()}.`,
    'Check the current clock against that deadline while working; leave enough time to build, test, and remove scratch files.',
  ].join(' ');
}

function remainingExternalSpawnTimeout(deadlineMs: number, totalTimeoutMs: number): number {
  const remainingMs = remainingExternalRunMs(deadlineMs);
  if (remainingMs <= 0) {
    throw new Error(`External agent total wall-clock budget of ${String(totalTimeoutMs)}ms was exhausted.`);
  }
  return remainingMs;
}

export type ExternalCli =
  | 'codex'
  | 'claude-code'
  | 'agy'
  | 'opencode'
  | 'cursor-cli'
  | 'aider'
  | 'gemini-cli'; // @deprecated — use 'agy'

export type ExternalSessionKind = 'codex-thread' | 'opencode-session';

export interface ExternalSessionRef {
  sessionId: string;
  sessionKind: ExternalSessionKind;
}

export interface ExternalAgentResult {
  status: 'done' | 'failed';
  diff: string;
  output: string;
  /** Whether the CLI/provider interaction completed, independent of patch quality. */
  executionSucceeded: boolean;
}

export function effectiveExternalModel(cli: ExternalCli, model?: string | null): string {
  const configured = model?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  // OpenCode has an explicit harness default; the other CLIs defer to their
  // local configuration, so the CLI identity is the only truthful key.
  return cli === 'opencode' ? 'opencode/big-pickle' : cli;
}

export function externalSessionKind(cli: ExternalCli): ExternalSessionKind | undefined {
  if (cli === 'codex') return 'codex-thread';
  if (cli === 'opencode') return 'opencode-session';
  return undefined;
}

function validatedSession(cli: ExternalCli, session?: ExternalSessionRef): ExternalSessionRef | undefined {
  if (!session) return undefined;
  const expected = externalSessionKind(cli);
  if (!expected || session.sessionKind !== expected) {
    throw new Error(
      `Cannot resume ${session.sessionKind} session with external CLI ${cli}; expected ${expected ?? 'no resumable session kind'}.`,
    );
  }
  if (!session.sessionId.trim()) {
    throw new Error(`Cannot resume external CLI ${cli} with an empty session id.`);
  }
  return { ...session, sessionId: session.sessionId.trim() };
}

interface CliSpec {
  command: string;
  args: (prompt: string, cwd?: string, resumeSession?: ExternalSessionRef) => string[];
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

/** Build the exact installed-CLI invocation, including an explicit session. */
export function buildExternalCliArgs(
  cli: ExternalCli,
  prompt: string,
  cwd?: string,
  model?: string,
  resumeSession?: ExternalSessionRef,
): string[] {
  const session = validatedSession(cli, resumeSession);
  switch (cli) {
    case 'codex': {
      const prefix = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
      // codex-cli 0.144.5 requires parent exec options before the resume
      // subcommand; the session id is positional (never use --last).
      // `--json` on BOTH paths: making the output shape depend on whether a
      // run resumed means the metrics parser sees a different format on a
      // retry than on the first attempt.
      return session
        ? [...prefix, '--json', 'resume', session.sessionId, prompt]
        : [...prefix, '--json', prompt];
    }
    case 'claude-code':
      return [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        ...(model ? ['--model', model] : []),
      ];
    case 'agy':
    case 'gemini-cli':
      return [
        '-p', prompt,
        '--output-format', 'json',
        '--dangerously-skip-permissions',
        ...(cwd ? ['--add-dir', cwd] : []),
      ];
    case 'opencode':
      return [
        'run',
        '--format', 'json',
        '--model', effectiveExternalModel(cli, model),
        '--auto',
        '--port', String(4096 + Math.floor(Math.random() * 1000)),
        ...(cwd ? ['--dir', cwd] : []),
        ...(session ? ['--session', session.sessionId] : []),
        prompt,
      ];
    case 'cursor-cli':
      return ['-p', prompt];
    case 'aider':
      return ['--message', prompt, '--yes'];
    default:
      throw new Error(`Unsupported external cli: ${String(cli)}`);
  }
}

function cliSpec(cli: ExternalCli, model?: string): CliSpec {
  switch (cli) {
    case 'codex':
      return {
        command: 'codex',
        args: (prompt, cwd, session) => buildExternalCliArgs(cli, prompt, cwd, model, session),
        metricsParser: parseCodexMetrics,
      };
    case 'claude-code':
      return {
        command: 'claude',
        // Model is caller-selectable (Task.model / options.model); absent
        // keeps the CLI's own default, exactly as before.
        args: (prompt, cwd, session) => buildExternalCliArgs(cli, prompt, cwd, model, session),
        pty: true,
        metricsParser: parseClaudeCodeStreamJson,
      };
    case 'agy':
      return {
        command: 'agy',
        // JSON print mode so the run's token usage comes back with it; without
        // it agy prints prose only and the run records no usage at all.
        args: (prompt, cwd, session) => buildExternalCliArgs(cli, prompt, cwd, model, session),
        pty: true,
        metricsParser: parseAgyMetrics,
      };
    case 'gemini-cli':
      // @deprecated — gemini-cli was retired June 2026, use agy instead
      logger.warn('gemini-cli is deprecated, use agy instead');
      return {
        command: 'agy',
        args: (prompt, cwd, session) => buildExternalCliArgs(cli, prompt, cwd, model, session),
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
        args: (prompt, cwd, session) => buildExternalCliArgs(cli, prompt, cwd, model, session),
        outputTransform: extractOpencodeResult,
        metricsParser: parseOpencodeMetrics,
      };
    case 'cursor-cli':
      return {
        command: 'cursor-agent',
        args: (prompt, cwd, session) => buildExternalCliArgs(cli, prompt, cwd, model, session),
      };
    case 'aider':
      return {
        command: 'aider',
        args: (prompt, cwd, session) => buildExternalCliArgs(cli, prompt, cwd, model, session),
      };
    default:
      throw new Error(`Unsupported external cli: ${String(cli)}`);
  }
}

async function commandExists(cmd: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', cmd], { timeout: 10_000, signal });
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
): Promise<ExternalAgentResult> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');
  // Reassignable: a stale session is downgraded to a fresh one mid-loop.
  let resumeSession = validatedSession(options.cli, options.resumeSession);
  const providerIdentity = `external:${options.cli}`;
  const effectiveModel = effectiveExternalModel(options.cli, options.model);

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
      sessionId: resumeSession?.sessionId,
      sessionKind: resumeSession?.sessionKind,
    },
  });

  if (resumeSession) {
    logger.info('Resuming external agent session', {
      taskId,
      cli: options.cli,
      sessionKind: resumeSession.sessionKind,
      sessionId: resumeSession.sessionId,
    });
    await tryTrace(
      prisma,
      taskId,
      'system',
      `Resuming ${resumeSession.sessionKind} ${resumeSession.sessionId} with external CLI ${options.cli}.`,
    );
  }

  const configuredModel = options.model?.trim();
  const spec = cliSpec(
    options.cli,
    configuredModel !== undefined && configuredModel.length > 0 ? configuredModel : undefined,
  );
  const available = await commandExists(spec.command, options.signal);
  if (!available) {
    const message = options.signal?.aborted
      ? options.signal.reason instanceof Error
        ? options.signal.reason.message
        : 'External agent run cancelled'
      : `External agent CLI '${spec.command}' not found in PATH`;
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: message,
        result: message,
        provider: providerIdentity,
        model: effectiveModel,
      },
    });
    await prisma.agentRun.update({ where: { id: agentRun.id }, data: { resultStatus: 'failed' } });
    rootSpan.recordError(new Error(message));
    await rootSpan.end('error');
    return { status: 'failed', diff: '', output: message, executionSucceeded: false };
  }

  const codexDriverAvailable = options.cli === 'codex'
    ? (await getCodexAvailability(options.signal)).available
    : false;

  const totalTimeoutMs = options.timeoutMs !== undefined
    && Number.isFinite(options.timeoutMs)
    && options.timeoutMs > 0
    ? options.timeoutMs
    : timeoutForComplexity(options.complexity);
  const runStartedAtMs = Date.now();
  const runDeadlineMs = runStartedAtMs + totalTimeoutMs;
  // DeepSWE's independently switchable time experiment advertises itself in
  // the description. Do not perturb baseline prompts when that switch is off.
  const deadlineNotice = task.description?.includes('TIME BUDGET:')
    ? formatExternalDeadlineNotice(runStartedAtMs, runDeadlineMs)
    : '';

  const prompt = [
    `Task: ${task.title}`,
    task.description ? `Description:\n${task.description}` : '',
    '',
    deadlineNotice,
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
      description: [task.description, deadlineNotice].filter(Boolean).join('\n\n'),
      verificationCommand,
    });
  }

  let output = '';
  let success = false;
  let rawOutput = '';
  let codexTiming: CodexTimingMetrics | undefined;
  let activeSession = resumeSession;
  try {
    const runSpan = tracer.startSpan(`external.${options.cli}`, rootSpan.toContext());
    if (resumeSession) {
      runSpan.addEvent('external.session.resume', {
        sessionKind: resumeSession.sessionKind,
        sessionId: resumeSession.sessionId,
      });
    }
    try {
      if (options.cli === 'codex' && codexDriverAvailable) {
        const timingTracker: CodexTimingTracker = {
          turnStartedAt: Date.now(),
          phaseTimings: {},
        };
        let result: CodexTurnResult;
        try {
          result = await runCodexTurn(options.projectPath, codexPrompt, {
            timeoutMs: remainingExternalSpawnTimeout(runDeadlineMs, totalTimeoutMs),
            signal: options.signal,
            threadName: `task:${taskId} ${task.title}`.slice(0, 96),
            model: options.model,
            effort: options.effort,
            resumeThreadId: resumeSession?.sessionKind === 'codex-thread'
              ? resumeSession.sessionId
              : undefined,
            // Only persist the thread when a retry could actually resume it.
            // With auto-retry off, persistence is pure litter — one permanent
            // rollout per task, never pruned.
            persistThread: (process.env.OMEGA_AUTO_RETRY ?? 'true').toLowerCase() !== 'false',
            onSession: async (threadId) => {
              activeSession = { sessionId: threadId, sessionKind: 'codex-thread' };
              await prisma.agentRun.update({
                where: { id: agentRun.id },
                data: { sessionId: threadId, sessionKind: 'codex-thread' },
              });
              runSpan.addEvent(
                resumeSession ? 'external.session.resumed' : 'external.session.captured',
                { sessionKind: 'codex-thread', sessionId: threadId },
              );
              logger.info(resumeSession ? 'Resumed Codex thread' : 'Captured Codex thread', {
                taskId,
                sessionId: threadId,
              });
            },
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
        if (result.threadId.trim() && activeSession?.sessionId !== result.threadId) {
          activeSession = { sessionId: result.threadId, sessionKind: 'codex-thread' };
          await prisma.agentRun.update({
            where: { id: agentRun.id },
            data: { sessionId: result.threadId, sessionKind: 'codex-thread' },
          });
          runSpan.addEvent('external.session.captured', {
            sessionKind: 'codex-thread',
            sessionId: result.threadId,
          });
          logger.info('Captured Codex thread from turn result', {
            taskId,
            sessionId: result.threadId,
          });
        }
        success = result.status === 'completed';
        if (success) {
          output = result.finalMessage;
        } else {
          const statusReason = result.status === 'timed-out'
            ? `Codex turn reached the external agent's ${String(totalTimeoutMs)}ms total wall-clock budget.`
            : result.status === 'interrupted'
              ? 'Codex stream was interrupted before the turn completed.'
              : `Codex turn ended with status ${result.status}.`;
          const driverError = result.error instanceof Error
            ? result.error.message
            : typeof result.error === 'string'
              ? result.error
              : '';
          output = [statusReason, result.finalMessage, result.stderr, driverError]
            .filter((part) => part.trim().length > 0)
            .join('\n');
        }
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
        // model produced no patch". One retry resumes the exact captured
        // session when OpenCode emitted one; a clean session is never retried.
        const maxAttempts = options.cli === 'opencode' ? 2 : 1;
        const attemptOutputs: string[] = [];
        let openCodeStreamAborted = false;
        let attemptsRun = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const spawnTimeoutMs = remainingExternalSpawnTimeout(runDeadlineMs, totalTimeoutMs);
          attemptsRun = attempt;
          const attemptStartedAt = Date.now();
          let stdout: string;
          let stderr: string;
          let exitCode: number;
          let timedOut: boolean;
          let aborted: boolean;

          if (spec.pty) {
            // PTY path — required for CLIs that gate stdout on isatty()
            const result = await spawnWithPty(spec.command, spec.args(prompt, options.projectPath, activeSession), {
              cwd: options.projectPath,
              env: spec.env,
              timeoutMs: spawnTimeoutMs,
              signal: options.signal,
            });
            stdout = result.stdout;
            stderr = result.stderr;
            exitCode = result.exitCode;
            timedOut = result.timedOut;
            aborted = result.aborted;
          } else {
            const result = await spawnWithStdinClosed(
              spec.command,
              spec.args(prompt, options.projectPath, activeSession),
              {
                cwd: options.projectPath,
                env: spec.env,
                timeoutMs: spawnTimeoutMs,
                signal: options.signal,
              },
            );
            stdout = result.stdout;
            stderr = result.stderr;
            exitCode = result.exitCode;
            timedOut = result.timedOut;
            aborted = result.aborted;
          }

          // Keep the raw stdout around for metrics parsing — the outputTransform
          // strips it down to plain text and the metricsParser needs the JSONL.
          const attemptOutput = `${stdout}\n${stderr}`.trim();
          attemptOutputs.push(attemptOutput);
          rawOutput = attemptOutputs.join('\n');

          if (options.cli === 'opencode') {
            const sessionId = extractOpencodeSessionId(stdout);
            if (sessionId) {
              activeSession = { sessionId, sessionKind: 'opencode-session' };
              await prisma.agentRun.update({
                where: { id: agentRun.id },
                data: { sessionId, sessionKind: 'opencode-session' },
              });
              runSpan.addEvent('external.session.captured', {
                sessionKind: 'opencode-session',
                sessionId,
                attempt,
              });
              logger.info('Captured OpenCode session', { taskId, sessionId, attempt });
            }
          }

          if (aborted) {
            const cancellation = options.signal?.reason instanceof Error
              ? options.signal.reason
              : new DOMException('External agent process cancelled', 'AbortError');
            throw Object.assign(cancellation, { stdout, stderr });
          }
          if (timedOut) {
            throw Object.assign(
              new Error(`${spec.command} timed out after ${String(spawnTimeoutMs)}ms`),
              { stdout, stderr },
            );
          }
          if (exitCode !== 0) {
            // A resumed session the CLI no longer knows about (pruned or
            // expired) exits non-zero immediately. That is recoverable, but
            // it classifies as terminal, so without this the resume feature
            // would turn a transient condition into a permanent failure.
            const staleCandidate = resumeSession;
            const staleSession =
              staleCandidate !== undefined
              && /session not found|no such session|unknown session|thread not found/i.test(
                `${stdout}\n${stderr}`,
              );
            if (staleCandidate && staleSession && attempt < maxAttempts) {
              logger.warn('Resumed session is stale; retrying with a fresh session', {
                taskId,
                sessionId: staleCandidate.sessionId,
                attempt,
              });
              await tryTrace(
                prisma,
                taskId,
                'system',
                `Session ${staleCandidate.sessionId} could not be resumed (${spec.command} exit ${String(exitCode)}); retrying with a fresh session.`,
              );
              resumeSession = undefined;
              continue;
            }
            throw Object.assign(
              new Error(`${spec.command} exited with code ${String(exitCode)}`),
              { stdout, stderr },
            );
          }

          // Apply output transform if present (e.g. opencode JSONL → clean text)
          output = spec.outputTransform ? spec.outputTransform(attemptOutput) : attemptOutput;
          openCodeStreamAborted = options.cli === 'opencode' && opencodeRunLooksAborted(rawOutput);

          if (
            options.cli === 'opencode'
            && attempt < maxAttempts
            && openCodeStreamAborted
            && !(await hasChanges(options.projectPath))
            // A near-timeout attempt was killed, not dropped — retrying would
            // double the wall-clock for a session that was probably working.
            && Date.now() - attemptStartedAt < spawnTimeoutMs * 0.8
          ) {
            logger.warn('opencode session aborted mid-stream with no changes; retrying', {
              taskId,
              attempt,
              sessionId: activeSession?.sessionId,
            });
            const continuation = activeSession
              ? `resuming session ${activeSession.sessionId}`
              : 'no session id was emitted; starting a fresh session';
            await tryTrace(
              prisma,
              taskId,
              'system',
              `OpenCode stream aborted mid-session (attempt ${String(attempt)}); ${continuation}.`,
            );
            continue;
          }
          break;
        }

        success = !openCodeStreamAborted;
        if (openCodeStreamAborted) {
          const session = activeSession
            ? ` Captured resumable session ${activeSession.sessionId}.`
            : ' No resumable session id was emitted.';
          output = `OpenCode stream aborted before a normal stop after ${String(attemptsRun)} bounded attempt(s).${session}\n${output}`.trim();
        }
      }
      runSpan.setAttributes({ executionSucceeded: success });
      if (!success) {
        runSpan.addEvent('external.run.failed', { output: output.slice(0, 500) });
      }
      await runSpan.end(success ? 'ok' : 'error');
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      output = [e.stdout, e.stderr, e.message ?? String(err)]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join('\n')
        .trim();

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

    const diff = await getGradedDiff(options.projectPath, baseCommitSha);
    const patch = diff.output;
    const hasPatch = diff.success && patch.trim().length > 0;
    const patchAuditValidation = await validationSummaryWithPatchAudit(prisma, agentRun.id, diff);

    if (diff.success && patch) {
      await prisma.taskDiff.create({
        data: { taskId, branch, patch: sanitizeForDb(patch) ?? '' },
      });
    } else if (!diff.success) {
      logger.warn(`graded diff failed for task ${taskId}: ${diff.error ?? 'unknown error'}`);
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
        provider: providerIdentity,
        model: effectiveModel,
      },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        resultStatus: passed ? 'done' : 'failed',
        sessionId: activeSession?.sessionId,
        sessionKind: activeSession?.sessionKind,
        ...buildAgentRunMetricsUpdate(spec, rawOutput),
        ...(patchAuditValidation ? { validationSummary: patchAuditValidation } : {}),
      },
    });
    rootSpan.setAttributes({
      passed,
      diffBytes: patch.length,
      gradedPatchTestPaths: diff.gradedPatchTestPaths.length,
      gradedPatchAddedTestPaths: diff.gradedPatchAddedTestPaths.length,
    });
    await rootSpan.end(passed ? 'ok' : 'error');
    logger.info('External agent task finished', { taskId, cli: options.cli, passed });
    return { status: passed ? 'done' : 'failed', diff: patch, output, executionSucceeded: success };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootSpan.recordError(err);
    await rootSpan.end('error');
    const reason = message.trim() || `External agent (${options.cli}) failed without an error message.`;
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: sanitizeForDb(reason),
        result: sanitizeForDb(reason),
        provider: providerIdentity,
        model: effectiveModel,
      },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        resultStatus: 'failed',
        sessionId: activeSession?.sessionId,
        sessionKind: activeSession?.sessionKind,
      },
    });
    return { status: 'failed', diff: '', output: reason, executionSucceeded: false };
  }
}
