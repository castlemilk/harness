import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';
import { fetchTempoTrace, getHotspots, observabilityStatus } from '../lib/observability.js';

/**
 * Observability surface for the local trace pipeline:
 * - `/status`        — is tracing on, are Tempo/Mimir reachable
 * - `/hotspots`      — top service/operation pairs by p95 latency from spanmetrics
 * - `/traces/:id`    — normalized spans for one distributed trace
 */
export function observabilityRoutes(): Router {
  const r = Router();

  r.get('/status', asyncHandler(async (_req, res) => {
    res.json(await observabilityStatus());
  }));

  r.get('/hotspots', asyncHandler(async (req, res) => {
    const query = z.object({
      window: z.string().max(10).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).parse(req.query);
    res.json(await getHotspots({ window: query.window, limit: query.limit }));
  }));

  r.get('/traces/:traceId', asyncHandler(async (req, res) => {
    const trace = await fetchTempoTrace(req.params.traceId);
    if (!trace) {
      res.status(404).json({
        error: 'Trace not found (unknown trace id or Tempo unreachable)',
        tempoUrl: process.env.TEMPO_QUERY_URL ?? 'http://127.0.0.1:13200',
      });
      return;
    }
    res.json(trace);
  }));

  return r;
}
