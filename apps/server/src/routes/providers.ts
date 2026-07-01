import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';

const providerKinds = z.enum(['openai', 'anthropic', 'ollama', 'gemini', 'generic']);

const createSchema = z.object({
  name: z.string().min(1),
  kind: providerKinds,
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  defaultModel: z.string().min(1),
  capabilities: z.union([z.string(), z.array(z.any())]).optional(),
  enabled: z.boolean().optional(),
});

function normalizeCapabilities(input: unknown): string {
  if (Array.isArray(input)) return JSON.stringify(input);
  if (typeof input === 'string') {
    try {
      JSON.parse(input);
      return input;
    } catch {
      return JSON.stringify([{ name: input, level: 'capable' }]);
    }
  }
  return JSON.stringify([]);
}

export function providerRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    const providers = await prisma.providerConfig.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(providers);
  });

  r.post('/', async (req, res) => {
    const body = createSchema.parse(req.body);
    const provider = await prisma.providerConfig.create({
      data: {
        ...body,
        capabilities: normalizeCapabilities(body.capabilities),
        enabled: body.enabled ?? true,
      },
    });
    res.status(201).json(provider);
  });

  r.patch('/:id/toggle', async (req, res) => {
    const existing = await prisma.providerConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    const provider = await prisma.providerConfig.update({
      where: { id: req.params.id },
      data: { enabled: !existing.enabled },
    });
    res.json(provider);
  });

  r.delete('/:id', async (req, res) => {
    await prisma.providerConfig.delete({ where: { id: req.params.id } });
    res.status(204).send();
  });

  return r;
}
