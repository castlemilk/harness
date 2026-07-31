import { config as dotenvConfig } from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from './app.js';
import { prisma, applyMigrations, seedDefaults } from '@omega/db';
import { seedSkills } from './seed-skills.js';
import { startGrpcServer } from './grpc.js';
import { queue } from './lib/task-queue.js';
import { getRouter, shutdownRouter } from './lib/intelligent-router.js';
import { checkThresholds } from './lib/webhook-alerts.js';

// Load .env before any provider/database config is read.
dotenvConfig();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 4000);
const GRPC_PORT = Number(process.env.GRPC_PORT ?? 50051);
const HOST = process.env.HOST ?? '127.0.0.1';
const WEB_DIST_DIR = process.env.WEB_DIST_DIR ?? path.resolve(__dirname, '../web');
process.env.SKILLS_DIR = process.env.SKILLS_DIR ?? path.resolve(__dirname, '../skills');

async function bootstrap(): Promise<void> {
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
