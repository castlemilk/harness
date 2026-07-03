import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { runTask } from '../lib/run-task.js';
import { asyncHandler } from '../lib/async-handler.js';

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

  r.get('/', asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const tasks = await prisma.task.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    res.json(tasks);
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  }));

  r.post('/', asyncHandler(async (req, res) => {
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
  }));

  r.patch('/:id', asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.tags) data.tags = JSON.stringify(body.tags);
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data,
    });
    res.json(task);
  }));

  r.post('/:id/run', asyncHandler(async (req, res) => {
    try {
      const result = await runTask(prisma, req.params.id);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  r.get('/:id/steps', asyncHandler(async (req, res) => {
    const steps = await prisma.taskStep.findMany({
      where: { taskId: req.params.id },
      orderBy: { idx: 'asc' },
    });
    res.json(steps);
  }));

  r.get('/:id/traces', asyncHandler(async (req, res) => {
    const traces = await prisma.taskTrace.findMany({
      where: { taskId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(traces);
  }));

  r.get('/:id/diffs', asyncHandler(async (req, res) => {
    const diffs = await prisma.taskDiff.findMany({
      where: { taskId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(diffs);
  }));

  r.get('/:id/agent-run', asyncHandler(async (req, res) => {
    const run = await prisma.agentRun.findFirst({
      where: { taskId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      res.status(404).json({ error: 'Agent run not found' });
      return;
    }
    res.json(run);
  }));

  r.get('/:id/trace-flow', asyncHandler(async (req, res) => {
    const spans = await prisma.traceSpan.findMany({
      where: { taskId: req.params.id },
      orderBy: { startTime: 'asc' },
    });

    const byParent: Record<string, typeof spans> = {};
    for (const span of spans) {
      const parent = span.parentId ?? '__root__';
      byParent[parent] = byParent[parent] ?? [];
      byParent[parent].push(span);
    }

    function buildTree(parentId: string | null): unknown[] {
      const key = parentId ?? '__root__';
      const children = byParent[key] ?? [];
      return children.map((s) => ({
        ...s,
        attributes: s.attributes ? JSON.parse(s.attributes) : undefined,
        events: s.events ? JSON.parse(s.events) : undefined,
        children: buildTree(s.spanId),
      }));
    }

    res.json({
      traceId: spans[0]?.traceId,
      spans: buildTree(null),
    });
  }));

  return r;
}
