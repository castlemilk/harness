import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, prisma, type PrismaClient } from '@omega/db';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { foremanRoutes } from './foreman.js';
import {
  buildSystemPrompt,
  skillBody,
  substituteRoutineVars,
} from '../lib/pulse-engine.js';

vi.hoisted(() => {
  // Own PGlite directory: this suite migrates and must not race the others.
  process.env.DATABASE_DIR = `/tmp/omega-foreman-projects-vitest-${String(process.pid)}-${process.env.VITEST_WORKER_ID ?? '0'}`;
});

/**
 * The project-growth surface: objectives that can change after birth,
 * workstreams and playbooks that can be authored through the API, skill
 * grants, and the interject-releases-a-waiting-harness rule. Same
 * invokeRoute technique as foreman.test.ts.
 */

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

const router = foremanRoutes(prisma as unknown as PrismaClient);

async function invoke(
  method: string,
  path: string,
  input: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
): Promise<RouteResult> {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  const layer = stack.find((candidate) =>
    candidate.route?.path === path && candidate.route.methods[method.toLowerCase()] === true
  );
  const handler = layer?.route?.stack?.[0]?.handle;
  if (!handler) throw new Error(`Route not registered: ${method.toUpperCase()} ${path}`);

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
      headers: {},
    };
    const next: NextFunction = (error?: unknown) => {
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else reject(new Error('Route called next() without a response'));
    };
    handler(request as Request, response as unknown as Response, next);
  });
}

let projectId = '';
let objectiveId = '';

beforeAll(async () => {
  await applyMigrations();
  const project = await prisma.project.create({
    data: { name: 'growth-project', path: '/tmp/growth-project' },
  });
  projectId = project.id;
  const objective = await prisma.objective.create({
    data: { projectId, name: 'Grow the project' },
  });
  objectiveId = objective.id;
  await prisma.skillArtifact.create({
    data: {
      name: 'regime-analysis',
      sourcePath: '/tmp/does-not-exist/SKILL.md',
      generatedPath: '/tmp/does-not-exist/skill.ts',
      manifest: JSON.stringify({ name: 'regime-analysis', description: 'Read regime shifts.' }),
    },
  });
}, 60_000);

describe('PATCH /objectives/:id', () => {
  it('renames, writes standing instructions, and archives after birth', async () => {
    const renamed = await invoke('patch', '/objectives/:id', {
      params: { id: objectiveId },
      body: { name: 'Grow the project, renamed', instructions: 'Prefer boring technology.' },
    });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { name: string }).name).toBe('Grow the project, renamed');
    expect((renamed.body as { instructions: string }).instructions).toBe('Prefer boring technology.');

    const archived = await invoke('patch', '/objectives/:id', {
      params: { id: objectiveId },
      body: { status: 'archived' },
    });
    expect((archived.body as { status: string }).status).toBe('archived');

    // Back to active so the rest of the suite runs against a live objective.
    await invoke('patch', '/objectives/:id', {
      params: { id: objectiveId },
      body: { status: 'active', name: 'Grow the project' },
    });
  });

  it('404s an unknown objective and rejects unknown fields', async () => {
    const missing = await invoke('patch', '/objectives/:id', {
      params: { id: '00000000-0000-4000-8000-000000000000' },
      body: { name: 'x' },
    });
    expect(missing.status).toBe(404);

    await expect(
      invoke('patch', '/objectives/:id', {
        params: { id: objectiveId },
        body: { mission: 'objectives have no mission field' },
      }),
    ).rejects.toThrow();
  });
});

describe('workstream create + update', () => {
  it('creates lanes with an auto-incrementing orderIdx', async () => {
    const first = await invoke('post', '/workstreams', {
      body: { objectiveId, name: 'Lane one' },
    });
    expect(first.status).toBe(201);
    expect((first.body as { orderIdx: number }).orderIdx).toBe(0);

    const second = await invoke('post', '/workstreams', {
      body: { objectiveId, name: 'Lane two' },
    });
    expect((second.body as { orderIdx: number }).orderIdx).toBe(1);
  });

  it('renames a lane, and refuses a lead from another objective', async () => {
    const lane = await prisma.workstream.findFirst({ where: { objectiveId, name: 'Lane one' } });
    if (!lane) throw new Error('lane fixture missing');

    const renamed = await invoke('patch', '/workstreams/:id', {
      params: { id: lane.id },
      body: { name: 'Lane one, renamed' },
    });
    expect((renamed.body as { name: string }).name).toBe('Lane one, renamed');

    const otherObjective = await prisma.objective.create({
      data: { projectId, name: 'Another objective' },
    });
    const foreign = await prisma.harness.create({
      data: {
        objectiveId: otherObjective.id,
        name: 'foreign-lead',
        mission: 'Belong elsewhere.',
        model: 'test-model',
      },
    });
    const bad = await invoke('patch', '/workstreams/:id', {
      params: { id: lane.id },
      body: { leadHarnessId: foreign.id },
    });
    expect(bad.status).toBe(400);
  });

  it('404s creating a lane on an unknown objective', async () => {
    const missing = await invoke('post', '/workstreams', {
      body: { objectiveId: '00000000-0000-4000-8000-000000000000', name: 'x' },
    });
    expect(missing.status).toBe(404);
  });
});

describe('POST /playbooks', () => {
  it('authors a brand-new v1 playbook', async () => {
    const created = await invoke('post', '/playbooks', {
      body: {
        projectId,
        name: 'Desk reviewer loop',
        steps: [{ index: 1, text: 'Read the desk state.', condition: null }],
        cadence: 'every 60m',
      },
    });
    expect(created.status).toBe(201);
    const body = created.body as { name: string; version: number; steps: { text: string }[] };
    expect(body.name).toBe('Desk reviewer loop');
    expect(body.version).toBe(1);
    expect(body.steps[0].text).toBe('Read the desk state.');
  });

  it('409s a duplicate name — the name is the version chain identity', async () => {
    const dupe = await invoke('post', '/playbooks', {
      body: { name: 'Desk reviewer loop' },
    });
    expect(dupe.status).toBe(409);
    expect((dupe.body as { error: string }).error).toContain('version it instead');
  });
});

describe('harness skill grants', () => {
  it('400s an unknown skill name, naming the stray', async () => {
    const bad = await invoke('post', '/harnesses', {
      body: {
        objectiveId,
        name: 'skilled-1',
        mission: 'Use skills.',
        model: 'test-model',
        heartbeatMinutes: 30,
        maxChildren: 0,
        permissions: [],
        skills: ['regime-analysis', 'no-such-skill'],
      },
    });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toContain('no-such-skill');
  });

  it('stores registered grants and serves them back as an array', async () => {
    const created = await invoke('post', '/harnesses', {
      body: {
        objectiveId,
        name: 'skilled-2',
        mission: 'Use skills.',
        model: 'test-model',
        heartbeatMinutes: 30,
        maxChildren: 0,
        permissions: [],
        skills: ['regime-analysis'],
      },
    });
    expect(created.status).toBe(201);
    expect((created.body as { skills: string[] }).skills).toEqual(['regime-analysis']);

    const id = (created.body as { id: string }).id;
    const cleared = await invoke('patch', '/harnesses/:id', {
      params: { id },
      body: { skills: [] },
    });
    expect((cleared.body as { skills: string[] }).skills).toEqual([]);
  });

  it('lists the registry with the manifest description', async () => {
    const listing = await invoke('get', '/skills');
    expect(listing.status).toBe(200);
    const rows = listing.body as { name: string; description: string }[];
    expect(rows.some((r) => r.name === 'regime-analysis' && r.description === 'Read regime shifts.')).toBe(true);
  });
});

describe('interject on a waiting harness', () => {
  it('releases it — the interject IS the human input it was waiting for', async () => {
    const task = await prisma.task.create({
      data: { projectId, title: 'waiting-task' },
    });
    const harness = await prisma.harness.create({
      data: {
        objectiveId,
        name: 'blocked-on-you',
        mission: 'Wait for a decision.',
        model: 'test-model',
        status: 'waiting',
        taskId: task.id,
        nextPulseAt: null,
      },
    });

    const before = Date.now();
    const result = await invoke('post', '/harnesses/:id/interject', {
      params: { id: harness.id },
      body: { text: 'Ship the boring option.' },
    });
    expect(result.status).toBe(201);

    const after = await prisma.harness.findUnique({ where: { id: harness.id } });
    expect(after?.status).toBe('working');
    expect(after?.nextPulseAt).not.toBeNull();
    expect(after?.nextPulseAt?.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(after?.nextPulseAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('leaves a working harness\'s schedule alone', async () => {
    const task = await prisma.task.create({ data: { projectId, title: 'working-task' } });
    const later = new Date(Date.now() + 30 * 60_000);
    const harness = await prisma.harness.create({
      data: {
        objectiveId,
        name: 'already-working',
        mission: 'Keep going.',
        model: 'test-model',
        status: 'working',
        taskId: task.id,
        nextPulseAt: later,
      },
    });
    await invoke('post', '/harnesses/:id/interject', {
      params: { id: harness.id },
      body: { text: 'FYI only.' },
    });
    const after = await prisma.harness.findUnique({ where: { id: harness.id } });
    expect(after?.status).toBe('working');
    expect(after?.nextPulseAt?.getTime()).toBe(later.getTime());
  });
});

describe('transcript pulse narration + emptiness', () => {
  it('carries each pulse\'s summary/outcome and flags trace-less windows empty', async () => {
    const task = await prisma.task.create({ data: { projectId, title: 'transcript-task' } });
    const harness = await prisma.harness.create({
      data: {
        objectiveId,
        name: 'narrator',
        mission: 'Narrate.',
        model: 'test-model',
        taskId: task.id,
      },
    });
    const t0 = new Date('2026-08-21T00:00:00Z');
    const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);
    await prisma.pulse.createMany({
      data: [
        { harnessId: harness.id, seq: 1, startedAt: minutes(0), endedAt: minutes(1), outcome: 'ok', summary: 'Checked the board; nothing new.' },
        { harnessId: harness.id, seq: 2, startedAt: minutes(30), endedAt: minutes(31), outcome: 'ok', summary: 'Still nothing.' },
        { harnessId: harness.id, seq: 3, startedAt: minutes(60), endedAt: minutes(61), outcome: 'warn', summary: 'Spend is drifting.' },
      ],
    });
    // One trace inside pulse 3's window makes it non-empty.
    await prisma.taskTrace.create({
      data: { taskId: task.id, role: 'user', content: 'Watch the spend.', createdAt: minutes(62) },
    });

    const result = await invoke('get', '/harnesses/:id/transcript', {
      params: { id: harness.id },
    });
    const entries = result.body as ({ kind: string; seq?: number; summary?: string; outcome?: string; empty?: boolean })[];
    const dividers = entries.filter((e) => e.kind === 'pulse-divider');
    expect(dividers.map((d) => d.seq)).toEqual([1, 2, 3]);
    expect(dividers[0]).toMatchObject({ summary: 'Checked the board; nothing new.', outcome: 'ok', empty: true });
    expect(dividers[1]).toMatchObject({ empty: true });
    expect(dividers[2]).toMatchObject({ outcome: 'warn', empty: false });
  });

  it('serves only the newest N pulses when asked', async () => {
    const harness = await prisma.harness.findFirst({ where: { name: 'narrator' } });
    if (!harness) throw new Error('narrator fixture missing');
    const result = await invoke('get', '/harnesses/:id/transcript', {
      params: { id: harness.id },
      query: { limit: '2' },
    });
    const dividers = (result.body as { kind: string; seq?: number }[]).filter((e) => e.kind === 'pulse-divider');
    expect(dividers.map((d) => d.seq)).toEqual([2, 3]);
  });
});

describe('pulse prompt assembly', () => {
  const harness = {
    name: 'regime-watcher',
    mission: 'Watch the regime classifier.',
  } as Parameters<typeof buildSystemPrompt>[0];

  it('injects objective instructions and skill bodies, and discloses an unloadable grant', () => {
    const prompt = buildSystemPrompt(
      harness,
      { name: 'Run the desk', instructions: 'Prefer boring technology.' },
      [
        { name: 'regime-analysis', body: '# Regime analysis\nCompare labels to the manifest.' },
        { name: 'gone-skill', body: null },
      ],
    );
    expect(prompt).toContain('Standing instructions for every agent on this objective:');
    expect(prompt).toContain('Prefer boring technology.');
    expect(prompt).toContain('── Skill: regime-analysis ──');
    expect(prompt).toContain('Compare labels to the manifest.');
    expect(prompt).toContain('── Skill: gone-skill ──');
    expect(prompt).toContain('treat it as unavailable');
  });

  it('prompts exactly as before when there are no instructions and no skills', () => {
    const prompt = buildSystemPrompt(harness, { name: 'Run the desk' });
    expect(prompt).not.toContain('Standing instructions');
    expect(prompt).not.toContain('── Skill:');
    expect(prompt).toContain('Watch the regime classifier.');
  });

  it('strips SKILL.md frontmatter and bounds the body', () => {
    expect(skillBody('---\nname: x\ndescription: y\n---\n# Body\nText.')).toBe('# Body\nText.');
    expect(skillBody('no frontmatter at all')).toBe('no frontmatter at all');
    expect(skillBody(`---\nname: x\n---\n${'a'.repeat(20_000)}`).length).toBe(8_000);
  });

  it('substitutes routine $variables and leaves unresolvable tokens literal', () => {
    const steps = substituteRoutineVars(
      [
        { index: 1, text: 'Work $ticket in $branch.', condition: 'when $objective is active' },
        { index: 2, text: 'Hand off to $reviewer.' },
      ],
      { ticket: 'Fix the funnel', branch: 'fix/funnel', objective: 'Run the desk' },
    );
    expect(steps[0].text).toBe('Work Fix the funnel in fix/funnel.');
    expect(steps[0].condition).toBe('when Run the desk is active');
    // $reviewer has no binding: literal, never silently dropped.
    expect(steps[1].text).toBe('Hand off to $reviewer.');
  });
});
