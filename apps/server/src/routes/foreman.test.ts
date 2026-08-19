import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, prisma, seedForemanDemo, type PrismaClient } from '@omega/db';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { app } from '../app.js';
import { parsePermissions } from '../lib/harness-permissions.js';
import { remoteExposureWarning } from '../lib/tool-runner.js';
import * as foremanModule from './foreman.js';

vi.hoisted(() => {
  // Keep this migration-heavy suite off the shared PGlite directory used by
  // app.test.ts when Vitest runs files in parallel workers.
  process.env.DATABASE_DIR = `/tmp/omega-foreman-vitest-${String(process.pid)}-${process.env.VITEST_WORKER_ID ?? '0'}`;
});

const { foremanRoutes } = foremanModule;

interface ExpressLayer {
  regexp?: RegExp;
}

interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack?: { handle: RequestHandler }[];
  };
}

interface RouteResult {
  status: number;
  body: unknown;
}

interface HarnessFixtureOptions {
  name: string;
  parentId?: string | null;
  workstreamId?: string | null;
  status?: string;
  nextPulseAt?: Date | null;
  playbookId?: string | null;
  spendUsd?: number;
  lastPulseSeq?: number;
  maxChildren?: number;
  dryRun?: boolean;
  contextTokens?: number;
  contextWindow?: number;
}

function findRouteHandler(
  router: ReturnType<typeof foremanRoutes>,
  method: string,
  path: string,
): RequestHandler {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  const layer = stack.find((candidate) =>
    candidate.route?.path === path && candidate.route.methods[method.toLowerCase()] === true
  );
  const handler = layer?.route?.stack?.[0]?.handle;
  if (!handler) throw new Error(`Route not registered: ${method.toUpperCase()} ${path}`);
  return handler;
}

async function invokeRoute(
  router: ReturnType<typeof foremanRoutes>,
  method: string,
  path: string,
  input: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<RouteResult> {
  const handler = findRouteHandler(router, method, path);

  return new Promise<RouteResult>((resolve, reject) => {
    let status = 200;
    let settled = false;
    const finish = (body: unknown): void => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    const response = {
      status(code: number) {
        status = code;
        return response;
      },
      json(body: unknown) {
        finish(body);
        return response;
      },
      send(body?: unknown) {
        finish(body);
        return response;
      },
    };
    const request = {
      params: input.params ?? {},
      query: input.query ?? {},
      body: input.body ?? {},
      headers: input.headers ?? {},
    };
    const next: NextFunction = (error?: unknown) => {
      if (error) reject(error);
      else reject(new Error(`Route called next() without a response: ${method.toUpperCase()} ${path}`));
    };

    handler(request as Request, response as unknown as Response, next);
  });
}

async function createHarnessFixture(
  objectiveId: string,
  options: HarnessFixtureOptions,
) {
  return prisma.harness.create({
    data: {
      objectiveId,
      name: options.name,
      parentId: options.parentId ?? null,
      workstreamId: options.workstreamId ?? null,
      status: options.status ?? 'ready',
      nextPulseAt: options.nextPulseAt ?? null,
      playbookId: options.playbookId ?? null,
      mission: `Exercise ${options.name}.`,
      model: 'test-model',
      heartbeatMinutes: 15,
      maxChildren: options.maxChildren ?? 3,
      permissions: '[]',
      spendUsd: options.spendUsd ?? 0,
      lastPulseSeq: options.lastPulseSeq ?? 0,
      dryRun: options.dryRun ?? false,
      contextTokens: options.contextTokens ?? 0,
      contextWindow: options.contextWindow ?? 200_000,
    },
  });
}

describe('Foreman API registration', () => {
  it('mounts the Foreman router at /foreman', () => {
    const stack = (app as unknown as { _router?: { stack: ExpressLayer[] } })._router?.stack ?? [];
    expect(stack.some((layer) => layer.regexp?.source.includes('foreman') === true)).toBe(true);
  });

  it('registers the complete Foreman HTTP surface', () => {
    const router = foremanRoutes({} as PrismaClient) as unknown as { stack: RouterLayer[] };
    const registered = router.stack.flatMap((layer) => {
      if (!layer.route) return [];
      return Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${layer.route?.path ?? ''}`);
    });

    expect(new Set(registered)).toEqual(new Set([
      'GET /objectives',
      'GET /objectives/:id/state',
      'GET /harnesses/:id',
      'GET /harnesses/:id/pulses',
      'GET /harnesses/:id/transcript',
      'GET /harnesses/:id/tools',
      'GET /interventions',
      'GET /playbooks',
      'GET /playbooks/:id',
      'GET /objectives/:id/usage',
      'GET /objectives/:id/tickets',
      'POST /objectives',
      'POST /harnesses',
      'PATCH /harnesses/:id',
      'POST /harnesses/:id/pause',
      'POST /harnesses/:id/resume',
      'POST /harnesses/:id/retire',
      'POST /harnesses/:id/interject',
      'POST /harnesses/:id/tools/:toolId/run',
      'POST /interventions/:id/resolve',
      'POST /playbooks/:id/version',
      'POST /workstreams/:id/pause',
      'POST /workstreams/:id/resume',
      'GET /stream',
    ]));
  });
});

describe('Foreman persistence', () => {
  it('defines every orchestration model and the arbitrary-depth harness relation', async () => {
    const schemaUrl = new URL('../../../../packages/db/prisma/schema.prisma', import.meta.url);
    const schema = await readFile(schemaUrl, 'utf8');

    for (const model of [
      'Objective',
      'ObjectivePhase',
      'Workstream',
      'Harness',
      'Pulse',
      'Intervention',
      'Playbook',
      'HarnessTool',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    expect(schema).toContain('@relation("HarnessTree"');
    expect(schema).toMatch(/statusBeforePause\s+String\?/);
    expect(schema).toMatch(/useCase\s+String\?/);
    expect(schema).toContain('@@index([harnessId, startedAt(sort: Desc)])');
  });

  it('ships an additive Foreman migration', async () => {
    const migrationsUrl = new URL('../../../../packages/db/prisma/migrations', import.meta.url);
    const migrations = await readdir(migrationsUrl);
    expect(migrations.some((name) => /^\d{14}_add_foreman_orchestration$/.test(name))).toBe(true);
    const migrationSql = (await Promise.all(migrations.map((name) =>
      readFile(new URL(`${name}/migration.sql`, `${migrationsUrl.href}/`), 'utf8')
    ))).join('\n');
    const statusBeforePauseDefinition = migrationSql
      .split('\n')
      .find((line) => line.includes('"statusBeforePause"'));
    const definition = statusBeforePauseDefinition ?? '';
    expect(definition).toMatch(/"statusBeforePause"\s+TEXT/);
    expect(definition).not.toContain('NOT NULL');
    expect(migrationSql).toContain(
      'CREATE INDEX "Pulse_harnessId_startedAt_idx" ON "Pulse"("harnessId", "startedAt" DESC)',
    );

    // The use-case discriminator has to be additive: every existing objective
    // predates it and must keep rendering the core chrome.
    const useCaseDefinition = migrationSql
      .split('\n')
      .find((line) => line.includes('ADD COLUMN "useCase"')) ?? '';
    expect(useCaseDefinition).toBe('ALTER TABLE "Objective" ADD COLUMN "useCase" TEXT;');
    expect(useCaseDefinition).not.toContain('NOT NULL');
  });
});

describe('Foreman projections', () => {
  it('walks an arbitrary-depth harness subtree and rejects cycles', () => {
    const collectSubtree = (foremanModule as unknown as {
      collectHarnessSubtreeIds?: (
        harnesses: { id: string; parentId: string | null }[],
        rootId: string,
      ) => string[];
    }).collectHarnessSubtreeIds;

    expect(collectSubtree).toBeTypeOf('function');
    if (!collectSubtree) return;

    expect(collectSubtree([
      { id: 'root', parentId: null },
      { id: 'child-a', parentId: 'root' },
      { id: 'grandchild', parentId: 'child-a' },
      { id: 'child-b', parentId: 'root' },
      { id: 'sibling-root', parentId: null },
    ], 'root')).toEqual(['root', 'child-a', 'grandchild', 'child-b']);

    expect(() => collectSubtree([
      { id: 'a', parentId: 'c' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ], 'a')).toThrow(/cycle/i);
  });

  it('projects task tags, ownership, review state, and child counts', () => {
    const projectTickets = (foremanModule as unknown as {
      projectForemanTickets?: (
        tasks: {
          id: string;
          title: string;
          status: string;
          tags: string | null;
          createdAt: Date;
          updatedAt: Date;
        }[],
        harnesses: {
          id: string;
          name: string;
          status: string;
          taskId: string | null;
          branch: string | null;
          currentJob: string | null;
        }[],
      ) => Record<string, unknown>[];
    }).projectForemanTickets;

    expect(projectTickets).toBeTypeOf('function');
    if (!projectTickets) return;

    const at = new Date('2026-08-14T00:00:00.000Z');
    const tickets = projectTickets([
      {
        id: 'abcdef12-0000-0000-0000-000000000000',
        title: 'Ship the orchestration view',
        status: 'in_progress',
        tags: JSON.stringify(['ticket:FM-101', 'pr:42', 'backend', 'assignment:Review the API']),
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'child-task',
        title: 'Add endpoint tests',
        status: 'todo',
        tags: JSON.stringify(['parent:abcdef12-0000-0000-0000-000000000000', 'tests']),
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'failed-task',
        title: 'Re-triage a failed run',
        status: 'failed',
        tags: JSON.stringify(['ticket:FM-FAIL']),
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'triaged-task',
        title: 'Keep a triaged run queued',
        status: 'triaged',
        tags: JSON.stringify(['ticket:FM-TRIAGE']),
        createdAt: at,
        updatedAt: at,
      },
    ], [
      {
        id: 'harness-1',
        name: 'API reviewer',
        status: 'watching',
        taskId: 'abcdef12-0000-0000-0000-000000000000',
        branch: 'agent/foreman-api',
        currentJob: 'Reviewing PR #42',
      },
      {
        id: 'harness-2',
        name: 'Failure reviewer',
        status: 'watching',
        taskId: 'failed-task',
        branch: 'agent/failed-run',
        currentJob: 'Inspecting the failed run',
      },
      {
        id: 'harness-3',
        name: 'Triage reviewer',
        status: 'watching',
        taskId: 'triaged-task',
        branch: 'agent/triaged-run',
        currentJob: 'Inspecting the triaged run',
      },
    ]);

    expect(tickets[0]).toMatchObject({
      id: 'abcdef12-0000-0000-0000-000000000000',
      ref: 'FM-101',
      state: 'in-review',
      ownerHarnessId: 'harness-1',
      ownerHarnessName: 'API reviewer',
      ownerStatus: 'watching',
      branch: 'agent/foreman-api',
      prNumber: 42,
      childCount: 1,
      labels: [{ text: 'backend', tone: 'medium' }],
      assignmentNote: 'Review the API',
    });
    expect(tickets[1]).toMatchObject({ ref: 'CHILD-', state: 'backlog', childCount: 0 });
    expect(tickets[2]).toMatchObject({ ref: 'FM-FAIL', state: 'triaged' });
    expect(tickets[3]).toMatchObject({ ref: 'FM-TRIAGE', state: 'triaged' });
  });

  it('interleaves pulses, plans, findings, tools, human input, and live state', () => {
    const buildTranscript = (foremanModule as unknown as {
      buildTranscriptEntries?: (
        harness: { id: string; status: string; activity: string | null; currentJob: string | null },
        pulses: {
          id: string;
          seq: number;
          startedAt: Date;
          endedAt: Date | null;
          costUsd: number;
        }[],
        traces: {
          id: string;
          role: string;
          content: string | null;
          toolCalls: string | null;
          createdAt: Date;
        }[],
      ) => Record<string, unknown>[];
    }).buildTranscriptEntries;

    expect(buildTranscript).toBeTypeOf('function');
    if (!buildTranscript) return;

    const entries = buildTranscript(
      { id: 'h1', status: 'working', activity: 'Validating routes', currentJob: null },
      [{
        id: 'pulse-1',
        seq: 1,
        startedAt: new Date('2026-08-14T00:00:00.000Z'),
        endedAt: new Date('2026-08-14T00:01:00.000Z'),
        costUsd: 0.12,
      }],
      [
        {
          id: 'plan-1',
          role: 'assistant',
          content: 'Plan the route validation.',
          toolCalls: JSON.stringify([{ id: 'call-1', name: 'read_file', arguments: { path: 'apps/server/src/app.ts' } }]),
          createdAt: new Date('2026-08-14T00:00:10.000Z'),
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: 'Read 72 lines',
          toolCalls: null,
          createdAt: new Date('2026-08-14T00:00:12.000Z'),
        },
        {
          id: 'finding-1',
          role: 'assistant',
          content: 'Found the SSE heartbeat convention.',
          toolCalls: null,
          createdAt: new Date('2026-08-14T00:00:20.000Z'),
        },
        {
          id: 'human-1',
          role: 'user',
          content: 'Keep the migration additive.',
          toolCalls: null,
          createdAt: new Date('2026-08-14T00:00:30.000Z'),
        },
      ],
    );

    expect(entries.map((entry) => entry.kind)).toEqual([
      'pulse-divider',
      'plan',
      'tool',
      'finding',
      'human',
      'live',
    ]);
    expect(entries[2]).toMatchObject({
      tool: 'read_file',
      target: 'apps/server/src/app.ts',
      duration: '2s',
      status: 'ok',
      resultLabel: 'Read 72 lines',
      output: [{ ok: true, text: 'Read 72 lines' }],
    });
  });
});

describe('Foreman routes with PGlite', () => {
  const router = foremanRoutes(prisma);
  let objectiveId = '';
  let projectId = '';
  let leadHarnessId = '';
  let leadToolId = '';
  let playbookId = '';
  let workstreamId = '';

  beforeAll(async () => {
    await applyMigrations();
    await seedForemanDemo();
    await seedForemanDemo();

    const objective = await prisma.objective.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!objective) throw new Error('Foreman seed did not create an objective');
    objectiveId = objective.id;
    projectId = objective.projectId;

    const lead = await prisma.harness.findFirst({
      where: {
        objectiveId,
        parentId: null,
        taskId: { not: null },
        tools: { some: {} },
      },
      include: { tools: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!lead || lead.tools.length === 0) throw new Error('Foreman seed did not create a lead toolkit');
    leadHarnessId = lead.id;
    leadToolId = lead.tools[0].id;

    const playbook = await prisma.playbook.findFirst({ orderBy: [{ name: 'asc' }, { version: 'asc' }] });
    if (!playbook) throw new Error('Foreman seed did not create a playbook');
    playbookId = playbook.id;

    const workstream = await prisma.workstream.findFirst({ where: { objectiveId }, orderBy: { orderIdx: 'asc' } });
    if (!workstream) throw new Error('Foreman seed did not create a workstream');
    workstreamId = workstream.id;
  }, 60_000);

  it('seeds the complete topology idempotently', async () => {
    const [workstreams, harnesses, pulses, interventions, playbooks, tools] = await Promise.all([
      prisma.workstream.findMany({ where: { objectiveId } }),
      prisma.harness.findMany({ where: { objectiveId } }),
      prisma.pulse.count({ where: { harness: { objectiveId } } }),
      prisma.intervention.count({ where: { objectiveId } }),
      prisma.playbook.count(),
      prisma.harnessTool.count({ where: { harness: { objectiveId } } }),
    ]);
    const roots = harnesses.filter((harness) => harness.parentId === null);
    const rootIds = new Set(roots.map((harness) => harness.id));
    const depthTwo = harnesses.filter((harness) => harness.parentId !== null && rootIds.has(harness.parentId));
    const depthTwoIds = new Set(depthTwo.map((harness) => harness.id));
    const depthThree = harnesses.filter((harness) => harness.parentId !== null && depthTwoIds.has(harness.parentId));

    expect(workstreams).toHaveLength(3);
    expect(roots).toHaveLength(3);
    expect(depthTwo).toHaveLength(8);
    expect(depthThree).toHaveLength(2);
    expect(harnesses).toHaveLength(13);
    expect(pulses).toBe(156);
    expect(interventions).toBe(3);
    expect(playbooks).toBe(2);
    expect(tools).toBeGreaterThanOrEqual(3);
    expect(harnesses.every((harness) => harness.lastPulseSeq === 12)).toBe(true);
    expect(harnesses.every((harness) => harness.spendUsd > 0)).toBe(true);
  });

  it('returns objective summaries and a bounded dashboard state snapshot', async () => {
    const objectivesResult = await invokeRoute(router, 'get', '/objectives', {
      query: { projectId },
    });
    expect(objectivesResult.status).toBe(200);
    const objectives = objectivesResult.body as Record<string, unknown>[];
    const objective = objectives.find((entry) => entry.id === objectiveId);
    expect(objective).toMatchObject({
      id: objectiveId,
      ticketsTotal: expect.any(Number),
      ticketsDone: expect.any(Number),
      spendToday: expect.any(Number),
      spendTotal: expect.any(Number),
      progress: expect.any(Number),
      stats: {
        running: expect.any(Number),
        runningDelta: null,
        blocked: expect.any(Number),
        blockedNeedingYou: expect.any(Number),
        mergedToday: expect.any(Number),
        awaitingReview: expect.any(Number),
      },
    });
    expect(Number(objective?.progress)).toBeGreaterThanOrEqual(0);
    expect(Number(objective?.progress)).toBeLessThanOrEqual(1);

    const stateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: objectiveId },
    });
    expect(stateResult.status).toBe(200);
    const state = stateResult.body as {
      objective: { id: string; ticketsTotal: number; spendCap: number | null };
      workstreams: { status: string; agentCount: number; spend: number }[];
      harnesses: {
        id: string;
        parentId: string | null;
        childCount: number;
        recentPulses: { cost: number; durationMs: number | null }[];
        routine: { id: string }[];
        contextUsed: number;
        spend: number;
        subtreeSpend: number;
      }[];
      interventions: { status: string; harnessName: string; diff: unknown; budget: unknown }[];
      tickets: unknown[];
      activity: { verb: string; text: string }[];
    };
    expect(state.objective.id).toBe(objectiveId);
    expect(state.objective.ticketsTotal).toBeGreaterThan(0);
    expect(state.objective.spendCap).toEqual(expect.any(Number));
    expect(state.workstreams).toHaveLength(3);
    expect(state.workstreams.every((workstream) =>
      typeof workstream.status === 'string'
      && typeof workstream.agentCount === 'number'
      && typeof workstream.spend === 'number'
    )).toBe(true);
    expect(state.harnesses).toHaveLength(13);
    expect(state.harnesses.every((harness) => harness.recentPulses.length === 12)).toBe(true);
    expect(state.harnesses.every((harness) =>
      typeof harness.contextUsed === 'number'
      && typeof harness.spend === 'number'
      && typeof harness.subtreeSpend === 'number'
      && harness.recentPulses.every((pulse) => typeof pulse.cost === 'number')
    )).toBe(true);
    expect(state.harnesses.filter((harness) => harness.parentId === null).every((harness) => harness.childCount > 0)).toBe(true);
    const rootWithDescendants = state.harnesses.find((harness) =>
      harness.parentId === null && harness.childCount > 0
    );
    expect(rootWithDescendants).toBeDefined();
    expect(rootWithDescendants?.subtreeSpend).toBeGreaterThan(rootWithDescendants?.spend ?? 0);
    expect(state.harnesses.some((harness) => harness.routine.length > 0)).toBe(true);
    expect(state.interventions).toHaveLength(3);
    expect(state.interventions.every((intervention) => intervention.status === 'pending')).toBe(true);
    expect(state.interventions.every((intervention) => intervention.harnessName.length > 0)).toBe(true);
    expect(state.tickets.length).toBeGreaterThan(0);
    expect(state.activity.length).toBeGreaterThan(0);
    expect(state.activity.every((entry) => /^(merged|spawned|paused|failed|retired)$/.test(entry.verb))).toBe(true);
  });

  it('returns harness detail, pulses, toolkit, and an interleaved transcript', async () => {
    const detailResult = await invokeRoute(router, 'get', '/harnesses/:id', {
      params: { id: leadHarnessId },
    });
    expect(detailResult.status).toBe(200);
    expect(detailResult.body).toMatchObject({
      id: leadHarnessId,
      parent: null,
      children: expect.any(Array),
      pulses: expect.any(Array),
      tools: expect.any(Array),
      playbook: expect.anything(),
    });
    const detail = detailResult.body as {
      spend: number;
      subtreeSpend: number;
      playbook: { id: string; usedByCount: number } | null;
    };
    expect.soft(detail.subtreeSpend).toBeGreaterThan(detail.spend);
    const exactPlaybookUseCount = detail.playbook
      ? await prisma.harness.count({ where: { playbookId: detail.playbook.id } })
      : 0;
    expect.soft(detail.playbook?.usedByCount).toBe(exactPlaybookUseCount);
    expect.soft(detail.playbook?.usedByCount).toBeGreaterThan(0);

    const pulsesResult = await invokeRoute(router, 'get', '/harnesses/:id/pulses', {
      params: { id: leadHarnessId },
      query: { limit: '5' },
    });
    expect(pulsesResult.status).toBe(200);
    const pulses = pulsesResult.body as { seq: number }[];
    expect(pulses).toHaveLength(5);
    expect(pulses.map((pulse) => pulse.seq)).toEqual([12, 11, 10, 9, 8]);

    const toolsResult = await invokeRoute(router, 'get', '/harnesses/:id/tools', {
      params: { id: leadHarnessId },
    });
    expect(toolsResult.status).toBe(200);
    expect((toolsResult.body as Record<string, unknown>[]).length).toBeGreaterThan(0);
    expect((toolsResult.body as Record<string, unknown>[])[0]).toMatchObject({
      group: expect.any(String),
      lastResult: expect.anything(),
    });

    const transcriptResult = await invokeRoute(router, 'get', '/harnesses/:id/transcript', {
      params: { id: leadHarnessId },
    });
    expect(transcriptResult.status).toBe(200);
    const kinds = (transcriptResult.body as { kind: string }[]).map((entry) => entry.kind);
    expect(kinds).toContain('pulse-divider');
    expect(kinds).toContain('human');
    expect(kinds.some((kind) => kind === 'plan' || kind === 'finding')).toBe(true);

    const runResult = await invokeRoute(router, 'post', '/harnesses/:id/tools/:toolId/run', {
      params: { id: leadHarnessId, toolId: leadToolId },
    });
    expect(runResult.status).toBe(200);
    expect.soft(runResult.body).toMatchObject({
      id: leadToolId,
      lastStatus: 'recorded',
      lastResultLabel: expect.stringMatching(/not[- ]executed/i),
      lastRanAt: null,
      lastResult: { tone: expect.not.stringMatching(/^ok$/) },
    });

    const interjectResult = await invokeRoute(router, 'post', '/harnesses/:id/interject', {
      params: { id: leadHarnessId },
      body: { text: 'Please keep the response payload backward-compatible.' },
    });
    expect(interjectResult.status).toBe(201);
    expect(interjectResult.body).toMatchObject({
      kind: 'human',
      text: 'Please keep the response payload backward-compatible.',
    });
  });

  it('returns interventions, playbook usage counts, usage analytics, and ticket projections', async () => {
    const interventionsResult = await invokeRoute(router, 'get', '/interventions', {
      query: { objectiveId, status: 'pending' },
    });
    expect(interventionsResult.status).toBe(200);
    expect((interventionsResult.body as unknown[])).toHaveLength(3);

    const playbooksResult = await invokeRoute(router, 'get', '/playbooks');
    expect(playbooksResult.status).toBe(200);
    const playbooks = playbooksResult.body as { id: string; usedByCount: number; steps: unknown[]; variables: string[] }[];
    expect(playbooks).toHaveLength(2);
    expect(playbooks.every((playbook) => playbook.usedByCount > 0)).toBe(true);
    expect(playbooks.every((playbook) => Array.isArray(playbook.steps) && Array.isArray(playbook.variables))).toBe(true);

    const playbookResult = await invokeRoute(router, 'get', '/playbooks/:id', {
      params: { id: playbookId },
    });
    expect(playbookResult.status).toBe(200);
    expect(playbookResult.body).toMatchObject({ id: playbookId, usedByCount: expect.any(Number) });

    const usageResult = await invokeRoute(router, 'get', '/objectives/:id/usage', {
      params: { id: objectiveId },
      query: { days: '7' },
    });
    expect(usageResult.status).toBe(200);
    expect(usageResult.body).toMatchObject({
      spend: expect.any(Number),
      tokens: expect.any(Number),
      wasted: expect.any(Number),
      harnessCount: 13,
      days: expect.any(Array),
      models: expect.any(Array),
      topSpenders: expect.any(Array),
    });
    const usage = usageResult.body as {
      cacheHitRate: number | null;
      costPerMergedTicket: number | null;
      costPerTicketDelta: number | null;
      days: { projected: boolean }[];
      wasted: number;
      topSpenders: { share: number; outcomeTone: string }[];
    };
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const usageStart = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1_000);
    const usageEnd = new Date(today.getTime() + 24 * 60 * 60 * 1_000);
    const failedPulses = await prisma.pulse.findMany({
      where: {
        harness: { objectiveId },
        outcome: 'fail',
        startedAt: { gte: usageStart, lt: usageEnd },
      },
      select: { costUsd: true },
    });
    const failedPulseSpend = failedPulses.reduce((sum, pulse) => sum + pulse.costUsd, 0);
    expect(usage.days).toHaveLength(7);
    expect(usage.days.every((day) => typeof day.projected === 'boolean')).toBe(true);
    expect(usage.costPerMergedTicket === null || typeof usage.costPerMergedTicket === 'number').toBe(true);
    expect(usage.costPerTicketDelta === null || Math.abs(usage.costPerTicketDelta) < 10).toBe(true);
    expect(usage.topSpenders[0]?.share).toBe(1);
    expect(usage.topSpenders.every((spender) => /^(ok|fail|neutral)$/.test(spender.outcomeTone))).toBe(true);
    expect.soft(usage.wasted).toBeCloseTo(failedPulseSpend, 10);
    expect.soft(usage.cacheHitRate).toBeNull();
    expect.soft(usage.topSpenders.length).toBeLessThanOrEqual(10);

    const ticketsResult = await invokeRoute(router, 'get', '/objectives/:id/tickets', {
      params: { id: objectiveId },
    });
    expect(ticketsResult.status).toBe(200);
    const tickets = ticketsResult.body as Record<string, unknown>[];
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets[0]).toMatchObject({
      id: expect.any(String),
      ref: expect.any(String),
      title: expect.any(String),
      state: expect.stringMatching(/^(backlog|in-progress|in-review|done)$/),
      childCount: expect.any(Number),
      labels: expect.any(Array),
    });
  });

  it('counts each harness once when a subtree contains a parent cycle', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Cyclic subtree spend objective' },
    });
    const first = await createHarnessFixture(objective.id, {
      name: 'Cycle first',
      spendUsd: 1,
    });
    const second = await createHarnessFixture(objective.id, {
      name: 'Cycle second',
      parentId: first.id,
      spendUsd: 2,
    });
    await prisma.harness.update({
      where: { id: first.id },
      data: { parentId: second.id },
    });

    const stateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: objective.id },
    });
    expect(stateResult.status).toBe(200);
    const harnesses = (stateResult.body as {
      harnesses: { id: string; subtreeSpend: number }[];
    }).harnesses;
    const spendByHarness = new Map(harnesses.map((harness) => [harness.id, harness.subtreeSpend]));
    expect.soft(spendByHarness.get(first.id)).toBe(3);
    expect.soft(spendByHarness.get(second.id)).toBe(3);
  });

  it('uses every current-day pulse for exact objective spend aggregates, including the 13th', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Thirteen-pulse spend objective' },
    });
    const harness = await createHarnessFixture(objective.id, {
      name: 'Thirteen-pulse harness',
      spendUsd: 20,
      lastPulseSeq: 13,
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const previousDayPulseAt = new Date(today.getTime() - 60_000);
    await prisma.pulse.create({
      data: {
        harnessId: harness.id,
        seq: 0,
        startedAt: previousDayPulseAt,
        endedAt: new Date(previousDayPulseAt.getTime() + 30_000),
        outcome: 'ok',
        summary: 'Previous-day pulse excluded from spendToday',
        costUsd: 7,
        tokens: 100,
      },
    });

    for (let seq = 1; seq <= 12; seq += 1) {
      const startedAt = new Date(today.getTime() + seq * 60_000);
      await prisma.pulse.create({
        data: {
          harnessId: harness.id,
          seq,
          startedAt,
          endedAt: new Date(startedAt.getTime() + 30_000),
          outcome: 'ok',
          summary: `Current-day pulse ${String(seq)}`,
          costUsd: 1,
          tokens: 100,
        },
      });
    }
    const thirteenthStartedAt = new Date(today.getTime() + 13 * 60_000);
    await prisma.pulse.create({
      data: {
        harnessId: harness.id,
        seq: 13,
        startedAt: thirteenthStartedAt,
        endedAt: new Date(thirteenthStartedAt.getTime() + 30_000),
        outcome: 'ok',
        summary: 'Current-day pulse 13',
        costUsd: 1,
        tokens: 100,
      },
    });

    const listResult = await invokeRoute(router, 'get', '/objectives', {
      query: { projectId },
    });
    const listObjective = (listResult.body as {
      id: string;
      spendToday: number;
      spendTotal: number;
    }[]).find((entry) => entry.id === objective.id);
    const stateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: objective.id },
    });
    const state = stateResult.body as {
      objective: { spendToday: number; spendTotal: number };
      harnesses: { id: string; recentPulses: unknown[] }[];
    };

    expect(listResult.status).toBe(200);
    expect(stateResult.status).toBe(200);
    expect(listObjective).toBeDefined();
    expect(state.harnesses.find((entry) => entry.id === harness.id)?.recentPulses).toHaveLength(12);
    expect.soft(listObjective?.spendToday).toBe(13);
    expect.soft(state.objective.spendToday).toBe(13);
    expect.soft(state.objective.spendToday).toBe(listObjective?.spendToday);
    expect.soft(listObjective?.spendTotal).toBe(20);
    expect.soft(state.objective.spendTotal).toBe(20);
    expect.soft(state.objective.spendTotal).toBe(listObjective?.spendTotal);
  });

  it('keeps tickets scoped to their objective when sibling objectives share a project', async () => {
    const taggedObjective = await prisma.objective.create({
      data: { projectId, name: 'Tagged sibling objective' },
    });
    const emptyObjective = await prisma.objective.create({
      data: { projectId, name: 'Empty sibling objective' },
    });
    const siblingTask = await prisma.task.create({
      data: {
        projectId,
        title: 'Only belongs to the tagged sibling',
        status: 'done',
        tags: JSON.stringify([`objective:${taggedObjective.id}`, 'ticket:SCOPED-1']),
      },
    });
    await prisma.objectivePhase.create({
      data: {
        objectiveId: emptyObjective.id,
        name: 'Misleading completed phase',
        state: 'done',
        weight: 1,
        orderIdx: 0,
      },
    });

    const taggedTicketsResult = await invokeRoute(router, 'get', '/objectives/:id/tickets', {
      params: { id: taggedObjective.id },
    });
    const emptyTicketsResult = await invokeRoute(router, 'get', '/objectives/:id/tickets', {
      params: { id: emptyObjective.id },
    });
    const emptyStateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: emptyObjective.id },
    });
    const taggedStateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: taggedObjective.id },
    });
    const listResult = await invokeRoute(router, 'get', '/objectives', {
      query: { projectId },
    });
    const emptySummary = (listResult.body as {
      id: string;
      progress: number;
      ticketsTotal: number;
      ticketsDone: number;
    }[]).find((entry) => entry.id === emptyObjective.id);
    const taggedSummary = (listResult.body as {
      id: string;
      progress: number;
      ticketsTotal: number;
      ticketsDone: number;
    }[]).find((entry) => entry.id === taggedObjective.id);
    const emptyState = emptyStateResult.body as {
      objective: { progress: number; ticketsTotal: number; ticketsDone: number };
      tickets: unknown[];
    };
    const taggedState = taggedStateResult.body as {
      objective: { progress: number; ticketsTotal: number; ticketsDone: number };
      tickets: unknown[];
    };

    expect(taggedTicketsResult.status).toBe(200);
    expect(emptyTicketsResult.status).toBe(200);
    expect(emptyStateResult.status).toBe(200);
    expect(taggedStateResult.status).toBe(200);
    expect.soft((taggedTicketsResult.body as { id: string }[]).map((ticket) => ticket.id)).toEqual([siblingTask.id]);
    expect.soft(emptyTicketsResult.body).toEqual([]);
    expect.soft(emptyState.tickets).toEqual([]);
    expect.soft(taggedState.tickets).toHaveLength(1);
    expect.soft(taggedState.objective).toMatchObject({ progress: 1, ticketsTotal: 1, ticketsDone: 1 });
    expect.soft(taggedSummary).toMatchObject({ progress: 1, ticketsTotal: 1, ticketsDone: 1 });
    expect.soft(emptyState.objective).toMatchObject({ progress: 0, ticketsTotal: 0, ticketsDone: 0 });
    expect.soft(emptySummary).toMatchObject({ progress: 0, ticketsTotal: 0, ticketsDone: 0 });
  });

  it('keeps objective-list task grouping project-safe and ignores malformed tag entries', async () => {
    const otherProject = await prisma.project.create({
      data: { name: 'Cross-project tag regression', path: '/tmp/foreman-cross-project-regression' },
    });
    const otherObjective = await prisma.objective.create({
      data: { projectId: otherProject.id, name: 'Cross-project target objective' },
    });
    await prisma.task.createMany({
      data: [
        {
          projectId,
          title: 'Stale cross-project objective tag',
          status: 'done',
          tags: JSON.stringify([`objective:${otherObjective.id}`]),
        },
        {
          projectId: otherProject.id,
          title: 'Malformed tag array',
          status: 'done',
          tags: JSON.stringify([null, 42, { objective: otherObjective.id }]),
        },
      ],
    });

    const [listResult, stateResult] = await Promise.all([
      invokeRoute(router, 'get', '/objectives'),
      invokeRoute(router, 'get', '/objectives/:id/state', { params: { id: otherObjective.id } }),
    ]);
    const summary = (listResult.body as {
      id: string;
      progress: number;
      ticketsTotal: number;
      ticketsDone: number;
    }[]).find((entry) => entry.id === otherObjective.id);

    expect(listResult.status).toBe(200);
    expect(stateResult.status).toBe(200);
    expect(summary).toMatchObject({ progress: 0, ticketsTotal: 0, ticketsDone: 0 });
    expect(stateResult.body).toMatchObject({
      objective: { progress: 0, ticketsTotal: 0, ticketsDone: 0 },
      tickets: [],
    });
  });

  it('round-trips a use-case objective through create, list and state', async () => {
    const created = await invokeRoute(router, 'post', '/objectives', {
      body: {
        projectId,
        name: 'Demo the use-case shell',
        useCase: 'demo',
      },
    });
    expect(created.status).toBe(201);
    const objective = created.body as { id: string; useCase: string | null };
    expect(objective.useCase).toBe('demo');

    const listResult = await invokeRoute(router, 'get', '/objectives', { query: { projectId } });
    const listed = (listResult.body as { id: string; useCase: string | null }[])
      .find((entry) => entry.id === objective.id);
    expect(listed?.useCase).toBe('demo');

    // Objectives created before use cases existed must serialise a null, not
    // undefined — the client keys its registry lookup off this field.
    const seeded = (listResult.body as { id: string; useCase: string | null }[])
      .find((entry) => entry.id === objectiveId);
    expect(seeded?.useCase).toBeNull();

    const stateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: objective.id },
    });
    expect(stateResult.status).toBe(200);
    expect((stateResult.body as { objective: { useCase: string | null } }).objective.useCase)
      .toBe('demo');
  });

  it('rejects a useCase that is not a lowercase slug', async () => {
    // A label like "Victoria Trading" can never match a registry id, and would
    // otherwise persist and fail silently as "no extra tabs appeared".
    for (const useCase of ['Victoria Trading', 'victoria_trading', '-victoria', 'víctoria']) {
      const rejection: unknown = await invokeRoute(router, 'post', '/objectives', {
        body: { projectId, name: 'Invalid use case', useCase },
      }).then(() => null, (err: unknown) => err);

      const issues = (rejection as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      expect(issues?.map((issue) => issue.path.join('.'))).toEqual(['useCase']);
      expect(issues?.[0].message).toBe('useCase must be a lowercase slug, e.g. "victoria"');
    }

    expect(await prisma.objective.count({ where: { name: 'Invalid use case' } })).toBe(0);
  });

  it('creates objectives and enforces spawn capacity while preserving dry-run scheduling', async () => {
    const objectiveResult = await invokeRoute(router, 'post', '/objectives', {
      body: {
        projectId,
        name: 'Capacity test objective',
        description: 'Exercises parent limits.',
        spendCapUsd: 50,
      },
    });
    expect(objectiveResult.status).toBe(201);
    const createdObjective = objectiveResult.body as { id: string };

    const rootResult = await invokeRoute(router, 'post', '/harnesses', {
      body: {
        objectiveId: createdObjective.id,
        parentId: null,
        workstreamId: null,
        playbookId: null,
        taskId: null,
        name: 'Capacity root',
        mission: 'Coordinate one child.',
        model: 'test-model',
        heartbeatMinutes: 15,
        maxChildren: 1,
        permissions: [],
      },
    });
    expect(rootResult.status).toBe(201);
    const root = rootResult.body as { id: string; nextPulseAt: Date | null };
    expect(root.nextPulseAt).toBeInstanceOf(Date);

    const childBody = {
      objectiveId: createdObjective.id,
      parentId: root.id,
      name: 'Only child',
      mission: 'Execute the only child slot.',
      model: 'test-model',
      heartbeatMinutes: 15,
      maxChildren: 2,
      permissions: [],
    };
    const childResult = await invokeRoute(router, 'post', '/harnesses', { body: childBody });
    expect(childResult.status).toBe(201);
    const child = childResult.body as { id: string };

    const overCapacityResult = await invokeRoute(router, 'post', '/harnesses', {
      body: { ...childBody, name: 'Rejected sibling' },
    });
    expect(overCapacityResult.status).toBe(409);

    const dryRunResult = await invokeRoute(router, 'post', '/harnesses', {
      body: {
        objectiveId: createdObjective.id,
        name: 'Dry-run root',
        mission: 'Validate without scheduling.',
        model: 'test-model',
        heartbeatMinutes: 30,
        maxChildren: 1,
        permissions: [],
        dryRun: true,
      },
    });
    expect(dryRunResult.status).toBe(201);
    expect(dryRunResult.body).toMatchObject({ status: 'ready', dryRun: true, nextPulseAt: null });
    const dryRun = dryRunResult.body as { id: string };
    await invokeRoute(router, 'post', '/harnesses/:id/pause', {
      params: { id: dryRun.id },
      body: { subtree: false },
    });
    await invokeRoute(router, 'post', '/harnesses/:id/resume', {
      params: { id: dryRun.id },
      body: { subtree: false },
    });
    expect((await prisma.harness.findUniqueOrThrow({ where: { id: dryRun.id } })).nextPulseAt).toBeNull();

    const grandchildResult = await invokeRoute(router, 'post', '/harnesses', {
      body: { ...childBody, parentId: child.id, name: 'Grandchild' },
    });
    expect(grandchildResult.status).toBe(201);
    const grandchild = grandchildResult.body as { id: string };

    const patchResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: root.id },
      body: { mission: 'Coordinate the tested subtree.', heartbeatMinutes: 20 },
    });
    expect(patchResult.status).toBe(200);
    expect(patchResult.body).toMatchObject({ mission: 'Coordinate the tested subtree.', heartbeatMinutes: 20 });

    const pauseResult = await invokeRoute(router, 'post', '/harnesses/:id/pause', {
      params: { id: root.id },
      body: { subtree: true },
    });
    expect(pauseResult.status).toBe(200);
    const paused = await prisma.harness.findMany({ where: { id: { in: [root.id, child.id, grandchild.id] } } });
    expect(paused.every((harness) => harness.status === 'paused' && harness.nextPulseAt === null)).toBe(true);

    const resumeResult = await invokeRoute(router, 'post', '/harnesses/:id/resume', {
      params: { id: root.id },
      body: { subtree: true },
    });
    expect(resumeResult.status).toBe(200);
    const resumed = await prisma.harness.findMany({ where: { id: { in: [root.id, child.id, grandchild.id] } } });
    expect(resumed.every((harness) => harness.status === 'ready' && harness.nextPulseAt !== null)).toBe(true);

    const retireResult = await invokeRoute(router, 'post', '/harnesses/:id/retire', {
      params: { id: grandchild.id },
    });
    expect(retireResult.status).toBe(200);
    expect(retireResult.body).toMatchObject({ status: 'retired', retiredAt: expect.any(Date), nextPulseAt: null });
    const reviveResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: grandchild.id },
      body: { status: 'ready' },
    });
    expect(reviveResult.status).toBe(409);

    const raceResult = await invokeRoute(router, 'post', '/harnesses', {
      body: {
        objectiveId: createdObjective.id,
        name: 'Retirement race harness',
        mission: 'Remain terminal when retire and resume overlap.',
        model: 'test-model',
        heartbeatMinutes: 15,
        maxChildren: 0,
        permissions: [],
      },
    });
    const raceHarness = raceResult.body as { id: string };
    await Promise.all([
      invokeRoute(router, 'post', '/harnesses/:id/retire', { params: { id: raceHarness.id } }),
      invokeRoute(router, 'post', '/harnesses/:id/resume', {
        params: { id: raceHarness.id },
        body: { subtree: false },
      }),
    ]);
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: raceHarness.id } })).toMatchObject({
      status: 'retired',
      retiredAt: expect.any(Date),
      nextPulseAt: null,
    });
  });

  it('never schedules a ready child beneath a paused parent', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Paused parent spawn objective' },
    });
    const parent = await createHarnessFixture(objective.id, {
      name: 'Paused spawn parent',
      status: 'paused',
      maxChildren: 2,
    });

    const spawnResult = await invokeRoute(router, 'post', '/harnesses', {
      body: {
        objectiveId: objective.id,
        parentId: parent.id,
        name: 'Child of paused parent',
        mission: 'Remain paused until the parent resumes.',
        model: 'test-model',
        heartbeatMinutes: 15,
        maxChildren: 0,
        permissions: [],
      },
    });

    expect([201, 409]).toContain(spawnResult.status);
    if (spawnResult.status === 409) {
      expect(spawnResult.body).toMatchObject({ error: expect.stringMatching(/paused/i) });
      return;
    }

    const child = spawnResult.body as { id: string; status: string; nextPulseAt: Date | null };
    expect(child).toMatchObject({ status: 'paused', nextPulseAt: null });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({
      status: 'paused',
      nextPulseAt: null,
    });
  });

  it('restores exact pre-pause subtree statuses and only reschedules runnable harnesses', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Pause status preservation objective' },
    });
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1_000);
    const working = await createHarnessFixture(objective.id, {
      name: 'Working before pause',
      status: 'working',
      nextPulseAt: scheduledAt,
    });
    const failed = await createHarnessFixture(objective.id, {
      name: 'Failed before pause',
      parentId: working.id,
      status: 'failed',
    });
    const waiting = await createHarnessFixture(objective.id, {
      name: 'Waiting before pause',
      parentId: working.id,
      status: 'waiting',
    });
    const ids = [working.id, failed.id, waiting.id];

    const pauseResult = await invokeRoute(router, 'post', '/harnesses/:id/pause', {
      params: { id: working.id },
      body: { subtree: true },
    });
    const paused = await prisma.harness.findMany({ where: { id: { in: ids } } });
    expect(pauseResult.status).toBe(200);
    expect(paused.every((harness) => harness.status === 'paused' && harness.nextPulseAt === null)).toBe(true);

    const resumeResult = await invokeRoute(router, 'post', '/harnesses/:id/resume', {
      params: { id: working.id },
      body: { subtree: true },
    });
    const resumed = await prisma.harness.findMany({ where: { id: { in: ids } } });
    const resumedById = new Map(resumed.map((harness) => [harness.id, harness]));
    expect(resumeResult.status).toBe(200);
    expect.soft(resumedById.get(working.id)?.status).toBe('working');
    expect.soft(resumedById.get(working.id)?.nextPulseAt).toBeInstanceOf(Date);
    expect.soft(resumedById.get(failed.id)).toMatchObject({ status: 'failed', nextPulseAt: null });
    expect.soft(resumedById.get(waiting.id)).toMatchObject({ status: 'waiting', nextPulseAt: null });
  });

  it('cascades PATCH retirement through descendants while preserving retirement timestamps', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'PATCH retirement cascade objective' },
    });
    const root = await createHarnessFixture(objective.id, { name: 'PATCH retirement root' });
    const child = await createHarnessFixture(objective.id, {
      name: 'Already retired PATCH child',
      parentId: root.id,
      status: 'retired',
    });
    const preservedRetiredAt = new Date('2026-01-02T03:04:05.000Z');
    await prisma.harness.update({
      where: { id: child.id },
      data: { retiredAt: preservedRetiredAt },
    });
    const grandchild = await createHarnessFixture(objective.id, {
      name: 'Active PATCH grandchild',
      parentId: child.id,
      status: 'working',
      nextPulseAt: new Date(Date.now() + 60 * 60 * 1_000),
    });

    const patchResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: root.id },
      body: { status: 'retired' },
    });
    const retired = await prisma.harness.findMany({
      where: { id: { in: [root.id, child.id, grandchild.id] } },
    });
    const retiredById = new Map(retired.map((harness) => [harness.id, harness]));

    expect(patchResult.status).toBe(200);
    expect(patchResult.body).toMatchObject({ status: 'retired', retiredAt: expect.any(Date), nextPulseAt: null });
    expect.soft(retired.every((harness) =>
      harness.status === 'retired'
      && harness.retiredAt instanceof Date
      && harness.nextPulseAt === null
    )).toBe(true);
    expect.soft(retiredById.get(child.id)?.retiredAt?.getTime()).toBe(preservedRetiredAt.getTime());
  });

  it('retires a complete descendant subtree and excludes it from parent child counts', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Cascading retirement objective' },
    });
    const root = await createHarnessFixture(objective.id, { name: 'Retirement root' });
    const child = await createHarnessFixture(objective.id, {
      name: 'Retirement child',
      parentId: root.id,
      status: 'working',
      nextPulseAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    const grandchild = await createHarnessFixture(objective.id, {
      name: 'Retirement grandchild',
      parentId: child.id,
      status: 'waiting',
    });

    const retireResult = await invokeRoute(router, 'post', '/harnesses/:id/retire', {
      params: { id: child.id },
    });
    const descendants = await prisma.harness.findMany({
      where: { id: { in: [child.id, grandchild.id] } },
    });
    const stateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: objective.id },
    });
    const rootState = (stateResult.body as {
      harnesses: { id: string; childCount: number }[];
    }).harnesses.find((harness) => harness.id === root.id);
    const detailResult = await invokeRoute(router, 'get', '/harnesses/:id', {
      params: { id: root.id },
    });
    const rootDetail = detailResult.body as { childCount: number };

    expect(retireResult.status).toBe(200);
    expect.soft(descendants).toHaveLength(2);
    expect.soft(descendants.every((harness) =>
      harness.status === 'retired'
      && harness.retiredAt instanceof Date
      && harness.nextPulseAt === null
    )).toBe(true);
    expect.soft(rootState?.childCount).toBe(0);
    expect.soft(rootDetail.childCount).toBe(0);
  });

  it('keeps the original retirement timestamp when retirement is repeated', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Idempotent retirement objective' },
    });
    const harness = await createHarnessFixture(objective.id, { name: 'Repeated retirement harness' });

    const firstResult = await invokeRoute(router, 'post', '/harnesses/:id/retire', {
      params: { id: harness.id },
    });
    expect(firstResult.status).toBe(200);
    const firstRetiredAt = (firstResult.body as { retiredAt: Date }).retiredAt;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const repeatedResult = await invokeRoute(router, 'post', '/harnesses/:id/retire', {
      params: { id: harness.id },
    });
    const repeatedRetiredAt = (repeatedResult.body as { retiredAt: Date }).retiredAt;

    expect(repeatedResult.status).toBe(200);
    expect(repeatedRetiredAt.getTime()).toBe(firstRetiredAt.getTime());
    expect((await prisma.harness.findUniqueOrThrow({ where: { id: harness.id } })).retiredAt?.getTime())
      .toBe(firstRetiredAt.getTime());
  });

  it('cascades an intervention retirement action through the target descendants', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Intervention retirement cascade objective' },
    });
    const root = await createHarnessFixture(objective.id, { name: 'Intervention retirement root' });
    const child = await createHarnessFixture(objective.id, {
      name: 'Intervention retirement child',
      parentId: root.id,
      status: 'working',
      nextPulseAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    const grandchild = await createHarnessFixture(objective.id, {
      name: 'Intervention retirement grandchild',
      parentId: child.id,
      status: 'waiting',
    });
    const intervention = await prisma.intervention.create({
      data: {
        objectiveId: objective.id,
        harnessId: root.id,
        kind: 'approval',
        title: 'Retire the obsolete subtree',
      },
    });

    const resolveResult = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: intervention.id },
      body: { action: 'retire' },
    });
    const retired = await prisma.harness.findMany({
      where: { id: { in: [root.id, child.id, grandchild.id] } },
    });

    expect(resolveResult.status).toBe(200);
    expect(resolveResult.body).toMatchObject({ status: 'dismissed', resolvedAt: expect.any(Date) });
    expect(retired).toHaveLength(3);
    expect(retired.every((harness) =>
      harness.status === 'retired'
      && harness.retiredAt instanceof Date
      && harness.nextPulseAt === null
    )).toBe(true);
  });

  it('pauses every workstream member and restores status-aware scheduling on resume', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Workstream pause lifecycle objective' },
    });
    const workstream = await prisma.workstream.create({
      data: { objectiveId: objective.id, name: 'Lifecycle workstream' },
    });
    const working = await createHarnessFixture(objective.id, {
      name: 'Workstream working member',
      workstreamId: workstream.id,
      status: 'working',
      nextPulseAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    const failed = await createHarnessFixture(objective.id, {
      name: 'Workstream failed member',
      workstreamId: workstream.id,
      status: 'failed',
    });
    const waiting = await createHarnessFixture(objective.id, {
      name: 'Workstream waiting member',
      workstreamId: workstream.id,
      status: 'waiting',
    });
    const ids = [working.id, failed.id, waiting.id];

    const pauseResult = await invokeRoute(router, 'post', '/workstreams/:id/pause', {
      params: { id: workstream.id },
    });
    const pausedMembers = await prisma.harness.findMany({ where: { id: { in: ids } } });
    expect(pauseResult.status).toBe(200);
    expect(pauseResult.body).toMatchObject({ paused: true, pausedAt: expect.any(Date) });
    expect.soft(pausedMembers.every((harness) =>
      harness.status === 'paused' && harness.nextPulseAt === null
    )).toBe(true);

    const resumeRequestedAt = Date.now();
    const resumeResult = await invokeRoute(router, 'post', '/workstreams/:id/resume', {
      params: { id: workstream.id },
    });
    const resumedMembers = await prisma.harness.findMany({ where: { id: { in: ids } } });
    const resumedById = new Map(resumedMembers.map((harness) => [harness.id, harness]));
    expect(resumeResult.status).toBe(200);
    expect(resumeResult.body).toMatchObject({ paused: false, pausedAt: null });
    expect.soft(resumedById.get(working.id)?.status).toBe('working');
    expect.soft(resumedById.get(working.id)?.nextPulseAt?.getTime()).toBeGreaterThanOrEqual(resumeRequestedAt);
    expect.soft(resumedById.get(failed.id)).toMatchObject({ status: 'failed', nextPulseAt: null });
    expect.soft(resumedById.get(waiting.id)).toMatchObject({ status: 'waiting', nextPulseAt: null });
  });

  it('keeps individual pauses separate from workstream-owned pauses', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Workstream pause provenance objective' },
    });
    const workstream = await prisma.workstream.create({
      data: { objectiveId: objective.id, name: 'Pause provenance workstream' },
    });
    const individuallyPaused = await createHarnessFixture(objective.id, {
      name: 'Individually paused member',
      workstreamId: workstream.id,
      status: 'working',
    });
    const workstreamPaused = await createHarnessFixture(objective.id, {
      name: 'Workstream paused member',
      workstreamId: workstream.id,
      status: 'working',
    });

    await invokeRoute(router, 'post', '/harnesses/:id/pause', {
      params: { id: individuallyPaused.id },
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: individuallyPaused.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'working',
    });

    await invokeRoute(router, 'post', '/workstreams/:id/pause', {
      params: { id: workstream.id },
    });
    const pausedMembers = await prisma.harness.findMany({
      where: { id: { in: [individuallyPaused.id, workstreamPaused.id] } },
    });
    const pausedById = new Map(pausedMembers.map((harness) => [harness.id, harness]));
    expect.soft(pausedById.get(individuallyPaused.id)).toMatchObject({
      status: 'paused',
      statusBeforePause: 'working',
    });
    expect.soft(pausedById.get(workstreamPaused.id)).toMatchObject({
      status: 'paused',
      statusBeforePause: 'workstream:working',
    });

    const directResume = await invokeRoute(router, 'post', '/harnesses/:id/resume', {
      params: { id: workstreamPaused.id },
    });
    expect(directResume.status).toBe(200);
    expect(directResume.body).toMatchObject({ updated: 0 });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: workstreamPaused.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'workstream:working',
    });

    const directIndividualResume = await invokeRoute(router, 'post', '/harnesses/:id/resume', {
      params: { id: individuallyPaused.id },
    });
    expect(directIndividualResume.body).toMatchObject({ updated: 0 });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: individuallyPaused.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'working',
    });

    const patchResume = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: workstreamPaused.id },
      body: { status: 'ready' },
    });
    expect(patchResume.body).toMatchObject({ status: 'paused' });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: workstreamPaused.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'workstream:ready',
    });

    await invokeRoute(router, 'post', '/harnesses/:id/pause', {
      params: { id: workstreamPaused.id },
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: workstreamPaused.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'ready',
    });

    await invokeRoute(router, 'post', '/workstreams/:id/resume', {
      params: { id: workstream.id },
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: workstreamPaused.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'ready',
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: individuallyPaused.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'working',
    });

    await invokeRoute(router, 'post', '/harnesses/:id/resume', {
      params: { id: individuallyPaused.id },
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: individuallyPaused.id } })).toMatchObject({
      status: 'working',
      statusBeforePause: null,
    });
    await invokeRoute(router, 'post', '/harnesses/:id/resume', {
      params: { id: workstreamPaused.id },
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: workstreamPaused.id } })).toMatchObject({
      status: 'ready',
      statusBeforePause: null,
    });
  });

  it('re-enforces pause for stray active members of an already-paused workstream', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Repeated workstream pause objective' },
    });
    const originalPausedAt = new Date('2026-02-03T04:05:06.000Z');
    const workstream = await prisma.workstream.create({
      data: {
        objectiveId: objective.id,
        name: 'Already paused workstream',
        paused: true,
        pausedAt: originalPausedAt,
      },
    });
    const stray = await createHarnessFixture(objective.id, {
      name: 'Stray active member',
      workstreamId: workstream.id,
      status: 'watching',
      nextPulseAt: new Date(Date.now() + 60 * 60 * 1_000),
    });

    const pauseResult = await invokeRoute(router, 'post', '/workstreams/:id/pause', {
      params: { id: workstream.id },
    });
    const pausedStray = await prisma.harness.findUniqueOrThrow({ where: { id: stray.id } });

    expect(pauseResult.status).toBe(200);
    expect(pauseResult.body).toMatchObject({ paused: true, pausedAt: originalPausedAt });
    expect(pausedStray).toMatchObject({
      status: 'paused',
      statusBeforePause: 'workstream:watching',
      nextPulseAt: null,
    });

    await invokeRoute(router, 'post', '/workstreams/:id/resume', {
      params: { id: workstream.id },
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: stray.id } })).toMatchObject({
      status: 'watching',
      statusBeforePause: null,
    });
  });

  it('marks harnesses created or reassigned into a paused workstream as workstream-owned pauses', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Paused workstream assignment objective' },
    });
    const workstream = await prisma.workstream.create({
      data: { objectiveId: objective.id, name: 'Paused assignment workstream', paused: true, pausedAt: new Date() },
    });
    const createResult = await invokeRoute(router, 'post', '/harnesses', {
      body: {
        objectiveId: objective.id,
        workstreamId: workstream.id,
        name: 'Created paused member',
        mission: 'Remain paused with workstream provenance.',
        model: 'test-model',
        heartbeatMinutes: 15,
        maxChildren: 0,
        permissions: [],
      },
    });
    const created = createResult.body as { id: string };
    const reassigned = await createHarnessFixture(objective.id, {
      name: 'Reassigned paused member',
      status: 'failed',
    });
    const patchResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: reassigned.id },
      body: { workstreamId: workstream.id },
    });

    expect(createResult.status).toBe(201);
    expect(patchResult.status).toBe(200);
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'workstream:ready',
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: reassigned.id } })).toMatchObject({
      status: 'paused',
      statusBeforePause: 'workstream:failed',
    });

    const detachCreatedResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: created.id },
      body: { workstreamId: null },
    });
    const detachFailedResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: reassigned.id },
      body: { workstreamId: null },
    });
    expect(detachCreatedResult.body).toMatchObject({ status: 'ready', workstreamId: null });
    expect(detachFailedResult.body).toMatchObject({ status: 'failed', workstreamId: null });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      status: 'ready',
      statusBeforePause: null,
      nextPulseAt: expect.any(Date),
    });
    expect(await prisma.harness.findUniqueOrThrow({ where: { id: reassigned.id } })).toMatchObject({
      status: 'failed',
      statusBeforePause: null,
      nextPulseAt: null,
    });
  });

  it('normalizes a zero context window before serializing meaningful context usage', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Context window normalization objective' },
    });
    const harness = await createHarnessFixture(objective.id, {
      name: 'Zero-window harness',
      contextTokens: 50_000,
      contextWindow: 0,
    });

    const detailResult = await invokeRoute(router, 'get', '/harnesses/:id', {
      params: { id: harness.id },
    });
    const stateResult = await invokeRoute(router, 'get', '/objectives/:id/state', {
      params: { id: objective.id },
    });
    const detail = detailResult.body as { contextWindow: number; contextUsed: number };
    const stateHarness = (stateResult.body as {
      harnesses: { id: string; contextWindow: number; contextUsed: number }[];
    }).harnesses.find((entry) => entry.id === harness.id);

    expect(detailResult.status).toBe(200);
    expect(stateResult.status).toBe(200);
    for (const dto of [detail, stateHarness]) {
      expect.soft(dto?.contextWindow).toBeGreaterThan(0);
      expect.soft(dto?.contextUsed).toBeGreaterThan(0);
      expect.soft(dto?.contextUsed).toBeLessThanOrEqual(1);
    }
  });

  it('returns object-shaped intervention diffs only when they are fully renderable', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Intervention diff validation objective' },
    });
    const harness = await createHarnessFixture(objective.id, { name: 'Diff validation harness' });
    const completeDiff = {
      added: 2,
      removed: 1,
      filesChanged: 1,
      summary: 'One complete renderable diff',
      lines: [
        { kind: 'add', text: '+added line' },
        { kind: 'del', text: '-removed line' },
      ],
    };
    const complete = await prisma.intervention.create({
      data: {
        objectiveId: objective.id,
        harnessId: harness.id,
        kind: 'approval',
        title: 'Complete object diff',
        payload: JSON.stringify({ diff: completeDiff }),
      },
    });
    const partial = await prisma.intervention.create({
      data: {
        objectiveId: objective.id,
        harnessId: harness.id,
        kind: 'approval',
        title: 'Partial object diff',
        payload: JSON.stringify({ diff: { summary: 'Missing counts and lines' } }),
      },
    });

    const result = await invokeRoute(router, 'get', '/interventions', {
      query: { objectiveId: objective.id, status: 'pending' },
    });
    const interventions = result.body as { id: string; diff: unknown }[];
    const completeResult = interventions.find((entry) => entry.id === complete.id)?.diff;
    const partialResult = interventions.find((entry) => entry.id === partial.id)?.diff;
    const isRenderableDiff = (value: unknown): boolean => {
      if (value === null) return true;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const diff = value as Record<string, unknown>;
      return typeof diff.added === 'number'
        && typeof diff.removed === 'number'
        && typeof diff.filesChanged === 'number'
        && typeof diff.summary === 'string'
        && Array.isArray(diff.lines)
        && diff.lines.every((line) => {
          if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
          const row = line as Record<string, unknown>;
          return /^(add|del|meta)$/.test(String(row.kind)) && typeof row.text === 'string';
        });
    };

    expect(result.status).toBe(200);
    expect(completeResult).toEqual(completeDiff);
    expect(isRenderableDiff(partialResult)).toBe(true);
  });

  it('changes a harness name through PATCH or rejects the unsupported field with HTTP 400', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Harness rename objective' },
    });
    const harness = await createHarnessFixture(objective.id, { name: 'Original harness name' });

    let patchResult: RouteResult;
    try {
      patchResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
        params: { id: harness.id },
        body: { name: 'Renamed harness' },
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ZodError') throw error;
      // app.ts maps route validation failures to this HTTP status.
      patchResult = { status: 400, body: { error: 'Validation error' } };
    }
    const stored = await prisma.harness.findUniqueOrThrow({ where: { id: harness.id } });

    expect([200, 400]).toContain(patchResult.status);
    if (patchResult.status === 200) {
      expect(patchResult.body).toMatchObject({ name: 'Renamed harness' });
      expect(stored.name).toBe('Renamed harness');
    } else {
      expect(patchResult.body).toMatchObject({ error: expect.any(String) });
      expect(stored.name).toBe('Original harness name');
    }
  });

  it('hydrates create and patch DTOs with aggregates and stable routine IDs', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Mutation DTO hydration objective' },
    });
    const playbook = await prisma.playbook.findUniqueOrThrow({ where: { id: playbookId } });
    const expectedRoutineIds = (JSON.parse(playbook.steps) as { index: number }[])
      .map((step) => `${playbook.id}:${String(step.index)}`);
    const createResult = await invokeRoute(router, 'post', '/harnesses', {
      body: {
        objectiveId: objective.id,
        playbookId,
        name: 'Hydrated mutation root',
        mission: 'Return the same shape as the read endpoints.',
        model: 'test-model',
        heartbeatMinutes: 15,
        maxChildren: 2,
        permissions: [],
      },
    });
    expect(createResult.status).toBe(201);
    const created = createResult.body as { id: string; routine: { id: string }[] };

    await prisma.harness.update({ where: { id: created.id }, data: { spendUsd: 1 } });
    await createHarnessFixture(objective.id, {
      name: 'Hydrated mutation child',
      parentId: created.id,
      spendUsd: 2,
    });
    const pulseStartedAt = new Date();
    await prisma.pulse.create({
      data: {
        harnessId: created.id,
        seq: 1,
        startedAt: pulseStartedAt,
        endedAt: new Date(pulseStartedAt.getTime() + 1_000),
        outcome: 'ok',
        summary: 'DTO hydration pulse',
        costUsd: 1,
        tokens: 100,
      },
    });
    const patchResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: created.id },
      body: { mission: 'Return live aggregate fields after mutation.' },
    });
    const patched = patchResult.body as {
      childCount: number;
      subtreeSpend: number;
      recentPulses: { seq: number }[];
      routine: { id: string }[];
    };

    expect(patchResult.status).toBe(200);
    expect.soft(created.routine.map((step) => step.id)).toEqual(expectedRoutineIds);
    expect.soft(patched.routine.map((step) => step.id)).toEqual(expectedRoutineIds);
    expect.soft(patched.childCount).toBe(1);
    expect.soft(patched.subtreeSpend).toBe(3);
    expect.soft(patched.recentPulses.map((pulse) => pulse.seq)).toEqual([1]);
  });

  it('deduplicates malformed stored playbook indexes in mutation DTO routines', async () => {
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Malformed routine DTO objective' },
    });
    const playbook = await prisma.playbook.create({
      data: {
        projectId,
        name: 'Malformed duplicate-index playbook',
        steps: JSON.stringify([
          { index: 4, text: 'Keep this legacy step.', condition: null },
          { index: 4, text: 'Drop this duplicate legacy step.', condition: null },
          { index: 8, text: 'Keep the next unique step.', condition: null },
        ]),
      },
    });
    const harness = await createHarnessFixture(objective.id, {
      name: 'Malformed routine harness',
      playbookId: playbook.id,
    });

    const patchResult = await invokeRoute(router, 'patch', '/harnesses/:id', {
      params: { id: harness.id },
      body: { mission: 'Hydrate a safe routine.' },
    });
    const routine = (patchResult.body as { routine: { id: string; text: string }[] }).routine;

    expect(patchResult.status).toBe(200);
    expect(routine).toEqual([
      { id: `${playbook.id}:4`, index: 4, text: 'Keep this legacy step.', condition: null },
      { id: `${playbook.id}:8`, index: 8, text: 'Keep the next unique step.', condition: null },
    ]);
    expect(new Set(routine.map((step) => step.id)).size).toBe(routine.length);
  });

  it('resolves all pending intervention kinds with their side effects', async () => {
    const pending = await prisma.intervention.findMany({
      where: { objectiveId, status: 'pending' },
      orderBy: { kind: 'asc' },
    });
    const approval = pending.find((entry) => entry.kind === 'approval');
    const budget = pending.find((entry) => entry.kind === 'budget');
    const question = pending.find((entry) => entry.kind === 'question');
    if (!approval || !budget || !question) throw new Error('Seed interventions are incomplete');

    const approvalResult = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: approval.id },
      body: { action: 'approve-always', response: 'Approved for this harness.' },
    });
    expect(approvalResult.status).toBe(200);
    expect(approvalResult.body).toMatchObject({ status: 'approved', resolvedAt: expect.any(Date) });
    const approvedHarness = await prisma.harness.findUniqueOrThrow({ where: { id: approval.harnessId } });
    const permissions = JSON.parse(approvedHarness.permissions) as { granted?: boolean }[];
    expect(permissions.some((permission) => permission.granted === true)).toBe(true);

    const budgetResult = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: budget.id },
      body: { action: 'raise-cap', value: 125 },
    });
    expect(budgetResult.status).toBe(200);
    expect(budgetResult.body).toMatchObject({ status: 'approved', resolvedAt: expect.any(Date) });
    expect((await prisma.harness.findUniqueOrThrow({ where: { id: budget.harnessId } })).spendCapUsd).toBe(125);

    const answerResult = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: question.id },
      body: { action: 'answer', response: 'Use the additive migration path.' },
    });
    expect(answerResult.status).toBe(200);
    expect(answerResult.body).toMatchObject({
      status: 'answered',
      response: 'Use the additive migration path.',
      resolvedAt: expect.any(Date),
    });

    const repeatedResult = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: question.id },
      body: { action: 'answer', response: 'A second answer.' },
    });
    expect(repeatedResult.status).toBe(409);
  });

  it('creates immutable playbook versions and toggles workstreams', async () => {
    const original = await prisma.playbook.findUniqueOrThrow({ where: { id: playbookId } });
    const versionResult = await invokeRoute(router, 'post', '/playbooks/:id/version', {
      params: { id: playbookId },
      body: {
        steps: [{ index: 1, text: 'Inspect the objective state.', condition: null }],
        variables: ['objectiveId'],
        cadence: 'every 15m',
        retireWhen: 'All linked tickets are done',
      },
    });
    expect(versionResult.status).toBe(201);
    expect(versionResult.body).toMatchObject({
      name: original.name,
      version: original.version + 1,
      previousVersionId: original.id,
      steps: [{ index: 1, text: 'Inspect the objective state.', condition: null }],
      variables: ['objectiveId'],
    });
    const secondVersion = versionResult.body as { id: string; version: number };
    const staleSourceResult = await invokeRoute(router, 'post', '/playbooks/:id/version', {
      params: { id: playbookId },
      body: {
        steps: [{ index: 1, text: 'Inspect the next objective state.', condition: null }],
        variables: ['objectiveId'],
        cadence: 'every 10m',
        retireWhen: 'Every linked ticket is done',
      },
    });
    expect(staleSourceResult.status).toBe(201);
    expect(staleSourceResult.body).toMatchObject({
      version: secondVersion.version + 1,
      previousVersionId: secondVersion.id,
    });

    const pauseResult = await invokeRoute(router, 'post', '/workstreams/:id/pause', {
      params: { id: workstreamId },
    });
    expect(pauseResult.status).toBe(200);
    expect(pauseResult.body).toMatchObject({ paused: true, pausedAt: expect.any(Date) });

    const resumeResult = await invokeRoute(router, 'post', '/workstreams/:id/resume', {
      params: { id: workstreamId },
    });
    expect(resumeResult.status).toBe(200);
    expect(resumeResult.body).toMatchObject({ paused: false, pausedAt: null, pausedNote: null });
  });

  it('rejects playbook versions whose step indexes are duplicated', async () => {
    const source = await prisma.playbook.create({
      data: {
        projectId,
        name: 'Duplicate-index version source',
        steps: '[]',
      },
    });
    const error = await invokeRoute(router, 'post', '/playbooks/:id/version', {
      params: { id: source.id },
      body: {
        steps: [
          { index: 2, text: 'First use of index two.', condition: null },
          { index: 2, text: 'Second use of index two.', condition: null },
        ],
        variables: [],
        cadence: 'every 30m',
        retireWhen: null,
      },
    }).then(() => null, (caught: unknown) => caught);
    const versions = await prisma.playbook.count({ where: { name: source.name } });

    expect(error).toMatchObject({ name: 'ZodError' });
    expect(versions).toBe(1);
  });

  it('streams a full init snapshot before scoped change events and cleans up on close', async () => {
    const handler = findRouteHandler(router, 'get', '/stream');
    const request = new EventEmitter() as EventEmitter & {
      query: Record<string, string>;
      params: Record<string, string>;
      body: Record<string, never>;
      headers: Record<string, string>;
    };
    request.query = { objectiveId };
    request.params = {};
    request.body = {};
    request.headers = {};

    const chunks: string[] = [];
    let headers: Record<string, string> = {};
    let ended = false;
    let resolveHarnessEvent: (() => void) | undefined;
    const harnessEvent = new Promise<void>((resolve) => {
      resolveHarnessEvent = resolve;
    });
    const response = {
      writeHead(_status: number, nextHeaders: Record<string, string>) {
        headers = nextHeaders;
        return response;
      },
      flushHeaders() {
        return undefined;
      },
      write(chunk: string) {
        chunks.push(chunk);
        if (chunks.join('').includes('event: harness\n')) resolveHarnessEvent?.();
        return true;
      },
      end() {
        ended = true;
        return response;
      },
    };
    const next: NextFunction = (error?: unknown) => {
      if (error) throw error;
    };

    handler(request as unknown as Request, response as unknown as Response, next);
    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('event: init\n');
    }, { timeout: 10_000 });
    expect(headers).toMatchObject({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const initFrame = chunks.join('').split('\n\n').find((frame) => frame.startsWith('event: init\n'));
    const initData = initFrame?.split('\ndata: ')[1];
    const initialState = JSON.parse(initData ?? '{}') as {
      harnesses?: { id: string; subtreeSpend: number; childCount: number }[];
    };
    const initialLead = initialState.harnesses?.find((harness) => harness.id === leadHarnessId);
    expect(initialLead).toBeDefined();
    // A harness patch has to carry `recentPulses`: a client that is already
    // watching learns about a harness it has never seen on this path, and every
    // shell maps over that array. This pulse is the newest by seq, so it is
    // what the patch's list must lead with.
    const patchedPulse = await prisma.pulse.create({
      data: {
        harnessId: leadHarnessId,
        seq: 999,
        startedAt: new Date(),
        endedAt: new Date(),
        outcome: 'ok',
        summary: 'Pulse the harness patch must carry',
        costUsd: 0.02,
        tokens: 20,
      },
    });
    const childHarness = await prisma.harness.findFirstOrThrow({
      where: { parentId: leadHarnessId, status: { not: 'retired' }, retiredAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const spendIncrement = 7;
    await prisma.harness.update({
      where: { id: childHarness.id },
      data: {
        activity: 'Emitting a descendant stream update',
        spendUsd: { increment: spendIncrement },
      },
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      harnessEvent,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out waiting for harness SSE event')), 20_000);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    expect(chunks.join('')).toContain('Emitting a descendant stream update');
    const harnessPayloads = chunks.join('').split('\n\n').flatMap((frame) => {
      if (!frame.startsWith('event: harness\n')) return [];
      const data = frame.split('\ndata: ')[1];
      return data
        ? [JSON.parse(data) as {
            id: string;
            subtreeSpend: number;
            childCount: number;
            recentPulses?: { id: string; seq: number }[];
          }]
        : [];
    });
    const leadHarnessPayload = harnessPayloads.find((harness) => harness.id === leadHarnessId);
    expect(leadHarnessPayload).toMatchObject({
      id: leadHarnessId,
      childCount: initialLead?.childCount,
    });
    expect(leadHarnessPayload?.subtreeSpend).toBeCloseTo(
      (initialLead?.subtreeSpend ?? 0) + spendIncrement,
    );
    // Newest first, exactly as the init snapshot serialises it — a patch that
    // omitted this appended a harness whose pulse list was `undefined`.
    expect(leadHarnessPayload?.recentPulses?.[0]).toMatchObject({
      id: patchedPulse.id,
      seq: 999,
      summary: 'Pulse the harness patch must carry',
    });
    // Every harness in the pass carries the field, including the ones with no
    // pulses in the stream's window — an empty list, never a missing one.
    expect(harnessPayloads.every((harness) => Array.isArray(harness.recentPulses))).toBe(true);

    const streamedPulse = await prisma.pulse.create({
      data: {
        harnessId: leadHarnessId,
        seq: 13,
        startedAt: new Date(),
        endedAt: new Date(),
        outcome: 'ok',
        summary: 'Streamed pulse payload',
        costUsd: 0.01,
        tokens: 10,
      },
    });
    // Find the frame for *this* pulse rather than the last one written: several
    // pulses can land in one poll, and they go out newest-startedAt first.
    await vi.waitFor(() => {
      expect(chunks.join('')).toContain(`"pulse":{"id":"${streamedPulse.id}"`);
    }, { timeout: 20_000 });
    const pulseFrame = chunks
      .join('')
      .split('\n\n')
      .find((frame) => frame.startsWith('event: pulse\n') && frame.includes(streamedPulse.id)) ?? '';
    expect(pulseFrame).toContain(`"harnessId":"${leadHarnessId}"`);
    expect(pulseFrame).toContain(`"pulse":{"id":"${streamedPulse.id}"`);

    request.emit('close');
    expect(ended).toBe(true);
  }, 45_000);
});

describe('Foreman tool execution', () => {
  const router = foremanRoutes(prisma);
  let projectId = '';
  let projectPath = '';
  let objectiveId = '';
  let harnessId = '';

  const makeTool = async (options: {
    name: string;
    command?: string | null;
    permissionId?: string | null;
    timeoutMs?: number | null;
    needsApproval?: boolean;
  }) =>
    prisma.harnessTool.create({
      data: {
        harnessId,
        name: options.name,
        groupName: 'Execution',
        needsApproval: options.needsApproval ?? false,
        command: options.command ?? null,
        permissionId: options.permissionId ?? null,
        timeoutMs: options.timeoutMs ?? null,
      },
    });

  const run = (toolId: string, headers?: Record<string, string>) =>
    invokeRoute(router, 'post', '/harnesses/:id/tools/:toolId/run', {
      params: { id: harnessId, toolId },
      headers,
    });

  const grant = (permissionId: string, needsApproval = false) =>
    prisma.harness.update({
      where: { id: harnessId },
      data: {
        permissions: JSON.stringify([
          { id: permissionId, label: 'Run the tool', granted: true, needsApproval },
        ]),
      },
    });

  beforeAll(async () => {
    await applyMigrations();
    projectPath = await mkdtemp(join(tmpdir(), 'omega-tool-exec-'));
    const project = await prisma.project.create({
      data: { name: 'Tool execution project', path: projectPath },
    });
    projectId = project.id;
    const objective = await prisma.objective.create({
      data: { projectId, name: 'Tool execution objective' },
    });
    objectiveId = objective.id;
    const harness = await createHarnessFixture(objectiveId, { name: 'Tool executor' });
    harnessId = harness.id;
  }, 60_000);

  afterEach(async () => {
    delete process.env.FOREMAN_TOOLS;
    delete process.env.FOREMAN_TOOLS_SECRET;
    delete process.env.OMEGA_TOOL_SECRET;
    await prisma.harness.update({ where: { id: harnessId }, data: { permissions: '[]' } });
    await prisma.intervention.deleteMany({ where: { harnessId } });
  });

  it('records without executing when the flag is off, even with a command configured', async () => {
    const marker = join(projectPath, 'flag-off-marker');
    const tool = await makeTool({ name: 'Flag off', command: `touch ${marker}` });
    await grant(`tool:${tool.id}`);

    const result = await run(tool.id);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: tool.id,
      lastStatus: 'recorded',
      lastResultLabel: 'Not executed: execution is not configured; request recorded only',
      lastRanAt: null,
      lastResult: {
        label: 'Not executed: execution is not configured; request recorded only',
        tone: 'idle',
      },
    });
    expect(existsSync(marker)).toBe(false);
    const runs = await prisma.harnessToolRun.findMany({ where: { toolId: tool.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('recorded');
    expect(runs[0].exitCode).toBe(null);
  });

  it('keeps a tool with no command on the record-only path when the flag is on', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'No command' });

    const result = await run(tool.id);

    expect((result.body as { lastStatus: string }).lastStatus).toBe('recorded');
    expect((result.body as { lastResultLabel: string }).lastResultLabel).toBe(
      'Not executed: execution is not configured; request recorded only',
    );
  });

  it('blocks an unpermitted tool and raises one approval intervention', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const marker = join(projectPath, 'blocked-marker');
    const tool = await makeTool({ name: 'Unpermitted', command: `touch ${marker}` });

    const first = await run(tool.id);
    const second = await run(tool.id);

    expect((first.body as { lastStatus: string }).lastStatus).toBe('blocked');
    expect((first.body as { lastResult: { tone: string } }).lastResult.tone).toBe('warn');
    expect(existsSync(marker)).toBe(false);
    expect((second.body as { lastStatus: string }).lastStatus).toBe('blocked');

    const interventions = await prisma.intervention.findMany({ where: { harnessId } });
    expect(interventions).toHaveLength(1);
    expect(interventions[0].kind).toBe('approval');
    expect(interventions[0].status).toBe('pending');
    expect(interventions[0].title).toBe('Tool executor wants to run "Unpermitted"');
    expect(JSON.parse(interventions[0].payload ?? '{}')).toMatchObject({
      toolId: tool.id,
      permissionId: `tool:${tool.id}`,
    });

    // The ask is materialised on the harness un-granted, so "always allow" has
    // an id to flip — and so it grants nothing on its own.
    const harness = await prisma.harness.findUniqueOrThrow({ where: { id: harnessId } });
    expect(JSON.parse(harness.permissions)).toEqual([
      { id: `tool:${tool.id}`, label: 'Run tool "Unpermitted"', granted: false, needsApproval: false },
    ]);

    const runs = await prisma.harnessToolRun.findMany({ where: { toolId: tool.id } });
    expect(runs).toHaveLength(2);
    expect(runs.every((entry) => entry.status === 'blocked-pending-approval')).toBe(true);
    expect(runs[0].interventionId).toBe(interventions[0].id);
    expect(runs[0].permissionId).toBe(`tool:${tool.id}`);
  });

  it('executes once after "approve", and blocks again on the next run', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Approve once', command: 'echo approved-once' });
    await run(tool.id);
    const intervention = await prisma.intervention.findFirstOrThrow({ where: { harnessId } });

    const resolved = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: intervention.id },
      body: { action: 'approve' },
    });
    expect(resolved.status).toBe(200);
    expect(
      (await prisma.harnessTool.findUniqueOrThrow({ where: { id: tool.id } })).approvedInterventionId,
    ).toBe(intervention.id);

    const executed = await run(tool.id);
    expect((executed.body as { lastStatus: string }).lastStatus).toBe('ok');
    expect((executed.body as { lastRun: { output: string; interventionId: string; permissionId: null } }).lastRun)
      .toMatchObject({
        output: 'approved-once',
        exitCode: 0,
        interventionId: intervention.id,
        permissionId: null,
        cwd: projectPath,
      });

    // The one-shot grant is consumed, so the tool is locked again.
    expect(
      (await prisma.harnessTool.findUniqueOrThrow({ where: { id: tool.id } })).approvedInterventionId,
    ).toBe(null);
    const blockedAgain = await run(tool.id);
    expect((blockedAgain.body as { lastStatus: string }).lastStatus).toBe('blocked');
  });

  it('executes every run after "approve-always" grants the permission', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Approve always', command: 'echo standing' });
    await run(tool.id);
    const intervention = await prisma.intervention.findFirstOrThrow({ where: { harnessId } });

    const resolved = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: intervention.id },
      body: { action: 'approve-always' },
    });
    expect(resolved.status).toBe(200);

    for (const attempt of [1, 2]) {
      const executed = await run(tool.id);
      expect.soft((executed.body as { lastStatus: string }).lastStatus, `attempt ${String(attempt)}`).toBe('ok');
      expect((executed.body as { lastRun: { permissionId: string } }).lastRun.permissionId)
        .toBe(`tool:${tool.id}`);
    }
  });

  it('executes a permitted command in the project checkout and records the exit code', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Permitted', command: 'node -e "process.stdout.write(process.cwd())"' });
    await grant(`tool:${tool.id}`);

    const result = await run(tool.id);

    const body = result.body as {
      lastStatus: string;
      lastRanAt: string | null;
      lastRun: { output: string; exitCode: number; cwd: string; permissionId: string; status: string };
    };
    expect(body.lastStatus).toBe('ok');
    expect(body.lastRanAt).not.toBe(null);
    expect(body.lastRun.status).toBe('ok');
    expect(body.lastRun.exitCode).toBe(0);
    expect(body.lastRun.permissionId).toBe(`tool:${tool.id}`);
    expect(body.lastRun.cwd).toBe(projectPath);
    // realpath: macOS resolves /var → /private/var, so compare the tail.
    expect(body.lastRun.output.endsWith(projectPath.replace(/^\/private/, ''))).toBe(true);
  });

  it('records a non-zero exit as a failure with its output', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({
      name: 'Nonzero',
      command: 'node -e "process.stderr.write(\'boom\'); process.exit(3)"',
      permissionId: 'repo',
    });
    await grant('repo');

    const result = await run(tool.id);

    const body = result.body as {
      lastStatus: string;
      lastResultLabel: string;
      lastResult: { tone: string };
      lastRun: { exitCode: number; output: string; status: string };
    };
    expect(body.lastStatus).toBe('fail');
    expect(body.lastResult.tone).toBe('fail');
    expect(body.lastResultLabel).toContain('exit 3');
    expect(body.lastRun.status).toBe('fail');
    expect(body.lastRun.exitCode).toBe(3);
    expect(body.lastRun.output).toBe('boom');
  });

  it('kills a command that overruns its timeout', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const marker = join(projectPath, 'timeout-marker');
    const tool = await makeTool({
      name: 'Slow',
      command: `sleep 5 && touch ${marker}`,
      timeoutMs: 300,
    });
    await grant(`tool:${tool.id}`);

    const result = await run(tool.id);

    const body = result.body as {
      lastStatus: string;
      lastResultLabel: string;
      lastRun: { status: string; durationMs: number };
    };
    expect(body.lastStatus).toBe('fail');
    expect(body.lastRun.status).toBe('timeout');
    expect(body.lastResultLabel).toContain('timed out');
    expect(body.lastRun.durationMs).toBeLessThan(5_000);
    // The whole process group died: the second half of the command never ran.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it('refuses to execute when the objective has no project checkout on disk', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const goneProject = await prisma.project.create({
      data: { name: 'Deleted checkout', path: join(tmpdir(), 'omega-tool-exec-does-not-exist') },
    });
    const goneObjective = await prisma.objective.create({
      data: { projectId: goneProject.id, name: 'Deleted checkout objective' },
    });
    const orphan = await createHarnessFixture(goneObjective.id, { name: 'Checkout-less' });
    const tool = await prisma.harnessTool.create({
      data: {
        harnessId: orphan.id,
        name: 'No checkout',
        groupName: 'Execution',
        command: 'echo never',
      },
    });
    await prisma.harness.update({
      where: { id: orphan.id },
      data: {
        permissions: JSON.stringify([
          { id: `tool:${tool.id}`, label: 'Run the tool', granted: true, needsApproval: false },
        ]),
      },
    });

    const result = await invokeRoute(router, 'post', '/harnesses/:id/tools/:toolId/run', {
      params: { id: orphan.id, toolId: tool.id },
    });

    expect(result.body).toMatchObject({
      lastStatus: 'recorded',
      lastResultLabel: 'Not executed: the objective has no project checkout on disk; request recorded only',
      lastRanAt: null,
    });
    expect(await prisma.intervention.count({ where: { harnessId: orphan.id } })).toBe(0);
  });

  it('runs the command with a scrubbed environment', async () => {
    process.env.FOREMAN_TOOLS = '1';
    process.env.OMEGA_TOOL_SECRET = 'do-not-leak';
    const tool = await makeTool({
      name: 'Env probe',
      command: 'node -e "process.stdout.write(String(process.env.OMEGA_TOOL_SECRET) + \'|\' + String(process.env.DATABASE_URL))"',
    });
    await grant(`tool:${tool.id}`);

    const result = await run(tool.id);

    expect((result.body as { lastRun: { output: string } }).lastRun.output).toBe('undefined|undefined');
  });

  it('always asks again for a tool flagged needsApproval, even with the permission granted', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Force push', command: 'echo dangerous', needsApproval: true });
    await grant(`tool:${tool.id}`);

    const result = await run(tool.id);

    expect((result.body as { lastStatus: string }).lastStatus).toBe('blocked');
    expect(await prisma.intervention.count({ where: { harnessId, kind: 'approval' } })).toBe(1);
  });

  it('rejects an approval whose tool belongs to another harness', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const other = await createHarnessFixture(objectiveId, { name: 'Other harness' });
    const foreignTool = await prisma.harnessTool.create({
      data: { harnessId: other.id, name: 'Foreign', groupName: 'Execution', command: 'echo nope' },
    });
    const intervention = await prisma.intervention.create({
      data: {
        objectiveId,
        harnessId,
        kind: 'approval',
        title: 'Forged approval',
        payload: JSON.stringify({ toolId: foreignTool.id, permissionId: `tool:${foreignTool.id}` }),
        status: 'pending',
      },
    });

    const result = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: intervention.id },
      body: { action: 'approve' },
    });

    expect(result.status).toBe(400);
    expect(
      (await prisma.harnessTool.findUniqueOrThrow({ where: { id: foreignTool.id } })).approvedInterventionId,
    ).toBe(null);
  });

  // ------------------------------------------------------------- the secret --

  it('rejects a run with no tools secret when one is configured, writing nothing', async () => {
    process.env.FOREMAN_TOOLS = '1';
    process.env.FOREMAN_TOOLS_SECRET = 'correct-horse-battery-staple';
    const marker = join(projectPath, 'no-secret-marker');
    const tool = await makeTool({ name: 'Secret gated', command: `touch ${marker}` });
    await grant(`tool:${tool.id}`);

    const missing = await run(tool.id);
    const wrong = await run(tool.id, { 'x-foreman-tools-secret': 'correct-horse-battery-stapl' });

    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ error: 'Tool execution requires a valid tools secret' });
    expect(wrong.status).toBe(401);
    expect(existsSync(marker)).toBe(false);
    // No side effects at all: no audit row, no permission entry, no ask.
    expect(await prisma.harnessToolRun.count({ where: { toolId: tool.id } })).toBe(0);
    expect(await prisma.intervention.count({ where: { harnessId } })).toBe(0);
    expect(
      (await prisma.harnessTool.findUniqueOrThrow({ where: { id: tool.id } })).lastStatus,
    ).toBe(null);
  });

  it('runs when the tools secret matches', async () => {
    process.env.FOREMAN_TOOLS = '1';
    process.env.FOREMAN_TOOLS_SECRET = 'correct-horse-battery-staple';
    const tool = await makeTool({ name: 'Secret ok', command: 'echo authorised' });
    await grant(`tool:${tool.id}`);

    const result = await run(tool.id, {
      'x-foreman-tools-secret': 'correct-horse-battery-staple',
    });

    expect(result.status).toBe(200);
    expect((result.body as { lastStatus: string }).lastStatus).toBe('ok');
    expect((result.body as { lastRun: { output: string } }).lastRun.output).toBe('authorised');
  });

  it('refuses to resolve an approval without the tools secret, and resolves with it', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Gated approval', command: 'echo gated' });
    await run(tool.id);
    const intervention = await prisma.intervention.findFirstOrThrow({ where: { harnessId } });

    process.env.FOREMAN_TOOLS_SECRET = 'shibboleth';
    const denied = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: intervention.id },
      body: { action: 'approve-always' },
    });
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ error: 'Resolving an approval requires a valid tools secret' });
    // Nothing resolved, nothing granted.
    expect(
      (await prisma.intervention.findUniqueOrThrow({ where: { id: intervention.id } })).status,
    ).toBe('pending');
    expect(
      parsePermissions(
        (await prisma.harness.findUniqueOrThrow({ where: { id: harnessId } })).permissions,
      ).every((entry) => !entry.granted),
    ).toBe(true);

    const allowed = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: intervention.id },
      body: { action: 'approve-always' },
      headers: { 'x-foreman-tools-secret': 'shibboleth' },
    });
    expect(allowed.status).toBe(200);
    expect(
      parsePermissions(
        (await prisma.harness.findUniqueOrThrow({ where: { id: harnessId } })).permissions,
      ).find((entry) => entry.id === `tool:${tool.id}`)?.granted,
    ).toBe(true);
  });

  it('leaves non-approval interventions unauthenticated when the secret is set', async () => {
    process.env.FOREMAN_TOOLS = '1';
    process.env.FOREMAN_TOOLS_SECRET = 'shibboleth';
    const question = await prisma.intervention.create({
      data: {
        objectiveId,
        harnessId,
        kind: 'question',
        title: 'Which branch?',
        status: 'pending',
      },
    });

    const result = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: question.id },
      body: { action: 'answer', response: 'main' },
    });

    expect(result.status).toBe(200);
    expect(
      (await prisma.intervention.findUniqueOrThrow({ where: { id: question.id } })).status,
    ).toBe('answered');
  });

  // -------------------------------------------------- the secret on READS --

  /**
   * Run a tool for real, then read it back both ways. The fixture is one
   * executed tool whose command and output are both known strings, so a
   * redaction is unmistakable rather than "some field changed".
   */
  const executedTool = async (name: string) => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name, command: 'echo readable-output' });
    await grant(`tool:${tool.id}`);
    const secret = process.env.FOREMAN_TOOLS_SECRET;
    const ran = await run(tool.id, secret ? { 'x-foreman-tools-secret': secret } : undefined);
    expect(ran.status).toBe(200);
    return tool;
  };

  const readTools = async (headers?: Record<string, string>) => {
    const result = await invokeRoute(router, 'get', '/harnesses/:id/tools', {
      params: { id: harnessId },
      headers,
    });
    expect(result.status).toBe(200);
    return result.body as Record<string, unknown>[];
  };

  const findTool = (tools: Record<string, unknown>[], id: string) => {
    const found = tools.find((tool) => tool.id === id);
    if (!found) throw new Error(`Tool ${id} missing from the read`);
    return found as {
      id: string;
      name: string;
      command: string | null;
      executable: boolean;
      lastStatus: string | null;
      lastResult: { label: string; tone: string } | null;
      lastRun: { status: string; exitCode: number | null; output: string | null } | null;
    };
  };

  it('serves the command and the run output in full when the read carries the secret', async () => {
    process.env.FOREMAN_TOOLS_SECRET = 'read-me-if-you-can';
    const tool = await executedTool('Readable with secret');

    const read = findTool(await readTools({ 'x-foreman-tools-secret': 'read-me-if-you-can' }), tool.id);

    expect(read.command).toBe('echo readable-output');
    expect(read.lastRun?.output).toBe('readable-output');
    expect(read.lastRun?.status).toBe('ok');
    expect(read.lastStatus).toBe('ok');
  });

  it('redacts the command and the run output when the read has no secret, keeping the list', async () => {
    process.env.FOREMAN_TOOLS_SECRET = 'read-me-if-you-can';
    const tool = await executedTool('Redacted without secret');

    const tools = await readTools();
    const read = findTool(tools, tool.id);

    // The payload is gone…
    expect(read.command).toBe('«secret required»');
    expect(read.lastRun?.output).toBe('«secret required»');
    // …and everything that is workflow rather than payload survives, so the
    // Toolkit degrades visibly instead of emptying out.
    expect(tools.length).toBeGreaterThan(0);
    expect(read.name).toBe('Redacted without secret');
    expect(read.executable).toBe(true);
    expect(read.lastStatus).toBe('ok');
    expect(read.lastResult?.tone).toBe('ok');
    expect(read.lastRun?.status).toBe('ok');
    expect(read.lastRun?.exitCode).toBe(0);
  });

  it('redacts on a wrong secret exactly as on a missing one', async () => {
    process.env.FOREMAN_TOOLS_SECRET = 'read-me-if-you-can';
    const tool = await executedTool('Redacted on wrong secret');

    const read = findTool(
      await readTools({ 'x-foreman-tools-secret': 'read-me-if-you-cam' }),
      tool.id,
    );

    expect(read.command).toBe('«secret required»');
    expect(read.lastRun?.output).toBe('«secret required»');
  });

  it('redacts the toolkit carried by the harness detail read as well', async () => {
    process.env.FOREMAN_TOOLS_SECRET = 'read-me-if-you-can';
    const tool = await executedTool('Redacted on harness detail');

    const detail = async (headers?: Record<string, string>) => {
      const result = await invokeRoute(router, 'get', '/harnesses/:id', {
        params: { id: harnessId },
        headers,
      });
      expect(result.status).toBe(200);
      return findTool((result.body as { tools: Record<string, unknown>[] }).tools, tool.id);
    };

    const hidden = await detail();
    expect(hidden.command).toBe('«secret required»');
    expect(hidden.lastRun?.output).toBe('«secret required»');
    expect(hidden.name).toBe('Redacted on harness detail');

    const shown = await detail({ 'x-foreman-tools-secret': 'read-me-if-you-can' });
    expect(shown.command).toBe('echo readable-output');
    expect(shown.lastRun?.output).toBe('readable-output');
  });

  it('leaves the tools read wide open when no secret is configured', async () => {
    const tool = await executedTool('Open without a secret');

    const read = findTool(await readTools(), tool.id);

    expect(process.env.FOREMAN_TOOLS_SECRET).toBeUndefined();
    expect(read.command).toBe('echo readable-output');
    expect(read.lastRun?.output).toBe('readable-output');
  });

  // --------------------------------------- the command on APPROVAL reads --

  /**
   * A blocked run raises the approval intervention, which publishes the command
   * twice — in `payload.command` and in the first line of `detail`. Three
   * unauthenticated reads carry that intervention, so redacting `command` on the
   * tools list alone would leave the same string a route away.
   */
  const blockedApproval = async (command: string) => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Wants approval', command });
    const secret = process.env.FOREMAN_TOOLS_SECRET;
    const blocked = await run(tool.id, secret ? { 'x-foreman-tools-secret': secret } : undefined);
    expect((blocked.body as { lastStatus: string }).lastStatus).toBe('blocked');
    return prisma.intervention.findFirstOrThrow({ where: { harnessId, kind: 'approval' } });
  };

  interface ReadIntervention {
    id: string;
    title: string;
    detail: string | null;
    impact: string | null;
    status: string;
    payload: { command?: unknown; toolId?: unknown } | null;
  }

  const SECRET_COMMAND = 'echo hunter2-in-the-command';

  it('redacts the command an approval intervention carries on the queue read', async () => {
    process.env.FOREMAN_TOOLS_SECRET = 'read-me-if-you-can';
    const intervention = await blockedApproval(SECRET_COMMAND);

    const list = async (headers?: Record<string, string>) => {
      const result = await invokeRoute(router, 'get', '/interventions', {
        query: { objectiveId, status: 'pending' },
        headers,
      });
      expect(result.status).toBe(200);
      const rows = result.body as ReadIntervention[];
      const found = rows.find((row) => row.id === intervention.id);
      if (!found) throw new Error('Approval missing from the queue read');
      return found;
    };

    const hidden = await list();
    expect(hidden.payload?.command).toBe('«secret required»');
    expect(hidden.detail).toContain('Command: «secret required»');
    expect(hidden.detail).not.toContain('hunter2');
    // The ask is still answerable: who wants what, and the buttons' copy.
    expect(hidden.title).toContain('wants to run "Wants approval"');
    expect(hidden.status).toBe('pending');
    expect(hidden.impact).toBe('Execution');
    expect(hidden.detail).toContain('Working directory');
    expect(typeof hidden.payload?.toolId).toBe('string');

    const shown = await list({ 'x-foreman-tools-secret': 'read-me-if-you-can' });
    expect(shown.payload?.command).toBe(SECRET_COMMAND);
    expect(shown.detail).toContain(`Command: ${SECRET_COMMAND}`);
  });

  it('redacts that command on the objective state read too', async () => {
    process.env.FOREMAN_TOOLS_SECRET = 'read-me-if-you-can';
    const intervention = await blockedApproval(SECRET_COMMAND);

    const state = async (headers?: Record<string, string>) => {
      const result = await invokeRoute(router, 'get', '/objectives/:id/state', {
        params: { id: objectiveId },
        headers,
      });
      expect(result.status).toBe(200);
      const rows = (result.body as { interventions: ReadIntervention[] }).interventions;
      const found = rows.find((row) => row.id === intervention.id);
      if (!found) throw new Error('Approval missing from the objective state');
      return found;
    };

    const hidden = await state();
    expect(hidden.payload?.command).toBe('«secret required»');
    expect(hidden.detail).not.toContain('hunter2');

    const shown = await state({ 'x-foreman-tools-secret': 'read-me-if-you-can' });
    expect(shown.payload?.command).toBe(SECRET_COMMAND);
  });

  it('redacts that command in the stream snapshot, which the query string can unlock', async () => {
    process.env.FOREMAN_TOOLS_SECRET = 'read-me-if-you-can';
    const intervention = await blockedApproval(SECRET_COMMAND);

    // EventSource cannot set a header, so the stream takes the secret in the
    // query string or not at all. Drive the handler directly and read the init
    // frame — the same snapshot `/objectives/:id/state` serves.
    const initSnapshot = async (query: Record<string, string>) => {
      const handler = findRouteHandler(router, 'get', '/stream');
      const request = new EventEmitter() as EventEmitter & {
        query: Record<string, string>;
        params: Record<string, string>;
        body: Record<string, never>;
        headers: Record<string, string>;
      };
      request.query = query;
      request.params = {};
      request.body = {};
      request.headers = {};

      const chunks: string[] = [];
      const response = {
        writeHead: () => response,
        flushHeaders: () => undefined,
        write(chunk: string) {
          chunks.push(chunk);
          return true;
        },
        end: () => response,
      };
      handler(request as unknown as Request, response as unknown as Response, ((error?: unknown) => {
        if (error) throw error;
      }) as NextFunction);
      await vi.waitFor(() => {
        expect(chunks.join('')).toContain('event: init\n');
      }, { timeout: 10_000 });
      request.emit('close');
      const frame = chunks.join('').split('\n\n').find((entry) => entry.startsWith('event: init\n'));
      const parsed = JSON.parse(frame?.split('\ndata: ')[1] ?? '{}') as {
        interventions?: ReadIntervention[];
      };
      const found = parsed.interventions?.find((row) => row.id === intervention.id);
      if (!found) throw new Error('Approval missing from the stream snapshot');
      return found;
    };

    const hidden = await initSnapshot({ objectiveId });
    expect(hidden.payload?.command).toBe('«secret required»');
    expect(hidden.detail).not.toContain('hunter2');
    expect(hidden.title).toContain('wants to run "Wants approval"');

    const shown = await initSnapshot({ objectiveId, toolsSecret: 'read-me-if-you-can' });
    expect(shown.payload?.command).toBe(SECRET_COMMAND);

    const wrong = await initSnapshot({ objectiveId, toolsSecret: 'read-me-if-you-cam' });
    expect(wrong.payload?.command).toBe('«secret required»');
  }, 30_000);

  it('leaves the approval command open when no secret is configured', async () => {
    const intervention = await blockedApproval(SECRET_COMMAND);

    const result = await invokeRoute(router, 'get', '/interventions', {
      query: { objectiveId, status: 'pending' },
    });
    const found = (result.body as ReadIntervention[]).find((row) => row.id === intervention.id);

    expect(process.env.FOREMAN_TOOLS_SECRET).toBeUndefined();
    expect(found?.payload?.command).toBe(SECRET_COMMAND);
    expect(found?.detail).toContain(`Command: ${SECRET_COMMAND}`);
  });

  // ------------------------------------------------- permission.needsApproval --

  it('blocks a granted permission whose entry itself asks for per-use approval', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const marker = join(projectPath, 'per-use-marker');
    const tool = await makeTool({ name: 'Per-use permission', command: `touch ${marker}` });
    // The tool does NOT set needsApproval; the PERMISSION does. That entry was
    // parsed, stored and rendered but never consulted before.
    await grant(`tool:${tool.id}`, true);

    const result = await run(tool.id);

    expect((result.body as { lastStatus: string }).lastStatus).toBe('blocked');
    expect(existsSync(marker)).toBe(false);
    const interventions = await prisma.intervention.findMany({ where: { harnessId } });
    expect(interventions).toHaveLength(1);
    expect(interventions[0].kind).toBe('approval');
    expect(JSON.parse(interventions[0].payload ?? '{}')).toMatchObject({ toolId: tool.id });
  });

  // ----------------------------------------------------- one-shot atomicity --

  it('lets exactly one of two concurrent runs consume a single "approve"', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Approve once race', command: 'echo raced' });
    await run(tool.id);
    const intervention = await prisma.intervention.findFirstOrThrow({ where: { harnessId } });
    await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: intervention.id },
      body: { action: 'approve' },
    });

    await Promise.all([run(tool.id), run(tool.id)]);

    const runs = await prisma.harnessToolRun.findMany({
      where: { toolId: tool.id },
      orderBy: { createdAt: 'asc' },
    });
    // Three attempts: the original block, then the two racers.
    expect(runs).toHaveLength(3);
    expect(runs.filter((entry) => entry.status === 'ok')).toHaveLength(1);
    expect(runs.filter((entry) => entry.status === 'blocked-pending-approval')).toHaveLength(2);
    expect(runs.filter((entry) => entry.output === 'raced')).toHaveLength(1);
    expect(
      (await prisma.harnessTool.findUniqueOrThrow({ where: { id: tool.id } })).approvedInterventionId,
    ).toBe(null);
  });

  // ------------------------------------------------------------ concurrency --

  it('caps a single tool at one run in flight and answers 429 without a row', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Slow tool', command: 'sleep 1 && echo slow', timeoutMs: 10_000 });
    await grant(`tool:${tool.id}`);

    const [first, second] = await Promise.all([run(tool.id), run(tool.id)]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 429]);
    const rejected = first.status === 429 ? first : second;
    expect(rejected.body).toEqual({
      error: 'This tool is already running',
      scope: 'tool',
      running: 1,
      limit: 1,
    });
    // One attempt, one row — the refusal is deliberately not persisted.
    const runs = await prisma.harnessToolRun.findMany({ where: { toolId: tool.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('ok');
  }, 20_000);

  it('caps a harness at three runs in flight across its whole toolkit', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tools = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        makeTool({ name: `Parallel ${String(n)}`, command: 'sleep 1', timeoutMs: 10_000 }),
      ),
    );
    await prisma.harness.update({
      where: { id: harnessId },
      data: {
        permissions: JSON.stringify(
          tools.map((tool) => ({
            id: `tool:${tool.id}`,
            label: 'Run the tool',
            granted: true,
            needsApproval: false,
          })),
        ),
      },
    });

    const results = await Promise.all(tools.map((tool) => run(tool.id)));

    expect(results.filter((entry) => entry.status === 200)).toHaveLength(3);
    const rejected = results.filter((entry) => entry.status === 429);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].body).toEqual({
      error: 'Too many tools are already running on this harness',
      scope: 'harness',
      running: 3,
      limit: 3,
    });
    expect(
      await prisma.harnessToolRun.count({ where: { toolId: { in: tools.map((t) => t.id) } } }),
    ).toBe(3);
  }, 20_000);

  // ------------------------------------------------------- intervention dedup --

  it('raises exactly one approval per tool when two blocked tools alternate', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const alpha = await makeTool({ name: 'Alpha', command: 'echo alpha' });
    const beta = await makeTool({ name: 'Beta', command: 'echo beta' });

    for (let pass = 0; pass < 3; pass += 1) {
      await run(alpha.id);
      await run(beta.id);
    }

    const interventions = await prisma.intervention.findMany({
      where: { harnessId, kind: 'approval', status: 'pending' },
    });
    expect(interventions).toHaveLength(2);
    const toolIds = interventions
      .map((entry) => (JSON.parse(entry.payload ?? '{}') as { toolId: string }).toolId)
      .sort();
    expect(toolIds).toEqual([alpha.id, beta.id].sort());
    expect(await prisma.harnessToolRun.count({ where: { toolId: alpha.id } })).toBe(3);
  });

  // ------------------------------------------------------- confused deputies --

  it('never flips a permission from a non-approval intervention', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Deputy target', command: 'echo deputy' });
    await run(tool.id);
    // The un-granted entry now exists; forge a DIFF intervention naming it.
    const forged = await prisma.intervention.create({
      data: {
        objectiveId,
        harnessId,
        kind: 'diff',
        title: 'Review this diff',
        payload: JSON.stringify({ permissionId: `tool:${tool.id}`, toolId: tool.id }),
        status: 'pending',
      },
    });

    const result = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: forged.id },
      body: { action: 'approve-always' },
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: 'Only an approval intervention can grant a permission',
    });
    expect(
      parsePermissions(
        (await prisma.harness.findUniqueOrThrow({ where: { id: harnessId } })).permissions,
      ).find((entry) => entry.id === `tool:${tool.id}`)?.granted,
    ).toBe(false);
    expect(
      (await prisma.intervention.findUniqueOrThrow({ where: { id: forged.id } })).status,
    ).toBe('pending');
  });

  it('never hands a one-shot grant to a non-approval intervention', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Deputy one-shot', command: 'echo deputy' });
    const forged = await prisma.intervention.create({
      data: {
        objectiveId,
        harnessId,
        kind: 'budget',
        title: 'Spend cap reached',
        payload: JSON.stringify({ toolId: tool.id }),
        status: 'pending',
      },
    });

    const result = await invokeRoute(router, 'post', '/interventions/:id/resolve', {
      params: { id: forged.id },
      body: { action: 'approve' },
    });

    expect(result.status).toBe(200);
    expect(
      (await prisma.harnessTool.findUniqueOrThrow({ where: { id: tool.id } })).approvedInterventionId,
    ).toBe(null);
  });

  it('tells the truth about "always allow" on a tool that needs per-use approval', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Force push', command: 'echo dangerous', needsApproval: true });

    await run(tool.id);

    const intervention = await prisma.intervention.findFirstOrThrow({ where: { harnessId } });
    expect(intervention.detail).toContain('asks EVERY time');
    expect(intervention.detail).toContain('will still stop here for sign-off');
    expect(intervention.detail).not.toContain('for every future run');
  });

  // ------------------------------------------------------------ audit timing --

  it('opens the audit row before the spawn and settles the same row afterwards', async () => {
    process.env.FOREMAN_TOOLS = '1';
    const tool = await makeTool({ name: 'Pre-spawn row', command: 'sleep 1 && echo settled', timeoutMs: 10_000 });
    await grant(`tool:${tool.id}`);

    const pending = run(tool.id);
    // While the command sleeps, the row already exists and says so.
    await vi.waitFor(async () => {
      const rows = await prisma.harnessToolRun.findMany({ where: { toolId: tool.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('running');
      expect(rows[0].command).toBe('sleep 1 && echo settled');
      expect(rows[0].cwd).toBe(projectPath);
    }, { timeout: 3_000, interval: 50 });
    const runningId = (await prisma.harnessToolRun.findFirstOrThrow({ where: { toolId: tool.id } })).id;

    const result = await pending;

    // Same row, updated in place — one attempt is one row, id stable.
    const rows = await prisma.harnessToolRun.findMany({ where: { toolId: tool.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(runningId);
    expect(rows[0].status).toBe('ok');
    expect(rows[0].output).toBe('settled');
    expect((result.body as { lastRun: { id: string } }).lastRun.id).toBe(runningId);
  }, 20_000);
});

describe('Foreman tool exposure warning', () => {
  it('says nothing when tools are off, whatever the bind', () => {
    expect(remoteExposureWarning({}, '0.0.0.0')).toBe(null);
    expect(remoteExposureWarning({ FOREMAN_TOOLS: '0' }, '0.0.0.0')).toBe(null);
  });

  it('says nothing on a loopback bind with tools on', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect.soft(remoteExposureWarning({ FOREMAN_TOOLS: '1' }, host), host).toBe(null);
    }
  });

  it('warns loudly, naming the host and the remote-shell consequence', () => {
    const warning = remoteExposureWarning({ FOREMAN_TOOLS: '1' }, '0.0.0.0');
    expect(warning).not.toBe(null);
    expect(warning).toContain('NOT BOUND TO LOOPBACK');
    expect(warning).toContain('HOST=0.0.0.0');
    expect(warning).toContain('run shell commands');
    expect(warning).toContain('FOREMAN_TOOLS_SECRET is NOT set');
    expect((warning ?? '').split('\n')).toHaveLength(7);
  });

  it('still warns when the secret is set, but says the secret is the only fence', () => {
    const warning = remoteExposureWarning(
      { FOREMAN_TOOLS: '1', FOREMAN_TOOLS_SECRET: 's3cret' },
      '10.0.0.4',
    );
    expect(warning).toContain('HOST=10.0.0.4');
    expect(warning).toContain('FOREMAN_TOOLS_SECRET is set');
    expect(warning).not.toContain('is NOT set');
  });
});
