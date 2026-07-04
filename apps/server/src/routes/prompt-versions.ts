import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';

const createSchema = z.object({
  name: z.string().min(1),
  sourcePath: z.string().min(1),
  systemPrompt: z.string().min(1),
  textToolsPrompt: z.string().min(1),
  hash: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export function promptVersionRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', asyncHandler(async (_req, res) => {
    const versions = await prisma.promptVersion.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(versions);
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const version = await prisma.promptVersion.create({
      data: {
        name: body.name,
        sourcePath: body.sourcePath,
        systemPrompt: body.systemPrompt,
        textToolsPrompt: body.textToolsPrompt,
        hash: body.hash,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      },
    });
    res.status(201).json(version);
  }));

  return r;
}
