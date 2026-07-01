import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  repoUrl: z.string().optional(),
  description: z.string().optional(),
});

export function projectRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    const projects = await prisma.project.findMany({
      include: { _count: { select: { tasks: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(projects);
  });

  r.get('/:id', async (req, res) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { tasks: true },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  });

  r.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    const project = await prisma.project.create({ data: body });
    res.status(201).json(project);
  });

  r.delete('/:id', async (req, res) => {
    await prisma.project.delete({ where: { id: req.params.id } });
    res.status(204).send();
  });

  return r;
}
