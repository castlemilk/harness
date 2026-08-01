import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { selectProvider } from '@omega/router';
import type { Task } from '@omega/core';
import { asyncHandler } from '../lib/async-handler.js';
import { getRouter } from '../lib/intelligent-router.js';
import { toCoreConfig } from '../lib/utils.js';

const selectSchema = z.object({
  title: z.string().min(1),
  complexity: z.enum(['simple', 'medium', 'complex']).default('simple'),
  tags: z.array(z.string()).default([]),
});

const intelligentSelectSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  complexity: z.enum(['simple', 'medium', 'complex']).default('simple'),
  tags: z.array(z.string()).default([]),
  strategy: z.enum(['balanced', 'cost-optimized', 'performance-optimized', 'consensus', 'exploratory']).default('balanced'),
  budgetUsd: z.number().positive().optional(),
  maxCandidates: z.number().int().min(1).max(5).default(3),
});

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

  // Intelligent routing preview — full score breakdown + fallbacks
  r.post('/intelligent', asyncHandler(async (req, res) => {
    const body = intelligentSelectSchema.parse(req.body);
    const configs = await prisma.providerConfig.findMany();
    const coreConfigs = configs.map(toCoreConfig);
    const task: Task = {
      id: 'preview',
      projectId: 'preview',
      title: body.title,
      description: body.description,
      status: 'todo',
      complexity: body.complexity,
      tags: body.tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const router = await getRouter(prisma);
    const decision = router.route(coreConfigs, task, {
      strategy: body.strategy,
      budgetUsd: body.budgetUsd,
      maxCandidates: body.maxCandidates,
    });

    if (!decision) {
      res.status(404).json({ error: 'No provider available for this task' });
      return;
    }

    // Get full ranking for context
    const ranking = router.rankAll(coreConfigs, task, { strategy: body.strategy });

    res.json({
      decision: {
        primary: {
          provider: decision.primary.provider.name,
          model: decision.primary.model,
          score: decision.primary.score,
          breakdown: decision.primary.breakdown as unknown as Record<string, number>,
        },
        fallbacks: decision.fallbacks.map((f) => ({
          provider: f.provider.name,
          model: f.model,
          score: f.score,
          breakdown: f.breakdown as unknown as Record<string, number>,
        })),
        classification: decision.taskClassification,
        strategy: decision.strategy,
        reasoning: decision.reasoning,
      },
      ranking: ranking.map((c) => ({
        provider: c.provider.name,
        model: c.model,
        score: c.score,
        breakdown: c.breakdown as unknown as Record<string, number>,
      })),
      health: Object.fromEntries(
        [...new Set(coreConfigs.map((c) => c.name))].map((name: string) => [
          name,
          router.health.getHealth(name),
        ]),
      ),
    });
  }));

  // Strategy learning summary
  r.get('/learning', asyncHandler(async (_req, res) => {
    const router = await getRouter(prisma);
    res.json(router.strategyLearner.getStats());
  }));

  // Provider health overview
  r.get('/health', asyncHandler(async (_req, res) => {
    const router = await getRouter(prisma);
    const entries = router.health.getEntries();
    res.json(entries);
  }));

  return r;
}
