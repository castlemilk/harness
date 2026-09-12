import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { app } from '../app.js';
import { prisma, applyMigrations } from '@omega/db';

const cuttlefish = http.createServer((req, res) => {
  req.resume();
  const send = (body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = req.url ?? '';
  if (url === '/healthz') return send({ ok: true });
  if (url === '/api/workflows/validate') return send({ issues: [] });
  if (req.method === 'GET' && url === '/api/workflows') return send({ workflows: [] });
  if (req.method === 'POST' && url === '/api/workflows') return send({ workflow: { id: 'wf-1', name: 'hello-world' } });
  if (req.method === 'PUT' && url === '/api/workflows/wf-1/draft') return send({ workflow: { id: 'wf-1', name: 'hello-world' } });
  if (req.method === 'POST' && url === '/api/workflows/wf-1/publish') {
    return send({ workflowVersion: { id: 'wfv-1', workflowId: 'wf-1', versionNum: 1 } });
  }
  send({ error: `no route for ${url}` }, 404);
});

let runtimeBaseUrl = '';

beforeAll(async () => {
  await applyMigrations();
  await new Promise<void>((resolve) => cuttlefish.listen(0, '127.0.0.1', resolve));
  runtimeBaseUrl = `http://127.0.0.1:${(cuttlefish.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => cuttlefish.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  delete process.env.OMEGA_API_TOKEN;
  await prisma.flowRun.deleteMany();
  await prisma.runtimeConnection.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
});

describe('v1 agents API', () => {
  it('describes capabilities at the root', async () => {
    const res = await request(app).get('/v1');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('harness');
    expect(res.body.resources).toContain('runtimes');
    expect(res.body.endpoints.mcp).toBe('/mcp');
  });

  it('reports health', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('creates, lists and health-checks a runtime connection', async () => {
    const created = await request(app)
      .post('/v1/runtimes')
      .send({ name: 'local-cuttlefish', baseUrl: runtimeBaseUrl, apiToken: 'cf_sa_secret' });
    expect(created.status).toBe(201);
    expect(created.body.apiToken).toBe('***');

    const id = created.body.id as string;
    const list = await request(app).get('/v1/runtimes');
    expect(list.status).toBe(200);
    expect(list.body.runtimes).toHaveLength(1);

    const health = await request(app).post(`/v1/runtimes/${id}/health`);
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.status).toBe('ok');
  });

  it('rejects duplicate runtime names', async () => {
    await request(app).post('/v1/runtimes').send({ name: 'dup', baseUrl: runtimeBaseUrl });
    const second = await request(app).post('/v1/runtimes').send({ name: 'dup', baseUrl: runtimeBaseUrl });
    expect(second.status).toBe(409);
  });

  it('publishes a workflow through a runtime connection', async () => {
    const created = await request(app)
      .post('/v1/runtimes')
      .send({ name: 'publisher', baseUrl: runtimeBaseUrl });
    const id = created.body.id as string;

    const published = await request(app)
      .post(`/v1/runtimes/${id}/workflows`)
      .send({ name: 'hello-world', workflowYAML: 'apiVersion: cuttlefish.dev/v1alpha1\nkind: Workflow' });
    expect(published.status).toBe(201);
    expect(published.body.published).toBe(true);
    expect(published.body.workflowVersion.id).toBe('wfv-1');
  });

  it('creates a task and exposes it as a run', async () => {
    const project = await request(app).post('/v1/projects').send({ name: 'v1-demo', path: '/tmp/v1-demo' });
    expect(project.status).toBe(201);

    const task = await request(app)
      .post('/v1/tasks')
      .send({ projectId: project.body.id, title: 'v1 task', tags: ['flow:demo'] });
    expect(task.status).toBe(201);

    const run = await request(app).get(`/v1/runs/${task.body.id as string}`);
    expect(run.status).toBe(200);
    expect(run.body.object).toBe('run');
    expect(run.body.kind).toBe('task');
    expect(run.body.task.title).toBe('v1 task');
  });

  it('requires a bearer token when OMEGA_API_TOKEN is configured', async () => {
    process.env.OMEGA_API_TOKEN = 'test-token';
    try {
      const unauthorized = await request(app).get('/v1/projects');
      expect(unauthorized.status).toBe(401);

      const authorized = await request(app)
        .get('/v1/projects')
        .set('Authorization', 'Bearer test-token');
      expect(authorized.status).toBe(200);

      // Health stays open for liveness probes.
      const health = await request(app).get('/v1/health');
      expect(health.status).toBe(200);
    } finally {
      delete process.env.OMEGA_API_TOKEN;
    }
  });

  it('returns JSON 404 for unknown v1 paths', async () => {
    const res = await request(app).get('/v1/not-a-thing');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
