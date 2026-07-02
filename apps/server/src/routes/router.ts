import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { selectProvider } from '@omega/router';
import type { ProviderConfig as CoreProviderConfig, Task } from '@omega/core';
import { asyncHandler } from '../lib/async-handler.js';

const selectSchema = z.object({
  title: z.string().min(1),
  complexity: z.enum(['simple', 'medium', 'complex']).default('simple'),
  tags: z.array(z.string()).default([]),
});

function toCoreConfig(row: {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiKey: string | null;
  defaultModel: string;
  capabilities: string;
  enabled: boolean;
}): CoreProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CoreProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: JSON.parse(row.capabilities) as CoreProviderConfig['capabilities'],
    enabled: row.enabled,
  };
}

export function routerRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.post('/select', asyncHandler(async (req, res) => {
    const body = selectSchema.parse(req.body);
    const configs = await prisma.providerConfig.findMany();
    const coreConfigs = configs.map(toCoreConfig);
    const task: Task = {
      id: 'preview',
      projectId: 'preview',
      title: body.title,
      status: 'todo',
      complexity: body.complexity,
      tags: body.tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const selection = selectProvider(coreConfigs, [], task);
    if (!selection) {
      res.status(404).json({ error: 'No provider available for this task' });
      return;
    }
    res.json({ provider: selection.provider.name, model: selection.model });
  }));

  return r;
}
