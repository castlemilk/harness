import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';

const providerKinds = z.enum(['openai', 'anthropic', 'ollama', 'gemini', 'kimi', 'generic']);

const createSchema = z.object({
  name: z.string().min(1),
  kind: providerKinds,
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.number().optional(),
  defaultModel: z.string().min(1),
  capabilities: z.union([z.string(), z.array(z.any())]).optional(),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  kind: providerKinds.optional(),
  baseUrl: z.string().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  refreshToken: z.string().optional().nullable(),
  tokenExpiresAt: z.number().optional().nullable(),
  defaultModel: z.string().min(1).optional(),
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

function sanitizeProvider(provider: {
  apiKey?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  [key: string]: unknown;
}) {
  const { apiKey, refreshToken, tokenExpiresAt, ...rest } = provider;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    hasRefreshToken: Boolean(refreshToken),
    tokenExpiresAt: tokenExpiresAt ?? undefined,
  };
}

export function providerRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', asyncHandler(async (_req, res) => {
    const providers = await prisma.providerConfig.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(providers.map(sanitizeProvider));
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const provider = await prisma.providerConfig.create({
      data: {
        name: body.name,
        kind: body.kind,
        defaultModel: body.defaultModel,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        refreshToken: body.refreshToken,
        tokenExpiresAt: body.tokenExpiresAt !== undefined ? new Date(body.tokenExpiresAt) : undefined,
        capabilities: normalizeCapabilities(body.capabilities),
        enabled: body.enabled ?? true,
      },
    });
    res.status(201).json(sanitizeProvider(provider));
  }));

  r.patch('/:id/toggle', asyncHandler(async (req, res) => {
    const existing = await prisma.providerConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    const provider = await prisma.providerConfig.update({
      where: { id: req.params.id },
      data: { enabled: !existing.enabled },
    });
    res.json(sanitizeProvider(provider));
  }));

  r.patch('/:id', asyncHandler(async (req, res) => {
    const existing = await prisma.providerConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    const body = updateSchema.parse(req.body);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl;
    if (body.apiKey !== undefined) data.apiKey = body.apiKey;
    if (body.refreshToken !== undefined) data.refreshToken = body.refreshToken;
    if (body.tokenExpiresAt !== undefined) data.tokenExpiresAt = body.tokenExpiresAt !== null ? new Date(body.tokenExpiresAt) : null;
    if (body.defaultModel !== undefined) data.defaultModel = body.defaultModel;
    if (body.capabilities !== undefined) data.capabilities = normalizeCapabilities(body.capabilities);
    if (body.enabled !== undefined) data.enabled = body.enabled;
    const provider = await prisma.providerConfig.update({
      where: { id: req.params.id },
      data,
    });
    res.json(sanitizeProvider(provider));
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    await prisma.providerConfig.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  return r;
}
