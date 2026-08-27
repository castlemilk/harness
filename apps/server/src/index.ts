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

  // Tool execution is a browser button that runs shell commands here. On a
  // loopback bind that is a local-trust decision; on any other bind it is a
  // remote shell for whoever can reach the port. Say so at startup.
  const { remoteExposureWarning } = await import('./lib/tool-runner.js');
  const exposure = remoteExposureWarning(process.env, HOST);
  if (exposure !== null) console.warn(exposure);

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

  // Graceful shutdown gets this long before the watchdog forces the exit.
  // Tunable because a deployment with genuinely slow cleanup (large state
  // persistence, long DB flush) may want more; the default only has to cover
  // the steps above, not a drain of in-flight tasks (see below).
  const FORCE_EXIT_MS = Number(process.env.OMEGA_SHUTDOWN_FORCE_MS ?? 10_000);

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down…`);
    const forceExit = setTimeout(() => {
      console.error(`Graceful shutdown exceeded ${String(FORCE_EXIT_MS)}ms — forcing exit`);
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceExit.unref();

    let exitCode = 0;
    try {
      clearInterval(alertInterval);
      foremanEngine?.stop();

      const status = queue.status();
      console.log(`Queue: ${String(status.active)} active, ${String(status.queued)} queued`);

      // Shutdown router (persists state, clears intervals)
      await shutdownRouter();

      // Close servers. closeAllConnections() matters as much as close():
      // close() only stops new connections, so keep-alive sockets and live
      // SSE streams (which hold their own poll intervals) would keep the
      // event loop busy until their clients go away.
      server.close();
      server.closeAllConnections();
      grpcServer.forceShutdown();

      // Drain what is running, within the watchdog's budget — NOT forever.
      // An in-flight task can sit in 30/60/90s provider backoff retries for
      // minutes; waiting for it meant SIGTERM was logged and process.exit
      // was never reached, which is precisely the zombie server (port held,
      // CPU pegged) that e2e timeout runs used to leave behind. Bootstrap's
      // orphan recovery marks such tasks failed on the next start.
      await queue.drain();
    } catch (err) {
      console.error('Shutdown step failed:', err);
      exitCode = 1;
    }

    try {
      console.log('Queue drained, closing database');
      await prisma.$disconnect();
    } catch (err) {
      // The database is being torn down with the process; a failed
      // disconnect must not stop the exit that is already overdue.
      console.error('Database disconnect failed:', err);
    }
    process.exit(exitCode);
  };

  const onSignal = (signal: string): void => {
    // A second signal is someone insisting. Exit now, mid-cleanup.
    if (shuttingDown) {
      console.error(`${signal} during shutdown — forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    void shutdown(signal);
  };
  process.on('SIGTERM', () => { onSignal('SIGTERM'); });
  process.on('SIGINT', () => { onSignal('SIGINT'); });
}
bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
