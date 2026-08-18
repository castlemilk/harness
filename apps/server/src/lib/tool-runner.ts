import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { HarnessTool, HarnessToolRun, PrismaClient } from '@omega/db';
import { parsePermissions, type HarnessPermission } from './harness-permissions.js';

/**
 * Tool execution.
 *
 * A HarnessTool is an action a human can fire at a harness from the web UI. It
 * executes as a shell command in the objective's project checkout — which is
 * to say, a browser button runs a command on this machine. Everything here
 * exists to make that safe enough to ship:
 *
 * - It is OFF unless `FOREMAN_TOOLS=1`. With the flag unset the route records
 *   the request and executes nothing, exactly as it always did.
 * - A tool with no `command` is not executable, flag or no flag.
 * - Execution requires a GRANTED `Harness.permissions` entry. No permission,
 *   or a permission that wants per-use sign-off, means the run is blocked and
 *   an approval Intervention is raised instead.
 * - Approving that intervention "once" authorises exactly ONE later run;
 *   "always" grants the permission through the existing resolve flow.
 * - Every attempt is written to HarnessToolRun, including the ones that never
 *   ran. "Nothing happened" is itself an audit record.
 *
 * The blast radius is still a shell command with the invoking user's rights.
 * The permission gate decides WHETHER, not WHAT: the command text comes from
 * the stored tool definition, never from the request.
 */

/** The exact label the record-only path has always produced. Do not change. */
export const RECORD_ONLY_LABEL =
  'Not executed: execution is not configured; request recorded only';

const NO_CHECKOUT_LABEL =
  'Not executed: the objective has no project checkout on disk; request recorded only';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
/** Bytes read from the child before we stop appending. */
const MAX_CAPTURE_BYTES = 64 * 1024;
/** Characters of that capture persisted on the run row. */
const MAX_OUTPUT_CHARS = 2_000;
/** Grace between SIGTERM and SIGKILL for a timed-out process group. */
const KILL_GRACE_MS = 5_000;

/** Feature flag. The only door to execution. */
export function toolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FOREMAN_TOOLS === '1';
}

/**
 * The environment a tool command sees. An allowlist, not a denylist: the
 * server process holds provider API keys and a database URL, and a tool
 * command has no business reading either. Anything not named here is gone.
 */
export function scrubEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR'];
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = env[key];
    if (typeof value === 'string') scrubbed[key] = value;
  }
  // Non-interactive by construction: a tool that stops to ask for a password
  // would otherwise sit there until the timeout fires.
  scrubbed.GIT_TERMINAL_PROMPT = '0';
  scrubbed.TERM = 'dumb';
  scrubbed.CI = '1';
  return scrubbed;
}

export interface ShellResult {
  exitCode: number | null;
  durationMs: number;
  output: string;
  timedOut: boolean;
  /** Set when the process could not be started at all. */
  spawnError: string | null;
}

/**
 * Run one command, bounded in time and output, in its own process group so a
 * timeout kills the whole tree rather than the shell that outlived its child.
 */
export function runShellCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ShellResult> {
  return new Promise<ShellResult>((resolve) => {
    const startedAt = Date.now();
    let captured = '';
    let capturedBytes = 0;
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;

    const child = spawn(options.command, {
      cwd: options.cwd,
      env: options.env ?? scrubEnv(),
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const append = (chunk: Buffer): void => {
      if (capturedBytes >= MAX_CAPTURE_BYTES) return;
      const room = MAX_CAPTURE_BYTES - capturedBytes;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      capturedBytes += slice.length;
      captured += slice.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid != null) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already gone */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => { killGroup('SIGKILL'); }, KILL_GRACE_MS);
      killTimer.unref();
    }, options.timeoutMs);

    const finish = (result: Omit<ShellResult, 'durationMs' | 'output' | 'timedOut'>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
        output: captured,
        timedOut,
      });
    };

    child.on('error', (error: Error) => {
      finish({ exitCode: null, spawnError: error.message });
    });
    child.on('close', (code) => {
      finish({ exitCode: code, spawnError: null });
    });
  });
}

export interface ToolRunResult {
  tool: HarnessTool;
  run: HarnessToolRun;
}

interface ToolContext {
  harnessId: string;
  objectiveId: string;
  harnessName: string;
  permissions: HarnessPermission[];
  projectPath: string | null;
}

/** The permission that governs a tool. Explicit if set, per-tool otherwise. */
export function permissionIdFor(tool: Pick<HarnessTool, 'id' | 'permissionId'>): string {
  return tool.permissionId ?? `tool:${tool.id}`;
}

function excerpt(output: string): string | null {
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_OUTPUT_CHARS
    ? `${trimmed.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated`
    : trimmed;
}

function durationLabel(ms: number): string {
  return ms < 1_000 ? `${String(ms)}ms` : `${(ms / 1_000).toFixed(1)}s`;
}

function timeoutFor(tool: Pick<HarnessTool, 'timeoutMs'>): number {
  const configured = tool.timeoutMs;
  if (configured == null || !Number.isFinite(configured) || configured <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(configured, MAX_TIMEOUT_MS);
}

async function loadContext(prisma: PrismaClient, tool: HarnessTool): Promise<ToolContext | null> {
  const harness = await prisma.harness.findUnique({
    where: { id: tool.harnessId },
    select: { id: true, name: true, objectiveId: true, permissions: true },
  });
  if (!harness) return null;
  const objective = await prisma.objective.findUnique({
    where: { id: harness.objectiveId },
    select: { projectId: true },
  });
  const project = objective
    ? await prisma.project.findUnique({ where: { id: objective.projectId }, select: { path: true } })
    : null;
  return {
    harnessId: harness.id,
    objectiveId: harness.objectiveId,
    harnessName: harness.name,
    permissions: parsePermissions(harness.permissions),
    projectPath: project?.path ?? null,
  };
}

/**
 * Materialise the permission this tool asks for, un-granted, so the human has
 * something to say "always allow" ABOUT. Writing a `granted: false` entry
 * grants nothing; it only makes the ask visible and gives the existing
 * `approve-always` resolution an id to flip.
 */
async function ensurePermissionEntry(
  prisma: PrismaClient,
  context: ToolContext,
  tool: HarnessTool,
  permissionId: string,
): Promise<void> {
  if (context.permissions.some((entry) => entry.id === permissionId)) return;
  const next = [
    ...context.permissions,
    {
      id: permissionId,
      label: `Run tool "${tool.name}"`,
      granted: false,
      needsApproval: tool.needsApproval,
    },
  ];
  await prisma.harness.update({
    where: { id: context.harnessId },
    data: { permissions: JSON.stringify(next) },
  });
  context.permissions = next;
}

/**
 * One pending approval per tool. Re-running a blocked tool must not stack the
 * Needs-you rail with identical asks.
 */
async function ensureApprovalIntervention(
  prisma: PrismaClient,
  context: ToolContext,
  tool: HarnessTool,
  permissionId: string,
): Promise<string> {
  const existing = await prisma.intervention.findFirst({
    where: { harnessId: context.harnessId, kind: 'approval', status: 'pending' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, payload: true },
  });
  if (existing) {
    const payload = existing.payload ?? '';
    if (payload.includes(`"toolId":"${tool.id}"`)) return existing.id;
  }
  const created = await prisma.intervention.create({
    data: {
      objectiveId: context.objectiveId,
      harnessId: context.harnessId,
      kind: 'approval',
      title: `${context.harnessName} wants to run "${tool.name}"`,
      detail:
        `Command: ${tool.command ?? ''}\n` +
        `Working directory: ${context.projectPath ?? 'unknown'}\n` +
        `Approving once authorises a single run; "always allow" grants the ` +
        `"${permissionId}" permission for every future run.`,
      impact: tool.groupName,
      payload: JSON.stringify({ permissionId, toolId: tool.id, command: tool.command }),
      status: 'pending',
    },
    select: { id: true },
  });
  return created.id;
}

interface RecordArgs {
  status: string;
  label: string;
  toolStatus: string | null;
  ranAt: Date | null;
  command?: string | null;
  cwd?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  permissionId?: string | null;
  interventionId?: string | null;
  output?: string | null;
  clearApproval?: boolean;
}

async function record(
  prisma: PrismaClient,
  tool: HarnessTool,
  args: RecordArgs,
): Promise<ToolRunResult> {
  const run = await prisma.harnessToolRun.create({
    data: {
      toolId: tool.id,
      harnessId: tool.harnessId,
      status: args.status,
      label: args.label,
      command: args.command ?? null,
      cwd: args.cwd ?? null,
      exitCode: args.exitCode ?? null,
      durationMs: args.durationMs ?? null,
      permissionId: args.permissionId ?? null,
      interventionId: args.interventionId ?? null,
      output: args.output ?? null,
    },
  });
  const updated = await prisma.harnessTool.update({
    where: { id: tool.id },
    data: {
      lastStatus: args.toolStatus,
      lastResultLabel: args.label,
      lastRanAt: args.ranAt,
      ...(args.clearApproval === true ? { approvedInterventionId: null } : {}),
    },
  });
  return { tool: updated, run };
}

/**
 * Run a tool, or decide not to. Returns the updated tool plus the audit row
 * describing what happened — the caller never has to guess.
 */
export async function runHarnessTool(
  prisma: PrismaClient,
  tool: HarnessTool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ToolRunResult> {
  const command = tool.command?.trim() ?? '';
  // Order matters. The flag is checked first so that with tools disabled the
  // route touches nothing but the two columns it always touched.
  if (!toolsEnabled(env) || command.length === 0) {
    return record(prisma, tool, {
      status: 'recorded',
      label: RECORD_ONLY_LABEL,
      toolStatus: 'recorded',
      ranAt: null,
    });
  }

  const context = await loadContext(prisma, tool);
  if (!context?.projectPath || !existsSync(context.projectPath)) {
    return record(prisma, tool, {
      status: 'recorded',
      label: NO_CHECKOUT_LABEL,
      toolStatus: 'recorded',
      ranAt: null,
      command,
      cwd: context?.projectPath ?? null,
    });
  }

  const permissionId = permissionIdFor(tool);
  const permission = context.permissions.find((entry) => entry.id === permissionId) ?? null;
  const oneShotInterventionId = tool.approvedInterventionId;
  // Standing authority is a granted permission on a tool that does not demand
  // sign-off on its own account. A tool flagged `needsApproval` asks EVERY
  // time, no matter what the permission says — that flag is the whole point.
  const standing = permission?.granted === true && !tool.needsApproval;

  if (!standing && oneShotInterventionId == null) {
    await ensurePermissionEntry(prisma, context, tool, permissionId);
    const interventionId = await ensureApprovalIntervention(prisma, context, tool, permissionId);
    return record(prisma, tool, {
      status: 'blocked-pending-approval',
      label: `Blocked: waiting on approval to run "${tool.name}"`,
      toolStatus: 'blocked',
      ranAt: null,
      command,
      cwd: context.projectPath,
      permissionId,
      interventionId,
    });
  }

  const cwd = context.projectPath;
  const result = await runShellCommand({
    command,
    cwd,
    timeoutMs: timeoutFor(tool),
    env: scrubEnv(env),
  });
  const authorisedBy = standing
    ? { permissionId, interventionId: null }
    : { permissionId: null, interventionId: oneShotInterventionId };

  const shared = {
    command,
    cwd,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: excerpt(result.output),
    ranAt: new Date(),
    clearApproval: true,
    ...authorisedBy,
  };

  if (result.spawnError !== null) {
    return record(prisma, tool, {
      ...shared,
      status: 'error',
      toolStatus: 'fail',
      label: `Failed to start: ${result.spawnError}`.slice(0, 200),
    });
  }
  if (result.timedOut) {
    return record(prisma, tool, {
      ...shared,
      status: 'timeout',
      toolStatus: 'fail',
      label: `timed out after ${durationLabel(timeoutFor(tool))} · killed`,
    });
  }
  const ok = result.exitCode === 0;
  return record(prisma, tool, {
    ...shared,
    status: ok ? 'ok' : 'fail',
    toolStatus: ok ? 'ok' : 'fail',
    label: `${ok ? 'ok' : 'failed'} · exit ${String(result.exitCode ?? -1)} · ${durationLabel(result.durationMs)}`,
  });
}
