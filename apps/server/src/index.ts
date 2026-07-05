import { config as dotenvConfig } from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from './app.js';
import { prisma, applyMigrations, seedDefaults } from '@omega/db';
import { startGrpcServer } from './grpc.js';

// Load .env before any provider/database config is read.
dotenvConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 4000);
const GRPC_PORT = Number(process.env.GRPC_PORT ?? 50051);
const WEB_DIST_DIR = process.env.WEB_DIST_DIR ?? path.resolve(__dirname, '../web');

async function bootstrap(): Promise<void> {
  await applyMigrations();
  await seedDefaults();

  app.use(express.static(WEB_DIST_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(WEB_DIST_DIR, 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Omega harness server on http://localhost:${PORT.toString()}`);
    console.log(`Serving web UI from ${WEB_DIST_DIR}`);
  });

  startGrpcServer(prisma, GRPC_PORT);
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

