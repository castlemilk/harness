import { app } from './app.js';
import { prisma, applyMigrations, seedDefaults } from '@omega/db';
import { startGrpcServer } from './grpc.js';

const PORT = Number(process.env.PORT ?? 4000);
const GRPC_PORT = Number(process.env.GRPC_PORT ?? 50051);

async function bootstrap(): Promise<void> {
  await applyMigrations();
  await seedDefaults();

  app.listen(PORT, () => {
    console.log(`Omega harness server on http://localhost:${PORT.toString()}`);
  });

  startGrpcServer(prisma, GRPC_PORT);
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

