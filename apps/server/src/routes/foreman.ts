import { Router } from 'express';
import { contextWindowFor } from '@omega/core';
import {
  Prisma,
  type Harness,
  type HarnessTool,
  type HarnessToolRun,
  type Intervention,
  type Playbook,
  type PrismaClient,
  type Pulse,
} from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';
import { safeJsonParse } from '../lib/utils.js';
import { parsePermissions, type HarnessPermission } from '../lib/harness-permissions.js';
import { serializeTool } from '../lib/tool-dto.js';
import { registerForemanMutationRoutes } from './foreman-mutations.js';

export type { HarnessPermission };

export interface PlaybookStep {
  index: number;
  text: string;
  condition?: string | null;
}

interface TicketTask {
  id: string;
  title: string;
  status: string;
  tags: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TicketHarness {
  id: string;
  name: string;
  status: string;
  taskId: string | null;
  branch: string | null;
  currentJob: string | null;
}

interface TranscriptHarness {
  id: string;
  status: string;
  activity: string | null;
  currentJob: string | null;
}

interface TranscriptPulse {
  id: string;
  seq: number;
  startedAt: Date;
  endedAt: Date | null;
  costUsd: number;
}

interface TranscriptTrace {
  id: string;
  role: string;
  content: string | null;
  toolCalls: string | null;
  createdAt: Date;
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type TranscriptEntry =
  | { kind: 'pulse-divider'; id: string; seq: number; at: Date; duration: string; cost: number }
  | { kind: 'plan'; id: string; text: string }
  | { kind: 'finding'; id: string; text: string }
  | {
    kind: 'tool';
    id: string;
    tool: string;
    target: string;
    duration: string | null;
    status: 'ok' | 'fail';
    resultLabel: string | null;
    output: { ok: boolean; text: string }[] | null;
  }
  | { kind: 'human'; id: string; at: Date; text: string }
  | { kind: 'live'; id: string; text: string };

interface TimedTranscriptEntry {
  at: number;
  order: number;
  entry: TranscriptEntry;
}

interface ObjectiveState {
  objective: Record<string, unknown>;
  workstreams: unknown[];
  harnesses: Record<string, unknown>[];
  interventions: Record<string, unknown>[];
  tickets: Record<string, unknown>[];
  activity: Record<string, unknown>[];
}

const projectQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
});

const interventionQuerySchema = z.object({
  objectiveId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'denied', 'answered', 'dismissed']).default('pending'),
});

const streamQuerySchema = z.object({
  objectiveId: z.string().uuid(),
});

const recentPulseLimit = 12;
const streamPulseLimit = 1_000;
const streamPulseLookbackMs = 24 * 60 * 60 * 1_000;
const streamPollMs = 15_000;

function jsonArray<T>(value: string | null | undefined): T[] {
  const parsed = safeJsonParse<unknown>(value, []);
  return Array.isArray(parsed) ? parsed as T[] : [];
}

const permissionArray = parsePermissions;

function playbookSteps(value: string | null | undefined): PlaybookStep[] {
  const seenIndexes = new Set<number>();
  return jsonArray<unknown>(value).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (
      typeof row.index !== 'number'
      || !Number.isInteger(row.index)
      || row.index < 0
      || seenIndexes.has(row.index)
      || typeof row.text !== 'string'
      || row.text.length < 1
      || row.text.length > 10_000
      || (
        row.condition !== undefined
        && row.condition !== null
        && (typeof row.condition !== 'string' || row.condition.length > 10_000)
      )
    ) return [];
    seenIndexes.add(row.index);
    return [{
      index: row.index,
      text: row.text,
      condition: typeof row.condition === 'string' || row.condition === null ? row.condition : null,
    }];
  });
}

function routineSteps(playbook: Pick<Playbook, 'id' | 'steps'>): (PlaybookStep & { id: string })[] {
  return playbookSteps(playbook.steps).map((step) => ({
    ...step,
    id: `${playbook.id}:${String(step.index)}`,
  }));
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1_000) return `${String(durationMs)}ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${String(minutes)}m ${String(remainder)}s` : `${String(minutes)}m`;
}

function pulseDurationMs(pulse: Pick<Pulse, 'startedAt' | 'endedAt'>): number | null {
  return pulse.endedAt ? Math.max(pulse.endedAt.getTime() - pulse.startedAt.getTime(), 0) : null;
}

function serializeHarness(harness: Harness, subtreeSpend: number): Record<string, unknown> {
  const now = Date.now();
  const contextWindow = harness.contextWindow > 0
    ? harness.contextWindow
    : Math.max(contextWindowFor(harness.model), 1);
  const nextPulseInMinutes = harness.nextPulseAt
    ? Math.max(Math.ceil((harness.nextPulseAt.getTime() - now) / 60_000), 0)
    : null;
  const idleMinutes = harness.idleSince
    ? Math.max(Math.floor((now - harness.idleSince.getTime()) / 60_000), 0)
    : null;
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
    contextWindow,
    permissions: permissionArray(harness.permissions),
    dryRun: harness.dryRun,
    lastPulseSeq: harness.lastPulseSeq,
    idleSince: harness.idleSince,
    createdAt: harness.createdAt,
    updatedAt: harness.updatedAt,
    retiredAt: harness.retiredAt,
    // Dashboard-facing aliases retain the persisted fields above while making
    // the wire payload directly consumable by all three Foreman shells.
    contextUsed: Math.min(Math.max(harness.contextTokens / contextWindow, 0), 1),
    spend: harness.spendUsd,
    spendCap: harness.spendCapUsd,
    subtreeSpend,
    nextPulseInMinutes,
    idleMinutes,
    latestPulseSeq: harness.lastPulseSeq > 0 ? harness.lastPulseSeq : null,
    ticketId: harness.taskId,
  };
}

function diffCount(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0 ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : 0;
}

function objectDiff(value: Record<string, unknown>, fallbackSummary: string): Record<string, unknown> {
  const lines = Array.isArray(value.lines)
    ? value.lines.flatMap((line): { kind: 'add' | 'del' | 'meta'; text: string }[] => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return [];
      const row = line as Record<string, unknown>;
      if (typeof row.text !== 'string') return [];
      const kind = row.kind === 'add' || row.kind === 'del' || row.kind === 'meta'
        ? row.kind
        : 'meta';
      return [{ kind, text: row.text }];
    })
    : [];
  return {
    added: diffCount(value.added),
    removed: diffCount(value.removed),
    filesChanged: diffCount(value.filesChanged),
    summary: typeof value.summary === 'string' ? value.summary : fallbackSummary,
    lines,
  };
}

function serializePulse(pulse: Pulse): Record<string, unknown> {
  const durationMs = pulseDurationMs(pulse);
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

function serializeIntervention(intervention: Intervention, harnessName: string | null = null): Record<string, unknown> {
  const payload = safeJsonParse<unknown>(intervention.payload, null);
  const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const rawDiff = intervention.kind === 'approval' ? payloadRecord?.diff : null;
  const diff = rawDiff && typeof rawDiff === 'object' && !Array.isArray(rawDiff)
    ? objectDiff(rawDiff as Record<string, unknown>, intervention.title)
    : typeof rawDiff === 'string'
      ? {
        added: rawDiff.split('\n').filter((line) => line.startsWith('+')).length,
        removed: rawDiff.split('\n').filter((line) => line.startsWith('-')).length,
        filesChanged: Math.max(rawDiff.match(/CREATE TABLE|diff --git/g)?.length ?? 0, 1),
        summary: intervention.title,
        lines: rawDiff.split('\n').map((line) => ({
          kind: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'meta',
          text: line,
        })),
      }
      : null;
  const budget = intervention.kind === 'budget' && payloadRecord
    && typeof payloadRecord.spent === 'number'
    && typeof payloadRecord.cap === 'number'
    && typeof payloadRecord.suggestedCap === 'number'
    ? {
      spent: payloadRecord.spent,
      cap: payloadRecord.cap,
      suggestedCap: payloadRecord.suggestedCap,
    }
    : null;
  return {
    id: intervention.id,
    objectiveId: intervention.objectiveId,
    harnessId: intervention.harnessId,
    kind: intervention.kind,
    title: intervention.title,
    detail: intervention.detail,
    impact: intervention.impact,
    payload,
    status: intervention.status,
    response: intervention.response,
    createdAt: intervention.createdAt,
    resolvedAt: intervention.resolvedAt,
    harnessName: harnessName ?? 'Unknown harness',
    diff,
    budget,
  };
}

/** A tool as read from the database, with its most recent run attached. */
function serializeToolWithRun(tool: HarnessTool & { runs: HarnessToolRun[] }): Record<string, unknown> {
  const { runs, ...rest } = tool;
  return serializeTool(rest, runs[0] ?? null);
}

/** The most recent run of each tool — the audit row the Toolkit renders. */
const lastRunInclude = { runs: { orderBy: { createdAt: 'desc' }, take: 1 } } as const;

function serializePlaybook(playbook: Playbook, usedByCount: number): Record<string, unknown> {
  return {
    id: playbook.id,
    projectId: playbook.projectId,
    name: playbook.name,
    version: playbook.version,
    variables: jsonArray<string>(playbook.variables).filter((value): value is string => typeof value === 'string'),
    cadence: playbook.cadence,
    retireWhen: playbook.retireWhen ?? '',
    steps: routineSteps(playbook),
    previousVersionId: playbook.previousVersionId,
    createdAt: playbook.createdAt,
    usedByCount,
    diffFromPrevious: [],
  };
}

function ticketProgress(tasks: Pick<TicketTask, 'status'>[]): number {
  if (tasks.length === 0) return 0;
  return tasks.filter((task) => task.status === 'done').length / tasks.length;
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function taskHasObjectiveTag(task: Pick<TicketTask, 'tags'>, objectiveId: string): boolean {
  return jsonArray<unknown>(task.tags).some((tag) =>
    typeof tag === 'string' && tag === `objective:${objectiveId}`
  );
}

function groupTasksByObjective<T extends TicketTask & { projectId: string }>(
  tasks: T[],
  projectByObjective: Map<string, string>,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const task of tasks) {
    const taskObjectiveIds = new Set(
      jsonArray<unknown>(task.tags)
        .filter((tag): tag is string => typeof tag === 'string')
        .filter((tag) => tag.startsWith('objective:'))
        .map((tag) => tag.slice('objective:'.length))
        .filter((objectiveId) => projectByObjective.get(objectiveId) === task.projectId),
    );
    for (const objectiveId of taskObjectiveIds) {
      const rows = grouped.get(objectiveId) ?? [];
      rows.push(task);
      grouped.set(objectiveId, rows);
    }
  }
  return grouped;
}

function subtreeSpendByHarness(harnesses: Harness[]): Map<string, number> {
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));
  const childrenByParent = new Map<string, Harness[]>();
  for (const harness of harnesses) {
    if (!harness.parentId) continue;
    const children = childrenByParent.get(harness.parentId) ?? [];
    children.push(harness);
    childrenByParent.set(harness.parentId, children);
  }

  const memo = new Map<string, number>();
  const calculate = (
    harnessId: string,
    visiting: Set<string>,
  ): { spend: number; cacheable: boolean } => {
    const memoized = memo.get(harnessId);
    if (memoized !== undefined) return { spend: memoized, cacheable: true };
    if (visiting.has(harnessId)) return { spend: 0, cacheable: false };

    visiting.add(harnessId);
    let spend = harnessById.get(harnessId)?.spendUsd ?? 0;
    let cacheable = true;
    for (const child of childrenByParent.get(harnessId) ?? []) {
      const childResult = calculate(child.id, visiting);
      spend += childResult.spend;
      cacheable = cacheable && childResult.cacheable;
    }
    visiting.delete(harnessId);
    if (cacheable) memo.set(harnessId, spend);
    return { spend, cacheable };
  };

  return new Map(harnesses.map((harness) => [
    harness.id,
    calculate(harness.id, new Set<string>()).spend,
  ]));
}

function activeChildCountsByHarness(harnesses: Harness[]): Map<string, number> {
  const childCounts = new Map<string, number>();
  for (const harness of harnesses) {
    if (harness.parentId && harness.status !== 'retired' && harness.retiredAt === null) {
      childCounts.set(harness.parentId, (childCounts.get(harness.parentId) ?? 0) + 1);
    }
  }
  return childCounts;
}

async function objectiveSpendById(
  prisma: PrismaClient,
  harnesses: Harness[],
  today: Date,
): Promise<Map<string, { today: number; total: number }>> {
  const spendByObjective = new Map<string, { today: number; total: number }>();
  for (const harness of harnesses) {
    const spend = spendByObjective.get(harness.objectiveId) ?? { today: 0, total: 0 };
    spend.total += harness.spendUsd;
    spendByObjective.set(harness.objectiveId, spend);
  }
  if (harnesses.length === 0) return spendByObjective;

  const todaySpendByHarness = await prisma.pulse.groupBy({
    by: ['harnessId'],
    where: {
      harnessId: { in: harnesses.map((harness) => harness.id) },
      startedAt: { gte: today },
    },
    _sum: { costUsd: true },
  });
  const objectiveByHarness = new Map(harnesses.map((harness) => [harness.id, harness.objectiveId]));
  for (const row of todaySpendByHarness) {
    const objectiveId = objectiveByHarness.get(row.harnessId);
    if (!objectiveId) continue;
    const spend = spendByObjective.get(objectiveId) ?? { today: 0, total: 0 };
    spend.today += row._sum.costUsd ?? 0;
    spendByObjective.set(objectiveId, spend);
  }
  return spendByObjective;
}

async function streamPulsesForObjective(
  prisma: PrismaClient,
  objectiveId: string,
): Promise<Pulse[]> {
  return prisma.pulse.findMany({
    where: {
      harness: { objectiveId },
      startedAt: { gte: new Date(Date.now() - streamPulseLookbackMs) },
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: streamPulseLimit,
  });
}

export function collectHarnessSubtreeIds(
  harnesses: { id: string; parentId: string | null }[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const harness of harnesses) {
    if (harness.parentId === null) continue;
    const siblings = children.get(harness.parentId) ?? [];
    siblings.push(harness.id);
    children.set(harness.parentId, siblings);
  }

  const result: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Harness tree contains a cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    result.push(id);
    for (const childId of children.get(id) ?? []) visit(childId);
    visiting.delete(id);
    visited.add(id);
  };
  visit(rootId);
  return result;
}

export function projectForemanTickets(
  tasks: TicketTask[],
  harnesses: TicketHarness[],
): Record<string, unknown>[] {
  const ownerByTask = new Map<string, TicketHarness>();
  for (const harness of harnesses) {
    if (harness.status !== 'retired' && harness.taskId !== null && !ownerByTask.has(harness.taskId)) {
      ownerByTask.set(harness.taskId, harness);
    }
  }

  const childCounts = new Map<string, number>();
  const tagsByTask = new Map<string, string[]>();
  for (const task of tasks) {
    const tags = jsonArray<string>(task.tags).filter((value): value is string => typeof value === 'string');
    tagsByTask.set(task.id, tags);
    for (const tag of tags) {
      if (!tag.startsWith('parent:')) continue;
      const parentId = tag.slice('parent:'.length);
      childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
    }
  }

  return tasks.map((task) => {
    const tags = tagsByTask.get(task.id) ?? [];
    const owner = ownerByTask.get(task.id);
    const ticketTag = tags.find((tag) => tag.startsWith('ticket:'));
    const prTag = tags.find((tag) => /^pr:\d+$/.test(tag));
    const assignmentTag = tags.find((tag) => tag.startsWith('assignment:'));
    const state = task.status === 'triaged' || task.status === 'failed'
      ? 'triaged'
      : owner?.status === 'watching'
        ? 'in-review'
        : ({
          todo: 'backlog',
          in_progress: 'in-progress',
          done: 'done',
        }[task.status] ?? 'backlog');
    const rawLabels = tags.filter((tag) => !/^(objective|parent|ticket|pr|assignment):/.test(tag));
    const labels = rawLabels.map((text) => ({
      text,
      tone: /integration/i.test(text)
        ? 'integrations'
        : /(?:urgent|block|high|security)/i.test(text)
          ? 'high'
          : /(?:backend|runtime|test|medium)/i.test(text) ? 'medium' : 'growth',
    }));

    return {
      id: task.id,
      ref: ticketTag ? ticketTag.slice('ticket:'.length) : task.id.slice(0, 6).toUpperCase(),
      title: task.title,
      state,
      ownerHarnessId: owner?.id ?? null,
      ownerHarnessName: owner?.name ?? null,
      ownerStatus: owner?.status ?? null,
      branch: owner?.branch ?? null,
      prNumber: prTag ? Number(prTag.slice('pr:'.length)) : null,
      childCount: childCounts.get(task.id) ?? 0,
      labels,
      rawLabels,
      assignmentNote: assignmentTag?.slice('assignment:'.length) ?? owner?.currentJob ?? null,
    };
  });
}

function parseToolCalls(value: string | null): ParsedToolCall[] {
  return jsonArray<unknown>(value).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const nested = row.function && typeof row.function === 'object'
      ? row.function as Record<string, unknown>
      : null;
    const name = typeof row.name === 'string'
      ? row.name
      : typeof nested?.name === 'string' ? nested.name : null;
    if (!name) return [];
    const rawArguments = row.arguments ?? nested?.arguments;
    let args: Record<string, unknown> = {};
    if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
      args = rawArguments as Record<string, unknown>;
    } else if (typeof rawArguments === 'string') {
      const parsed = safeJsonParse<unknown>(rawArguments, {});
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    }
    return [{ id: typeof row.id === 'string' ? row.id : `call-${String(index)}`, name, arguments: args }];
  });
}

function toolTarget(args: Record<string, unknown>): string {
  for (const key of ['target', 'path', 'command', 'url', 'file', 'query']) {
    if (typeof args[key] === 'string') return args[key];
  }
  return Object.keys(args).length > 0 ? JSON.stringify(args) : '';
}

export function buildTranscriptEntries(
  harness: TranscriptHarness,
  pulses: TranscriptPulse[],
  traces: TranscriptTrace[],
): TranscriptEntry[] {
  const timed: TimedTranscriptEntry[] = pulses.map((pulse, index) => ({
    at: pulse.startedAt.getTime(),
    order: index,
    entry: {
      kind: 'pulse-divider',
      id: pulse.id,
      seq: pulse.seq,
      at: pulse.startedAt,
      duration: pulse.endedAt
        ? durationLabel(Math.max(pulse.endedAt.getTime() - pulse.startedAt.getTime(), 0))
        : 'live',
      cost: pulse.costUsd,
    },
  }));

  const orderedTraces = [...traces].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const toolResults = orderedTraces.filter((trace) => trace.role === 'tool');
  let toolResultIndex = 0;
  let order = timed.length;

  for (const trace of orderedTraces) {
    if (trace.role === 'user' && trace.content) {
      timed.push({
        at: trace.createdAt.getTime(),
        order: order++,
        entry: { kind: 'human', id: trace.id, at: trace.createdAt, text: trace.content },
      });
      continue;
    }
    if (trace.role !== 'assistant') continue;
    const calls = parseToolCalls(trace.toolCalls);
    if (trace.content) {
      timed.push({
        at: trace.createdAt.getTime(),
        order: order++,
        entry: {
          kind: calls.length > 0 ? 'plan' : 'finding',
          id: trace.id,
          text: trace.content,
        },
      });
    }
    for (const call of calls) {
      const result = toolResults.at(toolResultIndex++);
      const output = result ? result.content ?? '' : '';
      const resultAt = result ? result.createdAt : trace.createdAt;
      const failed = /(?:^|\b)(?:fail|failed|error|rejected|denied)(?:\b|:)/i.test(output);
      timed.push({
        at: resultAt.getTime(),
        order: order++,
        entry: {
          kind: 'tool',
          id: `${trace.id}:${call.id}`,
          tool: call.name,
          target: toolTarget(call.arguments),
          duration: result ? durationLabel(Math.max(resultAt.getTime() - trace.createdAt.getTime(), 0)) : null,
          status: failed ? 'fail' : 'ok',
          resultLabel: output.length > 0 ? output.split('\n')[0].slice(0, 120) : null,
          output: output.length > 0
            ? output.split('\n').map((text) => ({ ok: !failed, text }))
            : null,
        },
      });
    }
  }

  timed.sort((a, b) => a.at - b.at || a.order - b.order);
  const entries = timed.map((item) => item.entry);
  if (harness.status === 'working') {
    entries.push({
      kind: 'live',
      id: `live-${harness.id}`,
      text: harness.activity ?? harness.currentJob ?? 'Working…',
    });
  }
  return entries;
}

async function recentPulsesForHarnesses(
  prisma: PrismaClient,
  harnessIds: string[],
  limit: number,
): Promise<Pulse[]> {
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
    WHERE ranked."pulseRank" <= ${limit}
    ORDER BY ranked."harnessId" ASC, ranked."seq" DESC
  `);
}

export async function loadObjectiveState(prisma: PrismaClient, objectiveId: string): Promise<ObjectiveState | null> {
  const objective = await prisma.objective.findUnique({
    where: { id: objectiveId },
    include: { phases: { orderBy: { orderIdx: 'asc' } } },
  });
  if (!objective) return null;

  const [workstreams, harnesses, interventions, projectTasks] = await Promise.all([
    prisma.workstream.findMany({ where: { objectiveId }, orderBy: [{ orderIdx: 'asc' }, { name: 'asc' }] }),
    prisma.harness.findMany({ where: { objectiveId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.intervention.findMany({
      where: { objectiveId, status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.task.findMany({ where: { projectId: objective.projectId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
  ]);
  const tasks = projectTasks.filter((task) => taskHasObjectiveTag(task, objectiveId));
  const today = utcDayStart(new Date());
  const playbookIds = [...new Set(harnesses.flatMap((harness) => harness.playbookId ? [harness.playbookId] : []))];
  const [pulses, playbooks, spendByObjective] = await Promise.all([
    recentPulsesForHarnesses(prisma, harnesses.map((harness) => harness.id), recentPulseLimit),
    prisma.playbook.findMany({ where: { id: { in: playbookIds } } }),
    objectiveSpendById(prisma, harnesses, today),
  ]);

  const pulsesByHarness = new Map<string, Pulse[]>();
  for (const pulse of pulses) {
    const rows = pulsesByHarness.get(pulse.harnessId) ?? [];
    rows.push(pulse);
    pulsesByHarness.set(pulse.harnessId, rows);
  }
  const childCounts = activeChildCountsByHarness(harnesses);
  const playbookById = new Map(playbooks.map((playbook) => [playbook.id, playbook]));
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));
  const subtreeSpend = subtreeSpendByHarness(harnesses);
  const projectedTickets = projectForemanTickets(tasks, harnesses);
  const activity: Record<string, unknown>[] = [];
  for (const task of tasks) {
    if (task.status !== 'done') continue;
    const ticket = projectedTickets.find((entry) => entry.id === task.id);
    const ticketRef = typeof ticket?.ref === 'string'
      ? ticket.ref
      : task.id.slice(0, 6).toUpperCase();
    activity.push({
      id: `merged-${task.id}`,
      verb: 'merged',
      text: `${ticketRef} ${task.title}`,
      at: task.updatedAt,
    });
  }
  for (const harness of harnesses) {
    const verb = harness.status === 'paused'
      ? 'paused'
      : harness.status === 'failed'
        ? 'failed'
        : harness.status === 'retired' ? 'retired' : 'spawned';
    activity.push({
      id: `${verb}-${harness.id}`,
      verb,
      text: harness.name,
      at: verb === 'spawned' ? harness.createdAt : harness.updatedAt,
    });
  }
  activity.sort((a, b) => {
    const aTime = a.at instanceof Date ? a.at.getTime() : 0;
    const bTime = b.at instanceof Date ? b.at.getTime() : 0;
    return bTime - aTime || String(a.id).localeCompare(String(b.id));
  });

  const spend = spendByObjective.get(objectiveId) ?? { today: 0, total: 0 };
  const daysLeft = objective.targetDate
    ? Math.max(Math.ceil((objective.targetDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1_000)), 0)
    : null;
  const stats = {
    running: harnesses.filter((harness) => harness.status === 'working').length,
    runningDelta: null,
    blocked: harnesses.filter((harness) => harness.status === 'waiting' || harness.status === 'failed').length,
    blockedNeedingYou: interventions.length,
    mergedToday: tasks.filter((task) => task.status === 'done' && task.updatedAt >= today).length,
    awaitingReview: harnesses.filter((harness) => harness.status === 'watching').length,
  };

  return {
    objective: {
      id: objective.id,
      projectId: objective.projectId,
      name: objective.name,
      description: objective.description,
      status: objective.status,
      useCase: objective.useCase,
      targetDate: objective.targetDate,
      spendCapUsd: objective.spendCapUsd,
      spendCap: objective.spendCapUsd,
      daysLeft,
      createdAt: objective.createdAt,
      updatedAt: objective.updatedAt,
      phases: objective.phases,
      progress: ticketProgress(tasks),
      ticketsTotal: tasks.length,
      ticketsDone: tasks.filter((task) => task.status === 'done').length,
      spendToday: spend.today,
      spendTotal: spend.total,
      stats,
    },
    workstreams: workstreams.map((workstream) => {
      const members = harnesses.filter((harness) =>
        harness.workstreamId === workstream.id && harness.status !== 'retired' && harness.retiredAt === null
      );
      const lead = workstream.leadHarnessId ? harnessById.get(workstream.leadHarnessId) : undefined;
      return {
        ...workstream,
        status: workstream.paused ? 'paused' : lead?.status ?? 'ready',
        agentCount: members.length,
        spend: members.reduce((sum, harness) => sum + harness.spendUsd, 0),
      };
    }),
    harnesses: harnesses.map((harness) => {
      const playbook = harness.playbookId ? playbookById.get(harness.playbookId) : undefined;
      return {
        ...serializeHarness(harness, subtreeSpend.get(harness.id) ?? harness.spendUsd),
        childCount: childCounts.get(harness.id) ?? 0,
        recentPulses: (pulsesByHarness.get(harness.id) ?? []).map(serializePulse),
        routine: playbook ? routineSteps(playbook) : [],
      };
    }),
    interventions: interventions.map((intervention) =>
      serializeIntervention(intervention, harnessById.get(intervention.harnessId)?.name ?? null)
    ),
    tickets: projectedTickets,
    activity: activity.slice(0, 50),
  };
}

function pulseChangeKey(pulse: Pulse): string {
  return [
    pulse.seq,
    pulse.endedAt?.getTime() ?? '',
    pulse.outcome,
    pulse.summary ?? '',
    pulse.costUsd,
    pulse.tokens,
    pulse.weight,
  ].join(':');
}

function interventionChangeKey(intervention: Intervention): string {
  return [
    intervention.status,
    intervention.response ?? '',
    intervention.resolvedAt?.getTime() ?? '',
    intervention.payload ?? '',
  ].join(':');
}

async function objectiveListPayload(prisma: PrismaClient, projectId?: string): Promise<Record<string, unknown>[]> {
  const objectives = await prisma.objective.findMany({
    where: projectId ? { projectId } : undefined,
    include: { phases: { orderBy: { orderIdx: 'asc' } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  if (objectives.length === 0) return [];

  const objectiveIds = objectives.map((objective) => objective.id);
  const projectIds = [...new Set(objectives.map((objective) => objective.projectId))];
  const [harnesses, interventions, tasks] = await Promise.all([
    prisma.harness.findMany({ where: { objectiveId: { in: objectiveIds } } }),
    prisma.intervention.findMany({ where: { objectiveId: { in: objectiveIds }, status: 'pending' } }),
    prisma.task.findMany({ where: { projectId: { in: projectIds } } }),
  ]);
  const today = utcDayStart(new Date());
  const spendByObjective = await objectiveSpendById(prisma, harnesses, today);

  const harnessesByObjective = new Map<string, Harness[]>();
  for (const harness of harnesses) {
    const rows = harnessesByObjective.get(harness.objectiveId) ?? [];
    rows.push(harness);
    harnessesByObjective.set(harness.objectiveId, rows);
  }
  const tasksByObjective = groupTasksByObjective(
    tasks,
    new Map(objectives.map((objective) => [objective.id, objective.projectId])),
  );
  const pendingByObjective = new Map<string, number>();
  for (const intervention of interventions) {
    pendingByObjective.set(intervention.objectiveId, (pendingByObjective.get(intervention.objectiveId) ?? 0) + 1);
  }
  return objectives.map((objective) => {
    const objectiveHarnesses = harnessesByObjective.get(objective.id) ?? [];
    const objectiveTasks = tasksByObjective.get(objective.id) ?? [];
    const spend = spendByObjective.get(objective.id) ?? { today: 0, total: 0 };
    const daysLeft = objective.targetDate
      ? Math.max(Math.ceil((objective.targetDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1_000)), 0)
      : null;
    return {
      id: objective.id,
      projectId: objective.projectId,
      name: objective.name,
      description: objective.description,
      status: objective.status,
      useCase: objective.useCase,
      targetDate: objective.targetDate,
      spendCapUsd: objective.spendCapUsd,
      spendCap: objective.spendCapUsd,
      daysLeft,
      createdAt: objective.createdAt,
      updatedAt: objective.updatedAt,
      phases: objective.phases,
      progress: ticketProgress(objectiveTasks),
      ticketsTotal: objectiveTasks.length,
      ticketsDone: objectiveTasks.filter((task) => task.status === 'done').length,
      spendToday: spend.today,
      spendTotal: spend.total,
      stats: {
        running: objectiveHarnesses.filter((harness) => harness.status === 'working').length,
        runningDelta: null,
        blocked: objectiveHarnesses.filter((harness) => harness.status === 'waiting' || harness.status === 'failed').length,
        blockedNeedingYou: pendingByObjective.get(objective.id) ?? 0,
        mergedToday: objectiveTasks.filter((task) => task.status === 'done' && task.updatedAt >= today).length,
        awaitingReview: objectiveHarnesses.filter((harness) => harness.status === 'watching').length,
      },
    };
  });
}

async function usagePayload(
  prisma: PrismaClient,
  objectiveId: string,
  requestedDays: number,
): Promise<Record<string, unknown> | null> {
  const objective = await prisma.objective.findUnique({ where: { id: objectiveId } });
  if (!objective) return null;
  const harnesses = await prisma.harness.findMany({
    where: { objectiveId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const now = new Date();
  const currentDay = utcDayStart(now);
  const start = new Date(currentDay.getTime() - (requestedDays - 1) * 24 * 60 * 60 * 1000);
  const end = new Date(currentDay.getTime() + 24 * 60 * 60 * 1000);
  const previousStart = new Date(start.getTime() - requestedDays * 24 * 60 * 60 * 1000);
  const harnessIds = harnesses.map((harness) => harness.id);
  const [pulses, projectTasks] = await Promise.all([
    harnessIds.length === 0
      ? Promise.resolve([] as Pulse[])
      : prisma.pulse.findMany({
        where: { harnessId: { in: harnessIds }, startedAt: { gte: previousStart, lt: end } },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      }),
    prisma.task.findMany({ where: { projectId: objective.projectId } }),
  ]);
  const tasks = projectTasks.filter((task) => taskHasObjectiveTag(task, objectiveId));
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));
  const currentPulses = pulses.filter((pulse) => pulse.startedAt >= start);
  const previousPulses = pulses.filter((pulse) => pulse.startedAt < start);
  const spend = currentPulses.reduce((sum, pulse) => sum + pulse.costUsd, 0);
  const previousSpend = previousPulses.reduce((sum, pulse) => sum + pulse.costUsd, 0);
  const tokens = currentPulses.reduce((sum, pulse) => sum + pulse.tokens, 0);
  const merged = tasks.filter((task) => task.status === 'done' && task.updatedAt >= start && task.updatedAt < end).length;
  const previousMerged = tasks.filter((task) =>
    task.status === 'done' && task.updatedAt >= previousStart && task.updatedAt < start
  ).length;
  const costPerMergedTicket = merged > 0 ? spend / merged : null;
  const previousCostPerTicket = previousMerged > 0 ? previousSpend / previousMerged : null;
  const costPerTicketDelta = costPerMergedTicket !== null
    && previousCostPerTicket !== null
    && previousCostPerTicket > 0
    ? (costPerMergedTicket - previousCostPerTicket) / previousCostPerTicket
    : null;

  const days = Array.from({ length: requestedDays }, (_, index) => {
    const day = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
    const byModel: Record<string, number> = {};
    const label = dateLabel(day);
    return { label, byModel, projected: label === dateLabel(currentDay) };
  });
  const dayByLabel = new Map(days.map((day) => [day.label, day]));
  const modelSet = new Set<string>();
  const spendByHarness = new Map<string, number>();
  const latestPulseByHarness = new Map<string, Pulse>();
  for (const pulse of currentPulses) {
    const harness = harnessById.get(pulse.harnessId);
    if (!harness) continue;
    const label = dateLabel(pulse.startedAt);
    const day = dayByLabel.get(label);
    if (day) day.byModel[harness.model] = (day.byModel[harness.model] ?? 0) + pulse.costUsd;
    modelSet.add(harness.model);
    spendByHarness.set(harness.id, (spendByHarness.get(harness.id) ?? 0) + pulse.costUsd);
    const latest = latestPulseByHarness.get(harness.id);
    if (!latest || latest.startedAt < pulse.startedAt) latestPulseByHarness.set(harness.id, pulse);
  }
  const childCounts = new Map<string, number>();
  for (const harness of harnesses) {
    if (harness.parentId && harness.status !== 'retired' && harness.retiredAt === null) {
      childCounts.set(harness.parentId, (childCounts.get(harness.parentId) ?? 0) + 1);
    }
  }
  const toneByOutcome: Record<string, string> = { ok: 'ok', warn: 'neutral', fail: 'fail', idle: 'neutral' };
  const rankedSpenders = harnesses
    .map((harness) => {
      const harnessSpend = spendByHarness.get(harness.id) ?? 0;
      const latest = latestPulseByHarness.get(harness.id);
      return {
        harnessId: harness.id,
        name: harness.name,
        childCount: childCounts.get(harness.id) ?? 0,
        spend: harnessSpend,
        share: 0,
        outcome: latest?.summary ?? latest?.outcome ?? harness.status,
        outcomeTone: toneByOutcome[latest?.outcome ?? ''] ?? (harness.status === 'failed' ? 'fail' : 'neutral'),
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
  const topSpend = rankedSpenders[0]?.spend ?? 0;
  const topSpenders = rankedSpenders.slice(0, 10).map((spender) => ({
    ...spender,
    share: topSpend > 0 ? spender.spend / topSpend : 0,
  }));
  const wasted = currentPulses.reduce((sum, pulse) =>
    pulse.outcome === 'fail' ? sum + pulse.costUsd : sum
  , 0);

  return {
    spend,
    spendCap: objective.spendCapUsd,
    tokens,
    cacheHitRate: null,
    costPerMergedTicket,
    costPerTicketDelta,
    wasted,
    harnessCount: harnesses.length,
    days,
    models: [...modelSet].sort(),
    topSpenders,
  };
}

export function foremanRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/objectives', asyncHandler(async (req, res) => {
    const query = projectQuerySchema.parse({
      projectId: typeof req.query.projectId === 'string' && req.query.projectId.length > 0
        ? req.query.projectId
        : undefined,
    });
    res.json(await objectiveListPayload(prisma, query.projectId));
  }));

  r.get('/objectives/:id/state', asyncHandler(async (req, res) => {
    const state = await loadObjectiveState(prisma, req.params.id);
    if (!state) {
      res.status(404).json({ error: 'Objective not found' });
      return;
    }
    res.json(state);
  }));

  r.get('/harnesses/:id/pulses', asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(12).parse(req.query.limit ?? 12);
    const exists = await prisma.harness.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ error: 'Harness not found' });
      return;
    }
    const pulses = await prisma.pulse.findMany({
      where: { harnessId: req.params.id },
      orderBy: [{ seq: 'desc' }, { startedAt: 'desc' }],
      take: limit,
    });
    res.json(pulses.map(serializePulse));
  }));

  r.get('/harnesses/:id/transcript', asyncHandler(async (req, res) => {
    const harness = await prisma.harness.findUnique({ where: { id: req.params.id } });
    if (!harness) {
      res.status(404).json({ error: 'Harness not found' });
      return;
    }
    const [pulses, traces] = await Promise.all([
      prisma.pulse.findMany({ where: { harnessId: harness.id }, orderBy: [{ startedAt: 'asc' }, { seq: 'asc' }] }),
      harness.taskId
        ? prisma.taskTrace.findMany({ where: { taskId: harness.taskId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
        : Promise.resolve([]),
    ]);
    res.json(buildTranscriptEntries(harness, pulses, traces));
  }));

  r.get('/harnesses/:id/tools', asyncHandler(async (req, res) => {
    const exists = await prisma.harness.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ error: 'Harness not found' });
      return;
    }
    const tools = await prisma.harnessTool.findMany({
      where: { harnessId: req.params.id },
      orderBy: [{ groupName: 'asc' }, { name: 'asc' }],
      include: lastRunInclude,
    });
    res.json(tools.map(serializeToolWithRun));
  }));

  r.get('/harnesses/:id', asyncHandler(async (req, res) => {
    const harness = await prisma.harness.findUnique({
      where: { id: req.params.id },
      include: {
        parent: true,
        children: {
          where: { status: { not: 'retired' }, retiredAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        pulses: { orderBy: [{ seq: 'desc' }, { startedAt: 'desc' }], take: recentPulseLimit },
        tools: { orderBy: [{ groupName: 'asc' }, { name: 'asc' }], include: lastRunInclude },
      },
    });
    if (!harness) {
      res.status(404).json({ error: 'Harness not found' });
      return;
    }
    const [playbook, usedByCount, objectiveHarnesses] = await Promise.all([
      harness.playbookId
        ? prisma.playbook.findUnique({ where: { id: harness.playbookId } })
        : Promise.resolve(null),
      harness.playbookId
        ? prisma.harness.count({ where: { playbookId: harness.playbookId } })
        : Promise.resolve(0),
      prisma.harness.findMany({ where: { objectiveId: harness.objectiveId } }),
    ]);
    const subtreeSpend = subtreeSpendByHarness(objectiveHarnesses);
    res.json({
      ...serializeHarness(harness, subtreeSpend.get(harness.id) ?? harness.spendUsd),
      parent: harness.parent
        ? serializeHarness(harness.parent, subtreeSpend.get(harness.parent.id) ?? harness.parent.spendUsd)
        : null,
      children: harness.children.map((child) =>
        serializeHarness(child, subtreeSpend.get(child.id) ?? child.spendUsd)
      ),
      pulses: harness.pulses.map(serializePulse),
      recentPulses: harness.pulses.map(serializePulse),
      childCount: harness.children.length,
      routine: playbook ? routineSteps(playbook) : [],
      tools: harness.tools.map(serializeToolWithRun),
      playbook: playbook ? serializePlaybook(playbook, usedByCount) : null,
    });
  }));

  r.get('/interventions', asyncHandler(async (req, res) => {
    const query = interventionQuerySchema.parse({
      objectiveId: typeof req.query.objectiveId === 'string' && req.query.objectiveId.length > 0
        ? req.query.objectiveId
        : undefined,
      status: typeof req.query.status === 'string' && req.query.status.length > 0
        ? req.query.status
        : undefined,
    });
    const interventions = await prisma.intervention.findMany({
      where: { objectiveId: query.objectiveId, status: query.status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const harnessIds = [...new Set(interventions.map((intervention) => intervention.harnessId))];
    const harnesses = harnessIds.length > 0
      ? await prisma.harness.findMany({ where: { id: { in: harnessIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(harnesses.map((harness) => [harness.id, harness.name]));
    res.json(interventions.map((intervention) =>
      serializeIntervention(intervention, names.get(intervention.harnessId) ?? null)
    ));
  }));

  r.get('/playbooks', asyncHandler(async (_req, res) => {
    const [playbooks, references] = await Promise.all([
      prisma.playbook.findMany({ orderBy: [{ name: 'asc' }, { version: 'desc' }] }),
      prisma.harness.findMany({ where: { playbookId: { not: null } }, select: { playbookId: true } }),
    ]);
    const counts = new Map<string, number>();
    for (const reference of references) {
      if (reference.playbookId) counts.set(reference.playbookId, (counts.get(reference.playbookId) ?? 0) + 1);
    }
    res.json(playbooks.map((playbook) => serializePlaybook(playbook, counts.get(playbook.id) ?? 0)));
  }));

  r.get('/playbooks/:id', asyncHandler(async (req, res) => {
    const [playbook, usedByCount] = await Promise.all([
      prisma.playbook.findUnique({ where: { id: req.params.id } }),
      prisma.harness.count({ where: { playbookId: req.params.id } }),
    ]);
    if (!playbook) {
      res.status(404).json({ error: 'Playbook not found' });
      return;
    }
    res.json(serializePlaybook(playbook, usedByCount));
  }));

  r.get('/objectives/:id/usage', asyncHandler(async (req, res) => {
    const days = z.coerce.number().int().min(1).max(90).default(7).parse(req.query.days ?? 7);
    const payload = await usagePayload(prisma, req.params.id, days);
    if (!payload) {
      res.status(404).json({ error: 'Objective not found' });
      return;
    }
    res.json(payload);
  }));

  r.get('/objectives/:id/tickets', asyncHandler(async (req, res) => {
    const objective = await prisma.objective.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!objective) {
      res.status(404).json({ error: 'Objective not found' });
      return;
    }
    const [projectTasks, harnesses] = await Promise.all([
      prisma.task.findMany({ where: { projectId: objective.projectId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      prisma.harness.findMany({ where: { objectiveId: req.params.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    const tasks = projectTasks.filter((task) => taskHasObjectiveTag(task, req.params.id));
    res.json(projectForemanTickets(tasks, harnesses));
  }));

  registerForemanMutationRoutes(r, prisma);

  r.get('/stream', asyncHandler(async (req, res) => {
    const query = streamQuerySchema.parse({
      objectiveId: typeof req.query.objectiveId === 'string' ? req.query.objectiveId : undefined,
    });
    // Establish the diff baseline first. A write between this baseline and the
    // init snapshot may be emitted twice, but can never be omitted forever.
    const [initialHarnesses, initialPulses, initialInterventions] = await Promise.all([
      prisma.harness.findMany({ where: { objectiveId: query.objectiveId } }),
      streamPulsesForObjective(prisma, query.objectiveId),
      prisma.intervention.findMany({ where: { objectiveId: query.objectiveId } }),
    ]);
    const state = await loadObjectiveState(prisma, query.objectiveId);
    if (!state) {
      res.status(404).json({ error: 'Objective not found' });
      return;
    }
    let harnessKeys = new Map(initialHarnesses.map((harness) => [harness.id, harness.updatedAt.getTime()]));
    let pulseKeys = new Map(initialPulses.map((pulse) => [pulse.id, pulseChangeKey(pulse)]));
    let interventionKeys = new Map(initialInterventions.map((intervention) => [intervention.id, interventionChangeKey(intervention)]));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    let closed = false;
    const streamClosed = (): boolean => closed || res.writableEnded;
    const send = (event: string, data: unknown): void => {
      if (streamClosed()) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('init', state);

    let polling = false;
    const tick = async (): Promise<void> => {
      if (streamClosed() || polling) return;
      polling = true;
      try {
        const [harnesses, pulses, interventions] = await Promise.all([
          prisma.harness.findMany({ where: { objectiveId: query.objectiveId } }),
          streamPulsesForObjective(prisma, query.objectiveId),
          prisma.intervention.findMany({ where: { objectiveId: query.objectiveId } }),
        ]);
        if (streamClosed()) return;
        const nextHarnessKeys = new Map(
          harnesses.map((harness) => [harness.id, harness.updatedAt.getTime()]),
        );
        const harnessesChanged = nextHarnessKeys.size !== harnessKeys.size
          || harnesses.some((harness) => harnessKeys.get(harness.id) !== harness.updatedAt.getTime());
        if (harnessesChanged) {
          const subtreeSpend = subtreeSpendByHarness(harnesses);
          const childCounts = activeChildCountsByHarness(harnesses);
          // A harness patch has to carry `recentPulses`, because a harness the
          // client has never seen arrives on this path: another client's spawn
          // appends a *new* entry to the fleet rather than merging into an
          // existing one, and every shell maps over that array on render. The
          // shape matches the init snapshot's — newest first, capped the same
          // way — but the source is the stream's own bounded window, so a
          // harness whose pulses predate it patches in with an empty list
          // rather than a stale one.
          const streamPulsesByHarness = new Map<string, Pulse[]>();
          for (const pulse of pulses) {
            const rows = streamPulsesByHarness.get(pulse.harnessId) ?? [];
            rows.push(pulse);
            streamPulsesByHarness.set(pulse.harnessId, rows);
          }
          for (const rows of streamPulsesByHarness.values()) {
            rows.sort((a, b) => b.seq - a.seq || b.startedAt.getTime() - a.startedAt.getTime());
          }
          for (const harness of harnesses) {
            send('harness', {
              ...serializeHarness(harness, subtreeSpend.get(harness.id) ?? harness.spendUsd),
              childCount: childCounts.get(harness.id) ?? 0,
              recentPulses: (streamPulsesByHarness.get(harness.id) ?? [])
                .slice(0, recentPulseLimit)
                .map(serializePulse),
            });
          }
        }
        harnessKeys = nextHarnessKeys;
        const nextPulseKeys = new Map<string, string>();
        for (const pulse of pulses) {
          const key = pulseChangeKey(pulse);
          nextPulseKeys.set(pulse.id, key);
          if (pulseKeys.get(pulse.id) === key) continue;
          send('pulse', { harnessId: pulse.harnessId, pulse: serializePulse(pulse) });
        }
        pulseKeys = nextPulseKeys;
        const nextInterventionKeys = new Map<string, string>();
        for (const intervention of interventions) {
          const key = interventionChangeKey(intervention);
          nextInterventionKeys.set(intervention.id, key);
          if (interventionKeys.get(intervention.id) === key) continue;
          send(
            'intervention',
            serializeIntervention(
              intervention,
              harnesses.find((harness) => harness.id === intervention.harnessId)?.name ?? null,
            ),
          );
        }
        interventionKeys = nextInterventionKeys;
      } catch (error) {
        console.error('SSE Foreman stream poll error', error);
      } finally {
        polling = false;
      }
    };
    const poll = setInterval(() => { void tick(); }, streamPollMs);
    const heartbeat = setInterval(() => {
      if (!streamClosed()) res.write(': ping\n\n');
    }, 15_000);
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      req.off('close', close);
      res.end();
    };
    req.on('close', close);
  }));

  return r;
}
