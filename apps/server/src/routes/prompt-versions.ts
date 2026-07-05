import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';

const createSchema = z.object({
  name: z.string().min(1),
  sourcePath: z.string().min(1),
  systemPrompt: z.string().min(1),
  textToolsPrompt: z.string().min(1),
  planningPrompt: z.string().optional(),
  skillContext: z.string().optional(),
  hash: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  benchmarkScore: z.number().optional(),
});

export function promptVersionRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', asyncHandler(async (_req, res) => {
    const versions = await prisma.promptVersion.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(versions);
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const version = await prisma.promptVersion.findUnique({
      where: { id: req.params.id },
    });
    if (!version) {
      res.status(404).json({ error: 'Prompt version not found' });
      return;
    }
    res.json(version);
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const version = await prisma.promptVersion.create({
      data: {
        name: body.name,
        sourcePath: body.sourcePath,
        systemPrompt: body.systemPrompt,
        textToolsPrompt: body.textToolsPrompt,
        planningPrompt: body.planningPrompt ?? null,
        skillContext: body.skillContext ?? null,
        hash: body.hash,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        benchmarkScore: body.benchmarkScore ?? null,
      },
    });
    res.status(201).json(version);
  }));

  return r;
}
