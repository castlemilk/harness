import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { applyMigrations, prisma } from '@omega/db';
import { startTaskFlow, syncFlowRunOnce, cancelTaskFlow, stopAllFlowSyncs } from './cuttlefish-run.js';
import { resolveTaskRuntime } from './runtime-connections.js';

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

const requests: RecordedRequest[] = [];
let runStatus = 'QUEUED';
let cancelCalled = false;

function reply(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => {
    raw += chunk.toString();
  });
  req.on('end', () => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', body: raw ? JSON.parse(raw) : undefined });
    const url = req.url ?? '';

    if (url === '/healthz') {
      reply(res, { ok: true });
      return;
    }
    if (url === '/api/workflows/validate') {
      reply(res, { issues: [] });
      return;
    }
    if (url === '/api/runs/start') {
      reply(res, { run: { id: 'run-1', status: 'QUEUED', workflowName: 'omega-test' }, taskInstances: [] });
      return;
    }
    if (url === '/api/runs/run-1/cancel' || url === '/api/runs/run-2/cancel') {
      cancelCalled = true;
      reply(res, { run: { id: 'run-1', status: 'CANCELLED' } });
      return;
    }
    if (url === '/api/runs/run-1') {
      reply(res, {
        run: {
          id: 'run-1',
          status: runStatus,
          outputs: { message: 'hi' },
          latestReason: runStatus === 'SUCCEEDED' ? 'all_nodes_succeeded' : 'node_failed',
        },
        taskInstances: [{ runId: 'run-1', nodeId: 'echo', status: runStatus }],
      });
      return;
    }
    if (url === '/api/runs/run-1/attempts') {
      reply(res, {
        attempts: [
          {
            id: 'attempt-1',
            nodeId: 'echo',
            attemptNum: 1,
            status: 'SUCCEEDED',
            runnerId: 'runner-1',
            startedAt: '2026-09-11T00:00:00.000Z',
            finishedAt: '2026-09-11T00:00:01.000Z',
            outputs: { message: 'hi' },
          },
        ],
      });
      return;
    }
    if (url === '/api/runs/run-1/artifacts') {
      reply(res, { artifacts: [{ name: 'omega/out.txt', sizeBytes: 12 }] });
      return;
    }
    if (url === '/api/runs/run-1/logs') {
      reply(res, { logs: '[echo] hello log' });
      return;
    }
    reply(res, { error: `no route for ${url}` }, 404);
  });
});

let baseUrl = '';

beforeAll(async () => {
  await applyMigrations();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  stopAllFlowSyncs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  requests.length = 0;
  runStatus = 'QUEUED';
  cancelCalled = false;
  await prisma.flowRun.deleteMany();
  await prisma.runtimeConnection.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
});

afterEach(() => {
  stopAllFlowSyncs();
});

async function seedTask(tags: string[]) {
  const project = await prisma.project.create({ data: { name: 'flow-demo', path: '/tmp/flow-demo' } });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Run on the fleet',
      description: 'Do the thing',
      tags: JSON.stringify(tags),
    },
  });
  const connection = await prisma.runtimeConnection.create({
    data: {
      projectId: project.id,
      name: `cf-${task.id.slice(0, 6)}`,
      baseUrl,
      defaultWorkflowVersionId: '99999999-8888-7777-6666-555555555555',
      autoRoute: tags.length === 0,
    },
  });
  return { project, task, connection };
}

describe('resolveTaskRuntime', () => {
  it('auto-routes tasks when a connection has autoRoute enabled', async () => {
    const { task, connection } = await seedTask([]);
    const resolved = await resolveTaskRuntime(prisma, task);
    expect(resolved?.connection.id).toBe(connection.id);
  });

  it('honours flow-off over autoRoute', async () => {
    const { task } = await seedTask(['flow-off']);
    await expect(resolveTaskRuntime(prisma, task)).resolves.toBeNull();
  });

  it('resolves a named runtime connection', async () => {
    const { task, connection } = await seedTask(['runtime:placeholder']);
    await prisma.task.update({
      where: { id: task.id },
      data: { tags: JSON.stringify([`runtime:${connection.name}`]) },
    });
    const refreshed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const resolved = await resolveTaskRuntime(prisma, refreshed);
    expect(resolved?.connection.id).toBe(connection.id);
  });

  it('throws for an unknown named runtime', async () => {
    const { task } = await seedTask(['runtime:does-not-exist']);
    await expect(resolveTaskRuntime(prisma, task)).rejects.toThrow('not found or disabled');
  });
});

describe('startTaskFlow', () => {
  it('dispatches a pinned workflow version and records the flow run', async () => {
    const { task, connection } = await seedTask(['flow-version:99999999-8888-7777-6666-555555555555']);

    const { flowRun, task: updated } = await startTaskFlow(prisma, task.id, {
      connection,
      workflowVersionId: connection.defaultWorkflowVersionId ?? undefined,
    });
    stopAllFlowSyncs();

    expect(flowRun.externalRunId).toBe('run-1');
    expect(flowRun.status).toBe('QUEUED');
    expect(updated.provider).toBe('cuttlefish');

    const startRequest = requests.find((r) => r.url === '/api/runs/start');
    expect(startRequest).toBeDefined();
    expect(startRequest?.body).toMatchObject({
      workflowVersionId: '99999999-8888-7777-6666-555555555555',
      inputs: expect.objectContaining({ taskTitle: 'Run on the fleet' }),
    });

    const steps = await prisma.taskStep.findMany({ where: { taskId: task.id } });
    expect(steps.some((s) => s.name.startsWith('flow:'))).toBe(true);
  });

  it('finishes a successful run and mirrors spans, artifacts and logs', async () => {
    const { task, connection } = await seedTask(['flow-version:99999999-8888-7777-6666-555555555555']);
    const { flowRun } = await startTaskFlow(prisma, task.id, {
      connection,
      workflowVersionId: connection.defaultWorkflowVersionId ?? undefined,
    });
    stopAllFlowSyncs();

    runStatus = 'SUCCEEDED';
    await syncFlowRunOnce(prisma, flowRun.id);

    const finished = await prisma.flowRun.findUniqueOrThrow({ where: { id: flowRun.id } });
    expect(finished.status).toBe('SUCCEEDED');
    expect(finished.completedAt).not.toBeNull();

    const updatedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe('done');
    expect(updatedTask.result).toContain('cuttlefish');

    const spans = await prisma.traceSpan.findMany({ where: { taskId: task.id } });
    expect(spans.some((s) => s.spanId === 'cf-attempt-1')).toBe(true);

    const traces = await prisma.taskTrace.findMany({ where: { taskId: task.id } });
    expect(traces.some((t) => (t.content ?? '').includes('hello log'))).toBe(true);
  });

  it('cancels the remote run and fails the task', async () => {
    const { task, connection } = await seedTask(['flow-version:99999999-8888-7777-6666-555555555555']);
    await startTaskFlow(prisma, task.id, {
      connection,
      workflowVersionId: connection.defaultWorkflowVersionId ?? undefined,
    });
    stopAllFlowSyncs();

    await expect(cancelTaskFlow(prisma, task.id)).resolves.toBe(true);
    expect(cancelCalled).toBe(true);

    const updatedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updatedTask.status).toBe('failed');
    expect(updatedTask.error).toContain('Cancelled');
  });
});
