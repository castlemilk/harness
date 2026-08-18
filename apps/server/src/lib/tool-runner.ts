import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { Prisma, type HarnessTool, type HarnessToolRun, type PrismaClient } from '@omega/db';
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
 *   the request and executes nothing.
 * - A tool with no `command` is not executable, flag or no flag.
 * - When `FOREMAN_TOOLS_SECRET` is set, the run route and approval resolution
 *   demand a matching `x-foreman-tools-secret` header. That — not the
 *   permission list — is the only authentication this layer has.
 * - Execution requires a GRANTED `Harness.permissions` entry that does not
 *   itself ask for per-use sign-off. No permission means the run is blocked
 *   and an approval Intervention is raised instead.
 * - Approving that intervention "once" authorises exactly ONE later run: the
 *   grant is CLAIMED before the spawn, so two racing runs cannot both consume
 *   it. "always" grants the permission through the existing resolve flow.
 * - Every attempt is written to HarnessToolRun, including the ones that never
 *   ran. An executing run gets its row BEFORE the spawn (`running`), updated in
 *   place to its terminal status — so a run in flight, or one whose server
 *   died, is visible rather than invented after the fact.
 *
 * The blast radius is still a shell command with the invoking user's rights:
 * the scrubbed environment keeps the SERVER's secrets out of the child, but the
 * child still reads `~/.ssh`, `~/.aws`, gcloud credentials and the checkout's
 * own `.env` as that user. The permission gate decides WHETHER, not WHAT: the
 * command text comes from the stored tool definition, never from the request.
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
/** At most one in-flight run per tool. */
const MAX_INFLIGHT_PER_TOOL = 1;
/** At most three in-flight runs across a harness's whole toolkit. */
const MAX_INFLIGHT_PER_HARNESS = 3;
/**
 * A `running` row older than this cannot be a live run — the hardest timeout is
 * MAX_TIMEOUT_MS — so it is a crash leftover and must not brick the tool
 * forever. Counted out of the concurrency check; still visible in the audit.
 */
const INFLIGHT_STALE_AFTER_MS = MAX_TIMEOUT_MS + 60_000;

/** Feature flag. The only door to execution. */
export function toolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FOREMAN_TOOLS === '1';
}

/**
 * The shared secret that gates the two routes which can cause a command to run
 * (running a tool, and approving the intervention that authorises one). Unset
 * means unauthenticated — the local-trusted posture, where the loopback bind is
 * the fence.
 */
export function toolsSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.FOREMAN_TOOLS_SECRET?.trim() ?? '';
  return value.length > 0 ? value : null;
}

/** Header the secret travels in. */
export const TOOLS_SECRET_HEADER = 'x-foreman-tools-secret';

/**
 * Constant-time secret check. Digesting first makes both operands 32 bytes, so
 * `timingSafeEqual` never throws on a length mismatch and the comparison leaks
 * nothing about the expected length.
 */
export function toolsSecretAccepted(
  presented: string | string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = toolsSecret(env);
  if (expected === null) return true;
  const offered = Array.isArray(presented) ? presented[0] : presented;
  if (typeof offered !== 'string') return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(offered).digest();
  return timingSafeEqual(a, b);
}

/**
 * Startup honesty check. `FOREMAN_TOOLS=1` on a non-loopback bind means anyone
 * who can reach the port can run shell commands on this host; say so loudly
 * rather than let it be discovered. Pure so it can be asserted in a test.
 */
export function remoteExposureWarning(
  env: NodeJS.ProcessEnv,
  host: string,
): string | null {
  if (!toolsEnabled(env)) return null;
  const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
  if (loopback.has(host)) return null;
  const secured = toolsSecret(env) !== null;
  return [
    '',
    '  ⚠  FOREMAN_TOOLS=1 AND THE SERVER IS NOT BOUND TO LOOPBACK',
    `     HOST=${host} — every host that can reach this port can make this`,
    '     server run shell commands in your project checkouts, as you.',
    secured
      ? '     FOREMAN_TOOLS_SECRET is set, so the tool routes demand a header —'
      : '     FOREMAN_TOOLS_SECRET is NOT set, so the tool routes are open.',
    secured
      ? '     that is one shared secret over whatever transport you terminate.'
      : '     Set it, or bind HOST=127.0.0.1, or unset FOREMAN_TOOLS.',
    '',
  ].join('\n');
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

    // One decoder across both streams' chunks: a multi-byte character split
    // across a chunk boundary (or sliced off at the 64 KB cap) would otherwise
    // decode to U+FFFD. The decoder holds the partial bytes until they complete.
    const decoder = new StringDecoder('utf8');
    const append = (chunk: Buffer): void => {
      if (capturedBytes >= MAX_CAPTURE_BYTES) return;
      const room = MAX_CAPTURE_BYTES - capturedBytes;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      capturedBytes += slice.length;
      captured += decoder.write(slice);
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

/**
 * What a run attempt produced. Every outcome but one leaves an audit row; a
 * concurrency rejection deliberately does not (see `claimRunSlot`), so it is a
 * separate shape rather than a row with a `rejected` status.
 */
export type ToolRunOutcome =
  | ToolRunResult
  | ({ kind: 'rejected-concurrency' } & ConcurrencyRejection);

export function isConcurrencyRejection(
  outcome: ToolRunOutcome,
): outcome is { kind: 'rejected-concurrency' } & ConcurrencyRejection {
  // `kind` exists on no other outcome, so its presence is the discriminator.
  return 'kind' in outcome;
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
  // Read-modify-write on a JSON column, so take the row lock every other
  // permission write in this codebase takes. Two blocked runs landing together
  // would otherwise each rewrite the list from its own stale copy, and the
  // loser's entry — possibly a *granted* one — would vanish.
  const next = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Harness" WHERE "id" = ${context.harnessId} FOR UPDATE`,
    );
    const current = await tx.harness.findUnique({
      where: { id: context.harnessId },
      select: { permissions: true },
    });
    const entries = parsePermissions(current?.permissions);
    if (entries.some((entry) => entry.id === permissionId)) return entries;
    const merged = [
      ...entries,
      {
        id: permissionId,
        label: `Run tool "${tool.name}"`,
        granted: false,
        needsApproval: tool.needsApproval,
      },
    ];
    await tx.harness.update({
      where: { id: context.harnessId },
      data: { permissions: JSON.stringify(merged) },
    });
    return merged;
  });
  context.permissions = next;
}

/**
 * One pending approval per tool. Re-running a blocked tool must not stack the
 * Needs-you rail with identical asks.
 *
 * The match is on THIS tool's id, not merely on the newest pending approval:
 * alternating two blocked tools used to miss the dedup every time (each run saw
 * the other tool's intervention at the head of the list) and flood the rail.
 */
async function ensureApprovalIntervention(
  prisma: PrismaClient,
  context: ToolContext,
  tool: HarnessTool,
  permissionId: string,
): Promise<string> {
  const existing = await prisma.intervention.findFirst({
    where: {
      harnessId: context.harnessId,
      kind: 'approval',
      status: 'pending',
      payload: { contains: `"toolId":"${tool.id}"` },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) return existing.id;
  // Say what each button actually does. "Always allow" cannot make a
  // `needsApproval` tool standing — the flag outranks the permission — so
  // promising that here was a lie the operator would act on.
  const alwaysLine = tool.needsApproval
    ? `This tool is marked "needs approval", so it asks EVERY time: "always ` +
      `allow" will grant the "${permissionId}" permission but the next run ` +
      `will still stop here for sign-off.`
    : `Approving once authorises a single run; "always allow" grants the ` +
      `"${permissionId}" permission for every future run.`;
  const created = await prisma.intervention.create({
    data: {
      objectiveId: context.objectiveId,
      harnessId: context.harnessId,
      kind: 'approval',
      title: `${context.harnessName} wants to run "${tool.name}"`,
      detail:
        `Command: ${tool.command ?? ''}\n` +
        `Working directory: ${context.projectPath ?? 'unknown'}\n` +
        alwaysLine,
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

/**
 * Write the audit row and the tool's denormalised "last result" as ONE unit.
 * They disagreed under any failure between the two writes, and the Toolkit
 * renders both.
 */
async function record(
  prisma: PrismaClient,
  tool: HarnessTool,
  args: RecordArgs,
): Promise<ToolRunResult> {
  return prisma.$transaction(async (tx) => {
    const run = await tx.harnessToolRun.create({
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
    const updated = await tx.harnessTool.update({
      where: { id: tool.id },
      data: {
        lastStatus: args.toolStatus,
        lastResultLabel: args.label,
        lastRanAt: args.ranAt,
        ...(args.clearApproval === true ? { approvedInterventionId: null } : {}),
      },
    });
    return { tool: updated, run };
  });
}

/**
 * Settle the row created before the spawn. An UPDATE, never a second INSERT:
 * one attempt is one row, and its id is stable from before the command started
 * to after it finished.
 */
async function settle(
  prisma: PrismaClient,
  tool: HarnessTool,
  runId: string,
  args: RecordArgs,
): Promise<ToolRunResult> {
  return prisma.$transaction(async (tx) => {
    const run = await tx.harnessToolRun.update({
      where: { id: runId },
      data: {
        status: args.status,
        label: args.label,
        exitCode: args.exitCode ?? null,
        durationMs: args.durationMs ?? null,
        output: args.output ?? null,
      },
    });
    const updated = await tx.harnessTool.update({
      where: { id: tool.id },
      data: {
        lastStatus: args.toolStatus,
        lastResultLabel: args.label,
        lastRanAt: args.ranAt,
        ...(args.clearApproval === true ? { approvedInterventionId: null } : {}),
      },
    });
    return { tool: updated, run };
  });
}

/** Why a run was turned away before it could start. */
export interface ConcurrencyRejection {
  scope: 'tool' | 'harness';
  running: number;
  limit: number;
}

/**
 * Claim an execution slot and open the `running` audit row in one locked step.
 *
 * The cap is counted from those rows, so the count and the insert have to be
 * atomic or two simultaneous requests both read "0 running" and both spawn.
 * The harness row lock is the same one the permission writes take, which
 * serialises every start on a harness.
 *
 * A rejected request deliberately writes NOTHING. A row per refusal would make
 * the rate limiter its own unbounded write amplifier — exactly the thing the
 * cap exists to prevent.
 */
async function claimRunSlot(
  prisma: PrismaClient,
  tool: HarnessTool,
  args: {
    command: string;
    cwd: string;
    permissionId: string | null;
    interventionId: string | null;
  },
): Promise<{ ok: true; runId: string } | { ok: false; rejection: ConcurrencyRejection }> {
  const freshAfter = new Date(Date.now() - INFLIGHT_STALE_AFTER_MS);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Harness" WHERE "id" = ${tool.harnessId} FOR UPDATE`,
    );
    const inflight = await tx.harnessToolRun.findMany({
      where: { harnessId: tool.harnessId, status: 'running', createdAt: { gte: freshAfter } },
      select: { toolId: true },
    });
    const perTool = inflight.filter((row) => row.toolId === tool.id).length;
    if (perTool >= MAX_INFLIGHT_PER_TOOL) {
      return { ok: false as const, rejection: { scope: 'tool' as const, running: perTool, limit: MAX_INFLIGHT_PER_TOOL } };
    }
    if (inflight.length >= MAX_INFLIGHT_PER_HARNESS) {
      return {
        ok: false as const,
        rejection: { scope: 'harness' as const, running: inflight.length, limit: MAX_INFLIGHT_PER_HARNESS },
      };
    }
    const run = await tx.harnessToolRun.create({
      data: {
        toolId: tool.id,
        harnessId: tool.harnessId,
        status: 'running',
        label: `Running "${tool.name}"…`,
        command: args.command,
        cwd: args.cwd,
        permissionId: args.permissionId,
        interventionId: args.interventionId,
      },
      select: { id: true },
    });
    return { ok: true as const, runId: run.id };
  });
}

/** A directory we can actually run in — not a file, not a dangling symlink. */
function isUsableCheckout(path: string | null): boolean {
  if (path === null) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Run a tool, or decide not to. Returns the updated tool plus the audit row
 * describing what happened — or a concurrency rejection, which is the one
 * outcome that deliberately leaves no row behind.
 */
export async function runHarnessTool(
  prisma: PrismaClient,
  tool: HarnessTool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ToolRunOutcome> {
  const command = tool.command?.trim() ?? '';
  // Order matters. The flag is checked first so that with tools disabled the
  // route never reaches the permission or concurrency machinery.
  if (!toolsEnabled(env) || command.length === 0) {
    return record(prisma, tool, {
      status: 'recorded',
      label: RECORD_ONLY_LABEL,
      toolStatus: 'recorded',
      ranAt: null,
    });
  }

  const context = await loadContext(prisma, tool);
  const cwd = context?.projectPath ?? null;
  // A path that is missing, or that exists but is a file rather than a
  // directory, is not somewhere a command can run: `spawn` would fail with an
  // opaque ENOTDIR instead of the honest record-only outcome.
  if (context === null || cwd === null || !isUsableCheckout(cwd)) {
    return record(prisma, tool, {
      status: 'recorded',
      label: NO_CHECKOUT_LABEL,
      toolStatus: 'recorded',
      ranAt: null,
      command,
      cwd,
    });
  }

  const permissionId = permissionIdFor(tool);
  const permission = context.permissions.find((entry) => entry.id === permissionId) ?? null;
  // Standing authority is a granted permission that does not itself ask for
  // per-use sign-off, on a tool that does not either. BOTH flags are honoured:
  // `needsApproval` on the tool, and `needsApproval` on the permission entry —
  // the latter was parsed, copied and documented but never read, so ticking it
  // in the spawn form bought nothing.
  const standing =
    permission?.granted === true && !permission.needsApproval && !tool.needsApproval;

  const blocked = async (): Promise<ToolRunResult> => {
    await ensurePermissionEntry(prisma, context, tool, permissionId);
    const interventionId = await ensureApprovalIntervention(prisma, context, tool, permissionId);
    return record(prisma, tool, {
      status: 'blocked-pending-approval',
      label: `Blocked: waiting on approval to run "${tool.name}"`,
      toolStatus: 'blocked',
      ranAt: null,
      command,
      cwd,
      permissionId,
      interventionId,
    });
  };

  let oneShotInterventionId: string | null = null;
  if (!standing) {
    if (tool.approvedInterventionId == null) return blocked();
    // CLAIM the one-shot grant before spawning, not after finishing. Clearing
    // it afterwards meant N concurrent requests all read the same grant and all
    // executed: approve-once was approve-N. The loser of this race gets the
    // ordinary blocked path.
    const claimed = await prisma.harnessTool.updateMany({
      where: { id: tool.id, approvedInterventionId: tool.approvedInterventionId },
      data: { approvedInterventionId: null },
    });
    if (claimed.count !== 1) return blocked();
    oneShotInterventionId = tool.approvedInterventionId;
  }

  const authorisedBy = standing
    ? { permissionId, interventionId: null }
    : { permissionId: null, interventionId: oneShotInterventionId };

  const slot = await claimRunSlot(prisma, tool, { command, cwd, ...authorisedBy });
  if (!slot.ok) return { kind: 'rejected-concurrency', ...slot.rejection };

  const result = await runShellCommand({
    command,
    cwd,
    timeoutMs: timeoutFor(tool),
    env: scrubEnv(env),
  });

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
    return settle(prisma, tool, slot.runId, {
      ...shared,
      status: 'error',
      toolStatus: 'fail',
      label: `Failed to start: ${result.spawnError}`.slice(0, 200),
    });
  }
  if (result.timedOut) {
    return settle(prisma, tool, slot.runId, {
      ...shared,
      status: 'timeout',
      toolStatus: 'fail',
      label: `timed out after ${durationLabel(timeoutFor(tool))} · killed`,
    });
  }
  const ok = result.exitCode === 0;
  return settle(prisma, tool, slot.runId, {
    ...shared,
    status: ok ? 'ok' : 'fail',
    toolStatus: ok ? 'ok' : 'fail',
    label: `${ok ? 'ok' : 'failed'} · exit ${String(result.exitCode ?? -1)} · ${durationLabel(result.durationMs)}`,
  });
}
