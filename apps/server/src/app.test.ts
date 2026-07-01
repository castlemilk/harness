import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { prisma } from '@omega/db';

describe('API', () => {
  beforeAll(async () => {
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
});
