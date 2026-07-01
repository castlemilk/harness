import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { runTask } from '../lib/run-task.js';

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  complexity: z.enum(['simple', 'medium', 'complex']).default('simple'),
  tags: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done', 'failed']).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  complexity: z.enum(['simple', 'medium', 'complex']).optional(),
  tags: z.array(z.string()).optional(),
});

export function taskRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const tasks = await prisma.task.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    res.json(tasks);
  });

  r.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    const task = await prisma.task.create({
      data: {
        projectId: body.projectId,
        title: body.title,
        description: body.description,
        complexity: body.complexity,
        tags: JSON.stringify(body.tags),
      },
    });
    res.status(201).json(task);
  });

  r.patch('/:id', async (req, res) => {
    const body = updateSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.tags) data.tags = JSON.stringify(body.tags);
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data,
    });
    res.json(task);
  });

  r.post('/:id/run', async (req, res) => {
    try {
      const result = await runTask(prisma, req.params.id);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  r.delete('/:id', async (req, res) => {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.status(204).send();
  });

  return r;
}
