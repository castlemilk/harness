import { config as dotenvConfig } from 'dotenv';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Boots the harness HTTP API inside the current process on an ephemeral
 * loopback port.
 *
 * This is what makes `harness mcp --standalone` work: the MCP tool handlers
 * call back into the `/v1` API over `HarnessApiClient`, so instead of
 * requiring a separately-launched harness server, the same express app is
 * mounted here and its resolved URL handed back to the caller.
 *
 * Deliberately narrower than `index.ts`: no gRPC server, no task queue, no
 * flow-sync loop. Those own background work that belongs to a long-running
 * server, and running them would double-start in a client-spawned process.
 */

export interface EmbeddedApiOptions {
  /** Loopback by default; binding a public interface is almost never wanted. */
  host?: string;
  /** 0 (default) asks the OS for a free port, so concurrent servers never clash. */
  port?: number;
  /** Run pending migrations before serving. */
  migrate?: boolean;
  /** Seed default providers/skills. */
  seed?: boolean;
}

export interface EmbeddedApi {
  baseUrl: string;
  port: number;
  close: () => Promise<void>;
}

export async function startEmbeddedApi(options: EmbeddedApiOptions = {}): Promise<EmbeddedApi> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;

  // Load .env before the database layer reads configuration. Mirrors index.ts.
  dotenvConfig();

  // @omega/db is imported dynamically and first: its top-level-await retry has
  // to run before app.js is evaluated, because app.ts imports prisma statically.
  const { applyMigrations, seedDefaults } = await import('@omega/db');
  const { app } = await import('./app.js');

  if (options.migrate !== false) {
    await applyMigrations();
  }
  if (options.seed !== false) {
    await seedDefaults();
  }

  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(port, host, () => {
      resolve(listener);
    });
    listener.once('error', reject);
  });

  const address = server.address() as AddressInfo | null;
  if (address === null) {
    server.close();
    throw new Error('embedded API server started without a bound address');
  }

  // 0.0.0.0 must be dialled back as loopback, otherwise the client would try to
  // reach a non-routable address.
  const dialHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

  return {
    baseUrl: `http://${dialHost}:${String(address.port)}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}