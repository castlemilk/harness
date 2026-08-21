import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';
import { runPulse, startPulseScheduler, type PulseScheduler } from '../lib/pulse-engine.js';
import { prunePulses } from '../lib/pulse-retention.js';

/**
 * Engine control surface.
 *
 * Mounted alongside the read/write Foreman routes. Kept separate because these
 * endpoints SPEND MONEY: they are the only place in the API that causes a
 * provider call.
 */

const runSchema = z.object({
  /** Skip the provider call and record a synthetic pulse instead. */
  simulate: z.boolean().optional(),
});

let scheduler: PulseScheduler | null = null;

export function foremanEngineRoutes(prisma: PrismaClient): Router {
  const r = Router();

  /** Pulse one harness now. This is what the dashboard's manual trigger calls. */
  r.post(
    '/harnesses/:id/pulse',
    asyncHandler(async (req, res) => {
      const { simulate } = runSchema.parse(req.body ?? {});
      const result = await runPulse(prisma, req.params.id, { simulate });
      res.status(result.ran ? 200 : 202).json(result);
    }),
  );

  /** Pulse every due harness for an objective once, without the interval. */
  r.post(
    '/objectives/:id/tick',
    asyncHandler(async (req, res) => {
      const { simulate } = runSchema.parse(req.body ?? {});
      const due = await prisma.harness.findMany({
        where: {
          objectiveId: req.params.id,
          retiredAt: null,
          status: { in: ['working', 'watching', 'ready'] },
        },
        orderBy: { nextPulseAt: 'asc' },
        select: { id: true },
      });

      const results = [];
      for (const { id } of due) {
        results.push(await runPulse(prisma, id, { simulate }));
      }
      res.json({ pulsed: results.filter((x) => x.ran).length, results });
    }),
  );

  r.get('/engine', (_req, res) => {
    res.json({ running: scheduler !== null, enabledByEnv: process.env.FOREMAN_ENGINE === '1' });
  });

  /**
   * Run the retention pass now (text decay + aged ok-pulse deletion — see
   * lib/pulse-retention.ts). The scheduler runs it daily when the engine is
   * on; with the engine off nothing else ever prunes.
   */
  r.post(
    '/engine/prune',
    asyncHandler(async (_req, res) => {
      res.json(await prunePulses(prisma));
    }),
  );

  return r;
}

/** Started from index.ts only when explicitly enabled. */
export function startForemanEngine(prisma: PrismaClient): PulseScheduler | null {
  if (process.env.FOREMAN_ENGINE !== '1') return null;
  const tickMs = Number(process.env.FOREMAN_ENGINE_TICK_MS ?? 30_000);
  const concurrency = Number(process.env.FOREMAN_ENGINE_CONCURRENCY ?? 2);
  scheduler = startPulseScheduler(prisma, { tickMs, concurrency });
  console.log(
    `Foreman pulse engine started (tick ${String(tickMs)}ms, concurrency ${String(concurrency)})`,
  );
  return scheduler;
}
