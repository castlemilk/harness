import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';
import { OllamaProvider } from '@omega/providers';
import type { ProviderConfig } from '@omega/core';

const localModelConfigSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().default('http://127.0.0.1:11435'),
  model: z.string().min(1),
  cacheMode: z.enum(['cold', 'warm-prefix', 'warm-ngram']).default('cold'),
  warmupRuns: z.number().int().min(0).max(10).default(0),
  contextTokens: z.number().int().positive().optional(),
  keepAlive: z.string().default('30m'),
  proxyEnabled: z.boolean().default(true),
  tokenHorizonUrl: z.string().default('http://127.0.0.1:8765'),
});

export interface LocalModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  cacheMode: 'cold' | 'warm-prefix' | 'warm-ngram';
  warmupRuns: number;
  contextTokens?: number;
  keepAlive: string;
  proxyEnabled: boolean;
  tokenHorizonUrl: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalModelMetrics {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptDurationS?: number;
  generationDurationS?: number;
  ngramCacheHitRate?: number;
  lastRunAt?: string;
  runCount: number;
}

export function localModelRoutes(prisma: PrismaClient): Router {
  const r = Router();

  // List discovered Ollama models
  r.get('/discover', asyncHandler(async (req, res) => {
    const baseUrl = typeof req.query.baseUrl === 'string' ? req.query.baseUrl : 'http://127.0.0.1:11435';
    const provider = new OllamaProvider({
      id: 'discover',
      name: 'discover',
      kind: 'ollama',
      baseUrl,
      defaultModel: '',
      capabilities: [],
      enabled: true,
    });
    try {
      const models = await provider.listModels();
      const detailed = await Promise.all(
        models.map(async (name) => {
          try {
            const res = await fetch(`${baseUrl}/api/show`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name }),
            });
            if (!res.ok) return { name };
            const data = (await res.json()) as Record<string, unknown>;
            return { name, ...data };
          } catch {
            return { name };
          }
        })
      );
      res.json({ models: detailed });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  // List configured local models
  r.get('/', asyncHandler(async (_req, res) => {
    const models = await prisma.localModelConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(models);
  }));

  // Create or update a local model configuration
  r.post('/', asyncHandler(async (req, res) => {
    const body = localModelConfigSchema.parse(req.body);
    const existing = await prisma.localModelConfig.findFirst({
      where: { name: body.name },
    });
    if (existing) {
      const updated = await prisma.localModelConfig.update({
        where: { id: existing.id },
        data: body,
      });
      res.json(updated);
      return;
    }
    const created = await prisma.localModelConfig.create({
      data: body,
    });
    res.status(201).json(created);
  }));

  // Get a specific local model
  r.get('/:id', asyncHandler(async (req, res) => {
    const model = await prisma.localModelConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }
    res.json(model);
  }));

  // Delete a local model configuration
  r.delete('/:id', asyncHandler(async (req, res) => {
    await prisma.localModelConfig.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  // Launch a model through the proxy with metrics
  r.post('/:id/launch', asyncHandler(async (req, res) => {
    const model = await prisma.localModelConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    // Build provider config with proxy routing
    const baseUrl = model.proxyEnabled
      ? model.baseUrl // Already pointed at proxy (e.g. 11435)
      : model.baseUrl.replace('11435', '11434'); // Direct Ollama

    const providerConfig: ProviderConfig = {
      id: model.id,
      name: model.name,
      kind: 'ollama',
      baseUrl,
      defaultModel: model.model,
      capabilities: [],
      enabled: true,
      defaultCacheMode: model.cacheMode as 'cold' | 'warm-prefix' | 'warm-ngram',
      defaultWarmupRuns: model.warmupRuns > 0 ? model.warmupRuns : undefined,
      defaultContextTokens: model.contextTokens ?? undefined,
    };

    const provider = new OllamaProvider(providerConfig);

    // Send a minimal probe to verify the model is reachable
    const started = Date.now();
    try {
      const result = await provider.send('Reply with exactly: ok', {
        cacheMode: model.cacheMode as 'cold' | 'warm-prefix' | 'warm-ngram',
        warmupRuns: model.warmupRuns > 0 ? model.warmupRuns : undefined,
        contextTokens: model.contextTokens ?? 4096,
        keepAlive: model.keepAlive,
        timeoutMs: 300_000,
      });

      // Collect metrics from Token Horizon if proxy is enabled
      let horizonMetrics: Record<string, unknown> | null = null;
      if (model.proxyEnabled) {
        try {
          const healthRes = await fetch(`${model.tokenHorizonUrl}/health`, {
            signal: AbortSignal.timeout(3000),
          });
          if (healthRes.ok) {
            horizonMetrics = (await healthRes.json()) as Record<string, unknown>;
          }
        } catch {
          // Token Horizon not reachable; metrics unavailable
        }
      }

      res.json({
        ok: true,
        model: model.model,
        result: result.slice(0, 200),
        durationMs: Date.now() - started,
        proxyEnabled: model.proxyEnabled,
        tokenHorizon: horizonMetrics,
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        model: model.model,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
    }
  }));

  // Get metrics for a local model
  r.get('/:id/metrics', asyncHandler(async (req, res) => {
    const model = await prisma.localModelConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    // Fetch metrics from Token Horizon proxy if enabled
    let horizonMetrics: Record<string, unknown> | null = null;
    if (model.proxyEnabled) {
      try {
        const metricsRes = await fetch(`${model.tokenHorizonUrl}/metrics`, {
          signal: AbortSignal.timeout(5000),
        });
        if (metricsRes.ok) {
          const text = await metricsRes.text();
          // Parse Prometheus text format for Ollama metrics
          const lines = text.split('\n');
          const ollamaLines = lines.filter((line) =>
            line.includes('token_horizon_ollama') && line.includes(model.model)
          );
          horizonMetrics = { raw: ollamaLines };
        }
      } catch {
        // Token Horizon not reachable
      }
    }

    // Get recent benchmark runs for this model
    const recentRuns = await prisma.agentRun.findMany({
      where: {
        effectiveModel: model.model,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        resultStatus: true,
        totalTokens: true,
        promptTokens: true,
        completionTokens: true,
        createdAt: true,
      },
    });

    const metrics: LocalModelMetrics = {
      model: model.model,
      promptTokens: recentRuns.reduce((acc, r) => acc + (r.promptTokens ?? 0), 0),
      completionTokens: recentRuns.reduce((acc, r) => acc + (r.completionTokens ?? 0), 0),
      totalTokens: recentRuns.reduce((acc, r) => acc + (r.totalTokens ?? 0), 0),
      runCount: recentRuns.length,
      lastRunAt: recentRuns[0]?.createdAt.toISOString(),
    };

    res.json({
      model,
      metrics,
      tokenHorizon: horizonMetrics,
      recentRuns,
    });
  }));

  return r;
}
