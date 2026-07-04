import { spawn } from 'child_process';
import { existsSync } from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_PORT = 4000;
export const MAX_PORT = 4010;
export const DEFAULT_GRPC_PORT = 50051;
export const MAX_GRPC_PORT = 50061;

export function findAvailablePort(preferred = DEFAULT_PORT, max = MAX_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    if (preferred > max) {
      reject(new Error(`No available ports between ${preferred.toString()} and ${max.toString()}`));
      return;
    }

    const tester = net.createServer();
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        findAvailablePort(preferred + 1, max).then(resolve, reject);
      } else {
        reject(err);
      }
    });
    tester.once('listening', () => {
      const address = tester.address();
      const port = typeof address === 'object' && address ? address.port : preferred;
      tester.close(() => {
        resolve(port);
      });
    });
    tester.listen(preferred);
  });
}

export function startBundledServer(env: NodeJS.ProcessEnv) {
  const realServerPath = path.resolve(__dirname, '../../server/dist/index.js');
  if (existsSync(realServerPath)) {
    return spawn(process.execPath, [realServerPath], { stdio: 'inherit', env });
  }
  const legacyServerPath = path.resolve(__dirname, '../../server.js');
  if (existsSync(legacyServerPath)) {
    return spawn(process.execPath, [legacyServerPath], { stdio: 'inherit', env });
  }
  return undefined;
}

export async function isApiReady(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/projects`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForApi(apiUrl: string, maxMs = 30000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isApiReady(apiUrl)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

export async function startHarnessServer(
  env: NodeJS.ProcessEnv,
  options: { preferredPort?: number; preferredGrpcPort?: number } = {}
): Promise<{ process: ReturnType<typeof spawn>; apiUrl: string; port: number; grpcPort: number }> {
  const port = await findAvailablePort(options.preferredPort ?? DEFAULT_PORT, MAX_PORT);
  const grpcPort = await findAvailablePort(options.preferredGrpcPort ?? DEFAULT_GRPC_PORT, MAX_GRPC_PORT);
  const apiUrl = `http://localhost:${port.toString()}`;

  const serverEnv = {
    ...env,
    PORT: port.toString(),
    GRPC_PORT: grpcPort.toString(),
    HARNESS_API_URL: apiUrl,
  };

  const server =
    startBundledServer(serverEnv) ??
    spawn('pnpm', ['--filter', '@omega/server', 'dev'], {
      stdio: 'inherit',
      shell: true,
      env: serverEnv,
    });

  await waitForApi(apiUrl);
  return { process: server, apiUrl, port, grpcPort };
}
