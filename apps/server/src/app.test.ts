import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { prisma, applyMigrations, seedDefaults } from '@omega/db';

describe('API', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedDefaults();
    await prisma.task.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a project', async () => {
    const res = await request(app).post('/projects').send({ name: 'demo', path: '/tmp/demo' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('demo');
  });

  it('lists projects', async () => {
    const res = await request(app).get('/projects');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a task and selects a provider', async () => {
    const projects = await request(app).get('/projects');
    const projectId = projects.body[0].id;
    const taskRes = await request(app)
      .post('/tasks')
      .send({ projectId, title: 'summarize', complexity: 'simple', tags: [] });
    expect(taskRes.status).toBe(201);

    const selectRes = await request(app)
      .post('/router/select')
      .send({ title: 'summarize', complexity: 'simple', tags: [] });
    expect(selectRes.status).toBe(200);
    expect(selectRes.body.provider).toBeDefined();
    expect(selectRes.body.model).toBeDefined();
  });

  describe('unknown API paths', () => {
    it('answers /api/... with a JSON 404 in the standard error envelope', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'No such endpoint: GET /api/does-not-exist' });
    });

    it('answers an unknown /foreman/... path with a JSON 404, naming the method', async () => {
      const res = await request(app).post('/foreman/objectives/nope/not-a-thing');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({
        error: 'No such endpoint: POST /foreman/objectives/nope/not-a-thing',
      });
    });

    it('still serves a real /foreman route', async () => {
      const res = await request(app).get('/foreman/playbooks');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    // The SPA catch-all lives in index.ts, mounted after this app's routes, so
    // here the assertion is that the 404 handler let the request through
    // untouched — no JSON envelope, nothing claimed about the path.
    it('leaves a non-API path for the SPA catch-all', async () => {
      const res = await request(app).get('/objectives/abc');
      expect(res.headers['content-type']).not.toMatch(/application\/json/);
      expect(res.body).toEqual({});
    });
  });
});
