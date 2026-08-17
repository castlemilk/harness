import type { Router } from 'express';
import { contextWindowFor } from '@omega/core';
import {
  Prisma,
  type Harness,
  type Intervention,
  type Playbook,
  type PrismaClient,
  type Pulse,
} from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';
import { safeJsonParse } from '../lib/utils.js';

interface Permission {
  id: string;
  label: string;
  granted: boolean;
  needsApproval: boolean;
}

const permissionSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  granted: z.boolean(),
  needsApproval: z.boolean(),
});

/**
 * A use-case shell id. Kept to a lowercase slug because it is a registry key on
 * the client, not free text — `Victoria Trading` would never match a shell and
 * would fail silently as "no extra tabs appeared".
 */
const useCaseSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'useCase must be a lowercase slug, e.g. "victoria"');

const createObjectiveSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(500),
  description: z.string().max(100_000).optional(),
  useCase: useCaseSchema.optional(),
  targetDate: z.coerce.date().optional(),
  spendCapUsd: z.number().finite().nonnegative().optional(),
});

const createHarnessSchema = z.object({
  objectiveId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  workstreamId: z.string().uuid().nullable().optional(),
  playbookId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(500),
  mission: z.string().min(1).max(100_000),
  model: z.string().min(1).max(300),
  heartbeatMinutes: z.number().int().min(1).max(10_080),
  spendCapUsd: z.number().finite().nonnegative().nullable().optional(),
  maxChildren: z.number().int().min(0).max(100),
  permissions: z.array(permissionSchema).max(100),
  dryRun: z.boolean().default(false),
  taskId: z.string().uuid().nullable().optional(),
});

const harnessStatusSchema = z.enum([
  'working',
  'watching',
  'waiting',
  'failed',
  'paused',
  'ready',
  'retired',
]);

const updateHarnessSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  mission: z.string().min(1).max(100_000).optional(),
  model: z.string().min(1).max(300).optional(),
  workstreamId: z.string().uuid().nullable().optional(),
  playbookId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  heartbeatMinutes: z.number().int().min(1).max(10_080).optional(),
  spendCapUsd: z.number().finite().nonnegative().nullable().optional(),
  maxChildren: z.number().int().min(0).max(100).optional(),
  permissions: z.array(permissionSchema).max(100).optional(),
  dryRun: z.boolean().optional(),
  status: harnessStatusSchema.optional(),
}).strict();

const subtreeSchema = z.object({
  subtree: z.boolean().default(false),
});

const interjectSchema = z.object({
  text: z.string().min(1).max(100_000),
});

const resolveSchema = z.object({
  action: z.enum(['approve', 'approve-always', 'deny', 'answer', 'raise-cap', 'retire']),
  response: z.string().max(100_000).optional(),
  value: z.number().finite().nonnegative().optional(),
});

const playbookStepSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().min(1).max(10_000),
  condition: z.string().max(10_000).nullable().optional(),
});

const playbookStepsSchema = z.array(playbookStepSchema).max(500).superRefine((steps, ctx) => {
  const indexes = new Set<number>();
  for (const [position, step] of steps.entries()) {
    if (indexes.has(step.index)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [position, 'index'],
        message: `Duplicate playbook step index: ${String(step.index)}`,
      });
    }
    indexes.add(step.index);
  }
});

const versionPlaybookSchema = z.object({
  steps: playbookStepsSchema,
  variables: z.array(z.string().min(1).max(200)).max(100),
  cadence: z.string().min(1).max(500),
  retireWhen: z.string().max(10_000).nullable(),
});

function permissions(value: string): Permission[] {
  const parsed = safeJsonParse<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.label !== 'string') return [];
    return [{
      id: row.id,
      label: row.label,
      granted: row.granted === true,
      needsApproval: row.needsApproval === true,
    }];
  });
}

type HarnessStatus = z.infer<typeof harnessStatusSchema>;
type PlaybookStep = z.infer<typeof playbookStepSchema> & { condition: string | null };
type HarnessWithPauseState = Harness & { statusBeforePause: string | null };

interface HarnessDerivedFields {
  childCount: number;
  subtreeSpend: number;
  recentPulses: Record<string, unknown>[];
  routine: Record<string, unknown>[];
}

const runnableStatuses = new Set<HarnessStatus>(['ready', 'working', 'watching']);
const workstreamPausePrefix = 'workstream:';

function isHarnessStatus(value: string | null | undefined): value is HarnessStatus {
  return harnessStatusSchema.safeParse(value).success;
}

function restorableStatus(value: string | null | undefined): HarnessStatus {
  return isHarnessStatus(value) && value !== 'paused' && value !== 'retired' ? value : 'ready';
}

function workstreamPauseStatus(value: string | null | undefined): string {
  return `${workstreamPausePrefix}${restorableStatus(value)}`;
}

function statusFromWorkstreamPause(value: string | null | undefined): HarnessStatus | null {
  if (!value?.startsWith(workstreamPausePrefix)) return null;
  return restorableStatus(value.slice(workstreamPausePrefix.length));
}

function scheduledPulseAt(
  status: string,
  dryRun: boolean,
  heartbeatMinutes: number,
  now: Date,
): Date | null {
  return !dryRun && isHarnessStatus(status) && runnableStatuses.has(status)
    ? new Date(now.getTime() + heartbeatMinutes * 60_000)
    : null;
}

function pauseData(harness: HarnessWithPauseState): Prisma.HarnessUncheckedUpdateInput & {
  statusBeforePause?: string | null;
} {
  if (harness.status === 'paused') return { nextPulseAt: null };
  return {
    status: 'paused',
    statusBeforePause: restorableStatus(harness.status),
    nextPulseAt: null,
  };
}

function workstreamPauseData(harness: HarnessWithPauseState): Prisma.HarnessUncheckedUpdateInput & {
  statusBeforePause?: string | null;
} {
  if (harness.status === 'paused') return { nextPulseAt: null };
  return {
    status: 'paused',
    statusBeforePause: workstreamPauseStatus(harness.status),
    nextPulseAt: null,
  };
}

function resumeData(
  harness: HarnessWithPauseState,
  now: Date,
): (Prisma.HarnessUncheckedUpdateInput & { statusBeforePause?: string | null }) | null {
  if (harness.status !== 'paused') return null;
  if (statusFromWorkstreamPause(harness.statusBeforePause)) return null;
  const status = restorableStatus(harness.statusBeforePause);
  return {
    status,
    statusBeforePause: null,
    nextPulseAt: scheduledPulseAt(status, harness.dryRun, harness.heartbeatMinutes, now),
  };
}

function resumeWorkstreamData(
  harness: HarnessWithPauseState,
  now: Date,
): (Prisma.HarnessUncheckedUpdateInput & { statusBeforePause?: string | null }) | null {
  if (harness.status !== 'paused') return null;
  const status = statusFromWorkstreamPause(harness.statusBeforePause);
  if (!status) return null;
  return {
    status,
    statusBeforePause: null,
    nextPulseAt: scheduledPulseAt(status, harness.dryRun, harness.heartbeatMinutes, now),
  };
}

function playbookSteps(value: string | null | undefined): PlaybookStep[] {
  const parsed = safeJsonParse<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  const seenIndexes = new Set<number>();
  return parsed.flatMap((entry): PlaybookStep[] => {
    const result = playbookStepSchema.safeParse(entry);
    if (!result.success || seenIndexes.has(result.data.index)) return [];
    seenIndexes.add(result.data.index);
    return [{ ...result.data, condition: result.data.condition ?? null }];
  });
}

function pulseDto(pulse: Pulse): Record<string, unknown> {
  const durationMs = pulse.endedAt
    ? Math.max(pulse.endedAt.getTime() - pulse.startedAt.getTime(), 0)
    : null;
  return {
    id: pulse.id,
    harnessId: pulse.harnessId,
    seq: pulse.seq,
    startedAt: pulse.startedAt,
    endedAt: pulse.endedAt,
    outcome: pulse.outcome,
    summary: pulse.summary,
    costUsd: pulse.costUsd,
    tokens: pulse.tokens,
    weight: pulse.weight,
    durationMs,
    cost: pulse.costUsd,
  };
}

async function recentPulsesForHarnesses(prisma: PrismaClient, harnessIds: string[]): Promise<Pulse[]> {
  if (harnessIds.length === 0) return [];
  return prisma.$queryRaw<Pulse[]>(Prisma.sql`
    SELECT
      ranked."id", ranked."harnessId", ranked."seq", ranked."startedAt", ranked."endedAt",
      ranked."outcome", ranked."summary", ranked."costUsd", ranked."tokens", ranked."weight"
    FROM (
      SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p."harnessId" ORDER BY p."seq" DESC, p."startedAt" DESC
      ) AS "pulseRank"
      FROM "Pulse" p
      WHERE p."harnessId" IN (${Prisma.join(harnessIds)})
    ) ranked
    WHERE ranked."pulseRank" <= 12
    ORDER BY ranked."harnessId" ASC, ranked."seq" DESC, ranked."startedAt" DESC
  `);
}

function subtreeSpendFor(
  rootId: string,
  harnessById: Map<string, Harness>,
  childrenByParent: Map<string, string[]>,
): number {
  let total = 0;
  const seen = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    total += harnessById.get(id)?.spendUsd ?? 0;
    pending.push(...(childrenByParent.get(id) ?? []));
  }
  return total;
}

function harnessDto(harness: Harness, derived: HarnessDerivedFields): Record<string, unknown> {
  const now = Date.now();
  const effectiveContextWindow = harness.contextWindow > 0
    ? harness.contextWindow
    : Math.max(contextWindowFor(harness.model), 1);
  return {
    id: harness.id,
    objectiveId: harness.objectiveId,
    workstreamId: harness.workstreamId,
    parentId: harness.parentId,
    name: harness.name,
    status: harness.status,
    activity: harness.activity ?? '',
    mission: harness.mission,
    currentJob: harness.currentJob ?? '',
    model: harness.model,
    playbookId: harness.playbookId,
    taskId: harness.taskId,
    branch: harness.branch,
    heartbeatMinutes: harness.heartbeatMinutes,
    nextPulseAt: harness.nextPulseAt,
    maxChildren: harness.maxChildren,
    spendCapUsd: harness.spendCapUsd,
    spendUsd: harness.spendUsd,
    contextTokens: harness.contextTokens,
    contextWindow: effectiveContextWindow,
    permissions: permissions(harness.permissions),
    dryRun: harness.dryRun,
    lastPulseSeq: harness.lastPulseSeq,
    idleSince: harness.idleSince,
    createdAt: harness.createdAt,
    updatedAt: harness.updatedAt,
    retiredAt: harness.retiredAt,
    contextUsed: Math.min(Math.max(harness.contextTokens / effectiveContextWindow, 0), 1),
    spend: harness.spendUsd,
    spendCap: harness.spendCapUsd,
    subtreeSpend: derived.subtreeSpend,
    nextPulseInMinutes: harness.nextPulseAt
      ? Math.max(Math.ceil((harness.nextPulseAt.getTime() - now) / 60_000), 0)
      : null,
    idleMinutes: harness.idleSince
      ? Math.max(Math.floor((now - harness.idleSince.getTime()) / 60_000), 0)
      : null,
    latestPulseSeq: harness.lastPulseSeq > 0 ? harness.lastPulseSeq : null,
    ticketId: harness.taskId,
    childCount: derived.childCount,
    recentPulses: derived.recentPulses,
    routine: derived.routine,
  };
}

async function harnessDtos(prisma: PrismaClient, requestedIds: string[]): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(requestedIds)];
  if (ids.length === 0) return [];
  const requested = await prisma.harness.findMany({ where: { id: { in: ids } } });
  const objectiveIds = [...new Set(requested.map((harness) => harness.objectiveId))];
  const graph = await prisma.harness.findMany({
    where: { objectiveId: { in: objectiveIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const playbookIds = [...new Set(requested.flatMap((harness) =>
    harness.playbookId ? [harness.playbookId] : []
  ))];
  const [pulses, playbooks] = await Promise.all([
    recentPulsesForHarnesses(prisma, ids),
    prisma.playbook.findMany({ where: { id: { in: playbookIds } } }),
  ]);

  const harnessById = new Map(graph.map((harness) => [harness.id, harness]));
  const childrenByParent = new Map<string, string[]>();
  const childCounts = new Map<string, number>();
  for (const harness of graph) {
    if (!harness.parentId) continue;
    const children = childrenByParent.get(harness.parentId) ?? [];
    children.push(harness.id);
    childrenByParent.set(harness.parentId, children);
    if (harness.status !== 'retired' && harness.retiredAt === null) {
      childCounts.set(harness.parentId, (childCounts.get(harness.parentId) ?? 0) + 1);
    }
  }
  const pulsesByHarness = new Map<string, Pulse[]>();
  for (const pulse of pulses) {
    const rows = pulsesByHarness.get(pulse.harnessId) ?? [];
    rows.push(pulse);
    pulsesByHarness.set(pulse.harnessId, rows);
  }
  const playbookById = new Map(playbooks.map((playbook) => [playbook.id, playbook]));
  const requestedById = new Map(requested.map((harness) => [harness.id, harness]));

  return requestedIds.flatMap((id): Record<string, unknown>[] => {
    const harness = requestedById.get(id);
    if (!harness) return [];
    const playbook = harness.playbookId ? playbookById.get(harness.playbookId) : undefined;
    return [harnessDto(harness, {
      childCount: childCounts.get(id) ?? 0,
      subtreeSpend: subtreeSpendFor(id, harnessById, childrenByParent),
      recentPulses: (pulsesByHarness.get(id) ?? []).map(pulseDto),
      routine: playbook
        ? playbookSteps(playbook.steps).map((step) => ({
            ...step,
            id: `${playbook.id}:${String(step.index)}`,
          }))
        : [],
    })];
  });
}

async function harnessDtoById(prisma: PrismaClient, id: string): Promise<Record<string, unknown>> {
  const dto = (await harnessDtos(prisma, [id])).at(0);
  if (!dto) throw new Error('Harness disappeared after mutation');
  return dto;
}

function interventionDto(intervention: Intervention): Record<string, unknown> {
  return {
    id: intervention.id,
    objectiveId: intervention.objectiveId,
    harnessId: intervention.harnessId,
    kind: intervention.kind,
    title: intervention.title,
    detail: intervention.detail,
    impact: intervention.impact,
    payload: safeJsonParse<unknown>(intervention.payload, null),
    status: intervention.status,
    response: intervention.response,
    createdAt: intervention.createdAt,
    resolvedAt: intervention.resolvedAt,
  };
}

function playbookDto(playbook: Playbook): Record<string, unknown> {
  const parsedVariables = safeJsonParse<unknown>(playbook.variables, []);
  return {
    id: playbook.id,
    projectId: playbook.projectId,
    name: playbook.name,
    version: playbook.version,
    variables: Array.isArray(parsedVariables)
      ? parsedVariables.filter((value): value is string => typeof value === 'string')
      : [],
    cadence: playbook.cadence,
    retireWhen: playbook.retireWhen ?? '',
    steps: playbookSteps(playbook.steps).map((step) => ({
      ...step,
      id: `${playbook.id}:${String(step.index)}`,
    })),
    previousVersionId: playbook.previousVersionId,
    createdAt: playbook.createdAt,
    usedByCount: 0,
    diffFromPrevious: [],
  };
}

function subtreeIds(rows: { id: string; parentId: string | null }[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row.id);
    children.set(row.parentId, siblings);
  }
  const result: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Harness tree contains a cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    result.push(id);
    for (const child of children.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  visit(rootId);
  return result;
}

async function lockObjective(tx: Prisma.TransactionClient, objectiveId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "Objective" WHERE "id" = ${objectiveId} FOR UPDATE`,
  );
  return rows.length === 1;
}

async function lockObjectiveForHarness(
  tx: Prisma.TransactionClient,
  harnessId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ objectiveId: string }[]>(Prisma.sql`
    SELECT objective."id" AS "objectiveId"
    FROM "Objective" objective
    INNER JOIN "Harness" harness ON harness."objectiveId" = objective."id"
    WHERE harness."id" = ${harnessId}
    FOR UPDATE OF objective
  `);
  return rows[0]?.objectiveId ?? null;
}

async function lockObjectiveForWorkstream(
  tx: Prisma.TransactionClient,
  workstreamId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ objectiveId: string }[]>(Prisma.sql`
    SELECT objective."id" AS "objectiveId"
    FROM "Objective" objective
    INNER JOIN "Workstream" workstream ON workstream."objectiveId" = objective."id"
    WHERE workstream."id" = ${workstreamId}
    FOR UPDATE OF objective
  `);
  return rows[0]?.objectiveId ?? null;
}

async function lockHarnesses(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Harness"
    WHERE "id" IN (${Prisma.join([...ids].sort())})
    ORDER BY "id"
    FOR UPDATE
  `);
}

function matchingPermissionId(payload: string | null): string | null {
  const parsed = safeJsonParse<unknown>(payload, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  for (const key of ['permissionId', 'id', 'toolId']) {
    if (typeof row[key] === 'string') return row[key];
  }
  return null;
}

class ForemanMutationError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'ForemanMutationError';
  }
}

export function registerForemanMutationRoutes(r: Router, prisma: PrismaClient): void {
  r.post('/objectives', asyncHandler(async (req, res) => {
    const body = createObjectiveSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true } });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const objective = await prisma.objective.create({ data: body });
    res.status(201).json(objective);
  }));

  r.post('/harnesses', asyncHandler(async (req, res) => {
    const body = createHarnessSchema.parse(req.body);
    const parentId = body.parentId ?? null;
    const workstreamId = body.workstreamId ?? null;
    const playbookId = body.playbookId ?? null;
    const taskId = body.taskId ?? null;
    const result = await prisma.$transaction(async (tx) => {
      if (!(await lockObjective(tx, body.objectiveId))) {
        return { kind: 'error', status: 404, message: 'Objective not found' } as const;
      }
      const objective = await tx.objective.findUnique({
        where: { id: body.objectiveId },
        select: { id: true, projectId: true },
      });
      if (!objective) return { kind: 'error', status: 404, message: 'Objective not found' } as const;

      if (parentId) await lockHarnesses(tx, [parentId]);
      const parent = parentId ? await tx.harness.findUnique({ where: { id: parentId } }) : null;
      if (parentId && !parent) {
        return { kind: 'error', status: 400, message: 'Parent harness not found' } as const;
      }
      if (parent && parent.objectiveId !== objective.id) {
        return { kind: 'error', status: 400, message: 'Parent harness belongs to another objective' } as const;
      }
      if (parent?.status === 'paused') {
        return { kind: 'error', status: 409, message: 'Cannot spawn under a paused harness' } as const;
      }
      if (parent && (parent.status === 'retired' || parent.retiredAt !== null)) {
        return { kind: 'error', status: 409, message: 'Cannot spawn under a retired harness' } as const;
      }
      if (parent) {
        const childCount = await tx.harness.count({
          where: { parentId: parent.id, status: { not: 'retired' }, retiredAt: null },
        });
        if (childCount >= parent.maxChildren) {
          return { kind: 'error', status: 409, message: 'Parent harness is at capacity' } as const;
        }
      }

      if (workstreamId) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Workstream" WHERE "id" = ${workstreamId} FOR UPDATE
        `);
      }
      const workstream = workstreamId
        ? await tx.workstream.findUnique({ where: { id: workstreamId } })
        : null;
      if (workstreamId && !workstream) {
        return { kind: 'error', status: 400, message: 'Workstream not found' } as const;
      }
      if (workstream && workstream.objectiveId !== objective.id) {
        return { kind: 'error', status: 400, message: 'Workstream belongs to another objective' } as const;
      }

      const playbook = playbookId ? await tx.playbook.findUnique({ where: { id: playbookId } }) : null;
      if (playbookId && !playbook) {
        return { kind: 'error', status: 400, message: 'Playbook not found' } as const;
      }
      if (playbook?.projectId && playbook.projectId !== objective.projectId) {
        return { kind: 'error', status: 400, message: 'Playbook belongs to another project' } as const;
      }

      const task = taskId ? await tx.task.findUnique({ where: { id: taskId } }) : null;
      if (taskId && !task) {
        return { kind: 'error', status: 400, message: 'Task not found' } as const;
      }
      if (task && task.projectId !== objective.projectId) {
        return { kind: 'error', status: 400, message: 'Task belongs to another project' } as const;
      }

      const now = new Date();
      const startsPaused = workstream?.paused === true;
      const data: Prisma.HarnessUncheckedCreateInput & { statusBeforePause?: string | null } = {
        objectiveId: body.objectiveId,
        parentId,
        workstreamId,
        playbookId,
        taskId,
        name: body.name,
        mission: body.mission,
        model: body.model,
        heartbeatMinutes: body.heartbeatMinutes,
        spendCapUsd: body.spendCapUsd ?? null,
        maxChildren: body.maxChildren,
        permissions: JSON.stringify(body.permissions),
        dryRun: body.dryRun,
        status: startsPaused ? 'paused' : 'ready',
        statusBeforePause: startsPaused ? workstreamPauseStatus('ready') : null,
        nextPulseAt: startsPaused
          ? null
          : scheduledPulseAt('ready', body.dryRun, body.heartbeatMinutes, now),
      };
      const harness = await tx.harness.create({
        data,
      });
      return { kind: 'created', harness } as const;
    });
    if (result.kind === 'error') {
      res.status(result.status).json({ error: result.message });
      return;
    }
    res.status(201).json(await harnessDtoById(prisma, result.harness.id));
  }));

  r.patch('/harnesses/:id', asyncHandler(async (req, res) => {
    const body = updateHarnessSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const objectiveId = await lockObjectiveForHarness(tx, req.params.id);
      if (!objectiveId) return { kind: 'missing' } as const;
      await lockHarnesses(tx, [req.params.id]);
      const existing = await tx.harness.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return { kind: 'missing' } as const;
      const existingIsRetired = existing.status === 'retired' || existing.retiredAt !== null;
      if (existingIsRetired && body.status && body.status !== 'retired') {
        return { kind: 'retired' } as const;
      }

      const objective = await tx.objective.findUnique({
        where: { id: objectiveId },
        select: { projectId: true },
      });
      if (!objective) return { kind: 'missing' } as const;

      const effectiveWorkstreamId = body.workstreamId === undefined
        ? existing.workstreamId
        : body.workstreamId;
      let workstream: Awaited<ReturnType<typeof tx.workstream.findUnique>> = null;
      if (effectiveWorkstreamId) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Workstream" WHERE "id" = ${effectiveWorkstreamId} FOR UPDATE
        `);
        workstream = await tx.workstream.findUnique({ where: { id: effectiveWorkstreamId } });
        if (!workstream) return { kind: 'invalid', message: 'Workstream not found' } as const;
        if (workstream.objectiveId !== objectiveId) {
          return { kind: 'invalid', message: 'Workstream belongs to another objective' } as const;
        }
      }

      if (body.playbookId) {
        const playbook = await tx.playbook.findUnique({ where: { id: body.playbookId } });
        if (!playbook) return { kind: 'invalid', message: 'Playbook not found' } as const;
        if (playbook.projectId && playbook.projectId !== objective.projectId) {
          return { kind: 'invalid', message: 'Playbook belongs to another project' } as const;
        }
      }

      if (body.taskId) {
        const task = await tx.task.findUnique({ where: { id: body.taskId } });
        if (!task) return { kind: 'invalid', message: 'Task not found' } as const;
        if (task.projectId !== objective.projectId) {
          return { kind: 'invalid', message: 'Task belongs to another project' } as const;
        }
      }

      const data: Prisma.HarnessUncheckedUpdateInput & { statusBeforePause?: string | null } = {
        name: body.name,
        mission: body.mission,
        model: body.model,
        workstreamId: body.workstreamId,
        playbookId: body.playbookId,
        taskId: body.taskId,
        heartbeatMinutes: body.heartbeatMinutes,
        spendCapUsd: body.spendCapUsd,
        maxChildren: body.maxChildren,
        dryRun: body.dryRun,
        status: body.status,
        permissions: body.permissions !== undefined ? JSON.stringify(body.permissions) : undefined,
      };

      const now = new Date();
      const pausedByWorkstream = !existingIsRetired
        && workstream?.paused === true
        && body.status !== 'retired';
      const statusBeforeWorkstreamPause = statusFromWorkstreamPause(existing.statusBeforePause);
      const releasedFromWorkstreamPause = !existingIsRetired
        && statusBeforeWorkstreamPause !== null
        && workstream?.paused !== true
        && body.status === undefined;
      let effectiveStatus = existingIsRetired ? 'retired' : body.status ?? existing.status;
      if (existingIsRetired) data.status = 'retired';
      if (pausedByWorkstream) {
        effectiveStatus = 'paused';
        data.status = 'paused';
        const requestedStatus = body.status ?? existing.status;
        if (requestedStatus !== 'paused') {
          data.statusBeforePause = workstreamPauseStatus(requestedStatus);
        }
      } else if (body.status === 'paused') {
        if (existing.status !== 'paused') {
          data.statusBeforePause = restorableStatus(existing.status);
        } else if (statusBeforeWorkstreamPause) {
          data.statusBeforePause = statusBeforeWorkstreamPause;
        }
      } else if (body.status !== undefined) {
        data.statusBeforePause = null;
      } else if (releasedFromWorkstreamPause) {
        effectiveStatus = statusBeforeWorkstreamPause;
        data.status = statusBeforeWorkstreamPause;
        data.statusBeforePause = null;
      }

      if (effectiveStatus === 'retired') {
        const graph = await tx.harness.findMany({
          where: { objectiveId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        let ids: string[];
        try {
          ids = subtreeIds(graph, existing.id);
        } catch (error) {
          return {
            kind: 'invalid',
            message: error instanceof Error ? error.message : 'Harness tree contains a cycle',
          } as const;
        }
        await lockHarnesses(tx, ids);
        const targets = await tx.harness.findMany({
          where: { id: { in: ids } },
          orderBy: { id: 'asc' },
        }) as HarnessWithPauseState[];
        let rootHarness: HarnessWithPauseState | null = null;
        for (const target of targets) {
          const retirementData: Prisma.HarnessUncheckedUpdateInput & { statusBeforePause?: string | null } = {
            ...(target.id === existing.id ? data : {}),
            status: 'retired',
            retiredAt: target.retiredAt ?? now,
            nextPulseAt: null,
            statusBeforePause: null,
          };
          const updated = await tx.harness.update({ where: { id: target.id }, data: retirementData });
          if (target.id === existing.id) rootHarness = updated;
        }
        if (!rootHarness) return { kind: 'missing' } as const;
        return { kind: 'updated', harness: rootHarness } as const;
      }

      if (
        body.status !== undefined
        || body.heartbeatMinutes !== undefined
        || body.dryRun !== undefined
        || pausedByWorkstream
        || releasedFromWorkstreamPause
      ) {
        const effectiveHeartbeat = body.heartbeatMinutes ?? existing.heartbeatMinutes;
        const effectiveDryRun = body.dryRun ?? existing.dryRun;
        data.nextPulseAt = scheduledPulseAt(effectiveStatus, effectiveDryRun, effectiveHeartbeat, now);
      }
      const harness = await tx.harness.update({ where: { id: existing.id }, data });
      return { kind: 'updated', harness } as const;
    });
    if (result.kind === 'missing') {
      res.status(404).json({ error: 'Harness not found' });
      return;
    }
    if (result.kind === 'retired') {
      res.status(409).json({ error: 'Retired harnesses cannot be reactivated' });
      return;
    }
    if (result.kind === 'invalid') {
      res.status(400).json({ error: result.message });
      return;
    }
    res.json(await harnessDtoById(prisma, result.harness.id));
  }));

  const setPaused = (paused: boolean): ReturnType<typeof asyncHandler> => asyncHandler(async (req, res) => {
    const body = subtreeSchema.parse(req.body ?? {});
    try {
      const result = await prisma.$transaction(async (tx) => {
        const objectiveId = await lockObjectiveForHarness(tx, req.params.id);
        if (!objectiveId) return { kind: 'missing' } as const;
        const root = await tx.harness.findUnique({ where: { id: req.params.id } });
        if (!root) return { kind: 'missing' } as const;
        const graph = await tx.harness.findMany({
          where: { objectiveId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        let ids: string[];
        try {
          ids = body.subtree ? subtreeIds(graph, root.id) : [root.id];
        } catch (error) {
          throw new ForemanMutationError(
            409,
            error instanceof Error ? error.message : 'Harness tree contains a cycle',
          );
        }
        await lockHarnesses(tx, ids);
        const currentTargets = await tx.harness.findMany({
          where: { id: { in: ids }, status: { not: 'retired' }, retiredAt: null },
          orderBy: { id: 'asc' },
        }) as HarnessWithPauseState[];
        const targetWorkstreamIds = [...new Set(currentTargets.flatMap((harness) =>
          harness.workstreamId ? [harness.workstreamId] : []
        ))];
        const pausedWorkstreamIds = new Set(
          targetWorkstreamIds.length === 0
            ? []
            : (await tx.workstream.findMany({
                where: { id: { in: targetWorkstreamIds }, paused: true },
                select: { id: true },
              })).map((workstream) => workstream.id),
        );
        const now = new Date();
        let updated = 0;
        for (const harness of currentTargets) {
          if (paused) {
            if (harness.status === 'paused') {
              const statusBeforeWorkstreamPause = statusFromWorkstreamPause(harness.statusBeforePause);
              if (!statusBeforeWorkstreamPause) continue;
              await tx.harness.update({
                where: { id: harness.id },
                data: { statusBeforePause: statusBeforeWorkstreamPause, nextPulseAt: null },
              });
            } else {
              await tx.harness.update({ where: { id: harness.id }, data: pauseData(harness) });
            }
          } else {
            if (harness.workstreamId && pausedWorkstreamIds.has(harness.workstreamId)) continue;
            const data = resumeData(harness, now);
            if (!data) continue;
            await tx.harness.update({ where: { id: harness.id }, data });
          }
          updated += 1;
        }
        return { kind: 'updated', ids, updated } as const;
      });
      if (result.kind === 'missing') {
        res.status(404).json({ error: 'Harness not found' });
        return;
      }
      res.json({
        updated: result.updated,
        harnesses: await harnessDtos(prisma, result.ids),
      });
    } catch (error) {
      if (error instanceof ForemanMutationError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  r.post('/harnesses/:id/pause', setPaused(true));
  r.post('/harnesses/:id/resume', setPaused(false));

  r.post('/harnesses/:id/retire', asyncHandler(async (req, res) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const objectiveId = await lockObjectiveForHarness(tx, req.params.id);
        if (!objectiveId) return { kind: 'missing' } as const;
        const root = await tx.harness.findUnique({ where: { id: req.params.id } });
        if (!root) return { kind: 'missing' } as const;
        const graph = await tx.harness.findMany({
          where: { objectiveId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        let ids: string[];
        try {
          ids = subtreeIds(graph, root.id);
        } catch (error) {
          throw new ForemanMutationError(
            409,
            error instanceof Error ? error.message : 'Harness tree contains a cycle',
          );
        }
        await lockHarnesses(tx, ids);
        const targets = await tx.harness.findMany({
          where: { id: { in: ids } },
          orderBy: { id: 'asc' },
        }) as HarnessWithPauseState[];
        const now = new Date();
        for (const harness of targets) {
          const data: Prisma.HarnessUncheckedUpdateInput & { statusBeforePause?: string | null } = {
            status: 'retired',
            retiredAt: harness.retiredAt ?? now,
            nextPulseAt: null,
            statusBeforePause: null,
          };
          await tx.harness.update({ where: { id: harness.id }, data });
        }
        return { kind: 'retired', rootId: root.id } as const;
      });
      if (result.kind === 'missing') {
        res.status(404).json({ error: 'Harness not found' });
        return;
      }
      res.json(await harnessDtoById(prisma, result.rootId));
    } catch (error) {
      if (error instanceof ForemanMutationError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  }));

  r.post('/harnesses/:id/interject', asyncHandler(async (req, res) => {
    const body = interjectSchema.parse(req.body);
    const harness = await prisma.harness.findUnique({
      where: { id: req.params.id },
      include: { objective: { select: { projectId: true } } },
    });
    if (!harness) {
      res.status(404).json({ error: 'Harness not found' });
      return;
    }
    if (!harness.taskId) {
      res.status(409).json({ error: 'Harness has no linked task' });
      return;
    }
    const task = await prisma.task.findUnique({ where: { id: harness.taskId } });
    if (!task) {
      res.status(409).json({ error: 'Harness task no longer exists' });
      return;
    }
    if (task.projectId !== harness.objective.projectId) {
      res.status(400).json({ error: 'Harness task belongs to another project' });
      return;
    }
    const trace = await prisma.taskTrace.create({
      data: { taskId: task.id, role: 'user', content: body.text },
    });
    res.status(201).json({ kind: 'human', id: trace.id, at: trace.createdAt, text: body.text });
  }));

  r.post('/harnesses/:id/tools/:toolId/run', asyncHandler(async (req, res) => {
    const tool = await prisma.harnessTool.findFirst({
      where: { id: req.params.toolId, harnessId: req.params.id },
    });
    if (!tool) {
      res.status(404).json({ error: 'Harness tool not found' });
      return;
    }
    const updated = await prisma.harnessTool.update({
      where: { id: tool.id },
      data: {
        lastStatus: 'recorded',
        lastRanAt: null,
        lastResultLabel: 'Not executed: execution is not configured; request recorded only',
      },
    });
    res.json({
      ...updated,
      group: updated.groupName,
      lastResult: {
        label: updated.lastResultLabel ?? 'Not executed: execution is not configured; request recorded only',
        tone: 'idle',
      },
    });
  }));

  r.post('/interventions/:id/resolve', asyncHandler(async (req, res) => {
    const body = resolveSchema.parse(req.body);
    const intervention = await prisma.intervention.findUnique({ where: { id: req.params.id } });
    if (!intervention) {
      res.status(404).json({ error: 'Intervention not found' });
      return;
    }
    if (intervention.status !== 'pending') {
      res.status(409).json({ error: 'Intervention is already resolved' });
      return;
    }
    const status = body.action === 'deny'
      ? 'denied'
      : body.action === 'answer'
        ? 'answered'
        : body.action === 'retire' ? 'dismissed' : 'approved';
    const response = body.response
      ?? (body.action === 'raise-cap' ? `Raised spend cap to ${String(body.value)}` : body.action);

    let result: Intervention | null;
    try {
      result = await prisma.$transaction(async (tx) => {
        if (!(await lockObjective(tx, intervention.objectiveId))) {
          throw new ForemanMutationError(409, 'Intervention objective is no longer available');
        }
        const claimed = await tx.intervention.updateMany({
          where: { id: intervention.id, status: 'pending' },
          data: { status, response, resolvedAt: new Date() },
        });
        if (claimed.count !== 1) return null;

        const currentIntervention = await tx.intervention.findUnique({ where: { id: intervention.id } });
        if (!currentIntervention) {
          throw new ForemanMutationError(409, 'Intervention is no longer available');
        }
        let retirementTargets: HarnessWithPauseState[] = [];
        let harness: HarnessWithPauseState | null;
        if (body.action === 'retire') {
          const graph = await tx.harness.findMany({
            where: { objectiveId: currentIntervention.objectiveId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          let ids: string[];
          try {
            ids = subtreeIds(graph, currentIntervention.harnessId);
          } catch (error) {
            throw new ForemanMutationError(
              409,
              error instanceof Error ? error.message : 'Harness tree contains a cycle',
            );
          }
          await lockHarnesses(tx, ids);
          retirementTargets = await tx.harness.findMany({
            where: { id: { in: ids } },
            orderBy: { id: 'asc' },
          });
          harness = retirementTargets.find((entry) => entry.id === currentIntervention.harnessId) ?? null;
        } else {
          await lockHarnesses(tx, [currentIntervention.harnessId]);
          harness = await tx.harness.findUnique({
            where: { id: currentIntervention.harnessId },
          });
        }
        if (harness?.objectiveId !== currentIntervention.objectiveId) {
          throw new ForemanMutationError(400, 'Intervention target harness is invalid');
        }

        if (body.action === 'raise-cap') {
          if (body.value === undefined) {
            throw new ForemanMutationError(400, 'value is required for raise-cap');
          }
          if (body.value < harness.spendUsd || body.value < (harness.spendCapUsd ?? 0)) {
            throw new ForemanMutationError(400, 'New cap must not be lower than current spend or cap');
          }
          await tx.harness.update({ where: { id: harness.id }, data: { spendCapUsd: body.value } });
        } else if (body.action === 'approve-always') {
          const permissionId = matchingPermissionId(currentIntervention.payload);
          const currentPermissions = permissions(harness.permissions);
          if (!permissionId || !currentPermissions.some((entry) => entry.id === permissionId)) {
            throw new ForemanMutationError(400, 'Intervention has no matching harness permission');
          }
          const deduped = new Map(currentPermissions.map((entry) => [entry.id, entry]));
          const match = deduped.get(permissionId);
          if (match) deduped.set(permissionId, { ...match, granted: true });
          await tx.harness.update({
            where: { id: harness.id },
            data: { permissions: JSON.stringify([...deduped.values()]) },
          });
        } else if (body.action === 'retire') {
          const now = new Date();
          for (const target of retirementTargets) {
            const data: Prisma.HarnessUncheckedUpdateInput & { statusBeforePause?: string | null } = {
              status: 'retired',
              retiredAt: target.retiredAt ?? now,
              nextPulseAt: null,
              statusBeforePause: null,
            };
            await tx.harness.update({ where: { id: target.id }, data });
          }
        }
        return tx.intervention.findUnique({ where: { id: intervention.id } });
      });
    } catch (error) {
      if (error instanceof ForemanMutationError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
    if (!result) {
      res.status(409).json({ error: 'Intervention is already resolved' });
      return;
    }
    res.json(interventionDto(result));
  }));

  r.post('/playbooks/:id/version', asyncHandler(async (req, res) => {
    const body = versionPlaybookSchema.parse(req.body);
    const source = await prisma.playbook.findUnique({ where: { id: req.params.id } });
    if (!source) {
      res.status(404).json({ error: 'Playbook not found' });
      return;
    }
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Playbook" WHERE "name" = ${source.name} FOR UPDATE`);
      const latest = await tx.playbook.findFirst({ where: { name: source.name }, orderBy: { version: 'desc' } });
      return tx.playbook.create({
        data: {
          projectId: source.projectId,
          name: source.name,
          version: (latest?.version ?? source.version) + 1,
          variables: JSON.stringify(body.variables),
          cadence: body.cadence,
          retireWhen: body.retireWhen,
          steps: JSON.stringify(body.steps.map((step) => ({ ...step, condition: step.condition ?? null }))),
          previousVersionId: latest?.id ?? source.id,
        },
      });
    });
    res.status(201).json(playbookDto(created));
  }));

  r.post('/workstreams/:id/pause', asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const objectiveId = await lockObjectiveForWorkstream(tx, req.params.id);
      if (!objectiveId) return { kind: 'missing' } as const;
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Workstream" WHERE "id" = ${req.params.id} FOR UPDATE
      `);
      const workstream = await tx.workstream.findUnique({ where: { id: req.params.id } });
      if (!workstream) return { kind: 'missing' } as const;

      const members = await tx.harness.findMany({
        where: { workstreamId: workstream.id, status: { not: 'retired' }, retiredAt: null },
        orderBy: { id: 'asc' },
      });
      await lockHarnesses(tx, members.map((harness) => harness.id));
      const currentMembers = await tx.harness.findMany({
        where: { workstreamId: workstream.id, status: { not: 'retired' }, retiredAt: null },
        orderBy: { id: 'asc' },
      }) as HarnessWithPauseState[];
      for (const harness of currentMembers) {
        if (harness.status === 'paused') continue;
        await tx.harness.update({ where: { id: harness.id }, data: workstreamPauseData(harness) });
      }
      if (workstream.paused) return { kind: 'updated', workstream } as const;
      return {
        kind: 'updated',
        workstream: await tx.workstream.update({
          where: { id: workstream.id },
          data: { paused: true, pausedAt: new Date() },
        }),
      } as const;
    });
    if (result.kind === 'missing') {
      res.status(404).json({ error: 'Workstream not found' });
      return;
    }
    res.json(result.workstream);
  }));

  r.post('/workstreams/:id/resume', asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const objectiveId = await lockObjectiveForWorkstream(tx, req.params.id);
      if (!objectiveId) return { kind: 'missing' } as const;
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Workstream" WHERE "id" = ${req.params.id} FOR UPDATE
      `);
      const workstream = await tx.workstream.findUnique({ where: { id: req.params.id } });
      if (!workstream) return { kind: 'missing' } as const;
      if (!workstream.paused) return { kind: 'updated', workstream } as const;

      const members = await tx.harness.findMany({
        where: { workstreamId: workstream.id, status: { not: 'retired' }, retiredAt: null },
        orderBy: { id: 'asc' },
      });
      await lockHarnesses(tx, members.map((harness) => harness.id));
      const currentMembers = await tx.harness.findMany({
        where: { workstreamId: workstream.id, status: { not: 'retired' }, retiredAt: null },
        orderBy: { id: 'asc' },
      }) as HarnessWithPauseState[];
      const now = new Date();
      for (const harness of currentMembers) {
        const data = resumeWorkstreamData(harness, now);
        if (data) await tx.harness.update({ where: { id: harness.id }, data });
      }
      return {
        kind: 'updated',
        workstream: await tx.workstream.update({
          where: { id: workstream.id },
          data: { paused: false, pausedAt: null, pausedNote: null },
        }),
      } as const;
    });
    if (result.kind === 'missing') {
      res.status(404).json({ error: 'Workstream not found' });
      return;
    }
    res.json(result.workstream);
  }));
}
