import { config as dotenvConfig } from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env before any provider/database config is read.
dotenvConfig();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

import { startForemanEngine } from './routes/foreman-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 4000);
const GRPC_PORT = Number(process.env.GRPC_PORT ?? 50051);
const HOST = process.env.HOST ?? '127.0.0.1';
const WEB_DIST_DIR = process.env.WEB_DIST_DIR ?? path.resolve(__dirname, '../web');
process.env.SKILLS_DIR =
  process.env.SKILLS_DIR ?? [path.resolve(__dirname, '../../..', '.agents/skills'), path.resolve(__dirname, '../skills')].join(path.delimiter);

// PGlite recovery is FAILURE-DRIVEN in @omega/db (client.ts): the data dir is
// only snapshotted aside when `new PGlite(dir)` actually fails to init. We do
// NOT snapshot on a stale postmaster.pid here — PGlite leaves that file behind
// after any non-graceful exit, so treating it as corruption wiped the whole DB
// on every restart. A healthy dir (even with a stale lock) is opened as-is and
// PGlite recovers stale locks itself.

async function bootstrap(): Promise<void> {
  // Dynamic imports keep the @omega/db (and its transitive PGlite) module
  // graph out of the static import graph — its top-level await retry must run
  // before app.ts (which imports prisma statically) is evaluated.
  const { prisma, applyMigrations, seedDefaults } = await import('@omega/db');
  const { app } = await import('./app.js');
  const { seedSkills } = await import('./seed-skills.js');
  const { startGrpcServer } = await import('./grpc.js');
  const { getRouter, shutdownRouter } = await import('./lib/intelligent-router.js');
  const { checkThresholds } = await import('./lib/webhook-alerts.js');
  const { queue } = await import('./lib/task-queue.js');

  await applyMigrations();
  await seedDefaults();
  await seedSkills();

  // Recover orphaned tasks stuck in_progress from a previous crash
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes
  const orphaned = await prisma.task.updateMany({
    where: { status: 'in_progress', updatedAt: { lt: staleThreshold } },
    data: { status: 'failed', error: 'Orphaned: server restarted while task was in progress' },
  });
  if (orphaned.count > 0) {
    console.log(`Recovered ${String(orphaned.count)} orphaned in_progress task(s)`);
  }

  console.log(`Task queue concurrency: ${String(queue.status().maxConcurrency)}`);

  app.use(express.static(WEB_DIST_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(WEB_DIST_DIR, 'index.html'));
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`Omega harness server on http://${HOST}:${PORT.toString()}`);
    console.log(`Serving web UI from ${WEB_DIST_DIR}`);
  });

  const foremanEngine = startForemanEngine(prisma);

  const grpcServer = startGrpcServer(prisma, GRPC_PORT, HOST);

  // Initialize router (handles its own periodic persistence)
  const router = await getRouter(prisma);

  // Periodic threshold alerting (separate from router persistence)
  const alertInterval = setInterval(() => {
    void checkThresholds(prisma, router);
  }, 5 * 60 * 1000);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down…`);
    clearInterval(alertInterval);
    foremanEngine?.stop();

    const status = queue.status();
    console.log(`Queue: ${String(status.active)} active, ${String(status.queued)} queued`);

    // Shutdown router (persists state, clears intervals)
    await shutdownRouter();

    // Close servers
    server.close();
    grpcServer.forceShutdown();

    await queue.drain();

    console.log('Queue drained, closing database');
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
