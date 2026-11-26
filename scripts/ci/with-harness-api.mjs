import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));

function start(command, args, options) {
  const child = spawn(command, args, options);
  let result;
  const exited = new Promise((resolve) => {
    const finish = (value) => { result = value; resolve(value); };
    child.once('error', (error) => finish({ code: 1, error }));
    child.once('exit', (code, signal) => finish({ code, signal }));
  });
  return { child, exited, result: () => result };
}

async function exitedWithin(process, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      process.exited.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function stop(process, timeoutMs) {
  if (!process || process.result()) return Promise.resolve();
  process.stopping ??= (async () => {
    process.child.kill('SIGTERM');
    if (await exitedWithin(process, timeoutMs)) return;
    process.child.kill('SIGKILL');
    if (await exitedWithin(process, 2000)) return;
    process.child.unref();
    throw new Error('Owned child did not exit after SIGKILL');
  })();
  return process.stopping;
}

async function requireFreePort(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => { probe.close(resolve); });
  });
}

export async function withHarnessApi(command, args, options = {}) {
  const env = options.env ?? process.env;
  if (!command) throw new Error('A benchmark command is required');
  if (!env.OMEGA_STORAGE_ROOT?.trim()) throw new Error('OMEGA_STORAGE_ROOT must identify isolated CI storage');
  const storage = path.resolve(env.OMEGA_STORAGE_ROOT);
  const api = new URL(env.HARNESS_API_URL ?? 'http://127.0.0.1:4000');
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || !api.port || api.pathname !== '/') {
    throw new Error('HARNESS_API_URL must be an HTTP loopback URL with an explicit port');
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  const stopTimeoutMs = options.stopTimeoutMs ?? 10_000;
  await requireFreePort(Number(api.port));
  const cwd = options.cwd ?? root;
  const log = fs.openSync(options.logPath ?? path.join(cwd, 'harness-api-output.txt'), 'a');
  let server;
  try {
    server = start(process.execPath, [options.serverEntry ?? path.join(root, 'apps/server/dist/index.js')], {
      cwd,
      env: {
        ...env,
        HOST: '127.0.0.1',
        PORT: api.port,
        GRPC_PORT: env.GRPC_PORT ?? '50051',
        DATABASE_DIR: path.join(storage, 'server-db'),
        FOREMAN_ENGINE: '0',
      },
      stdio: ['ignore', log, log],
    });
  } finally {
    fs.closeSync(log);
  }
  let benchmark;
  let commandTimer;
  let interrupted;
  const onSignal = (signal) => {
    interrupted = signal;
    void stop(benchmark ?? server, stopTimeoutMs).catch((error) => { console.error(error); });
  };
  const onTerm = () => { onSignal('SIGTERM'); };
  const onInt = () => { onSignal('SIGINT'); };
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  const execute = async () => {
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      if (interrupted) return interrupted === 'SIGINT' ? 130 : 143;
      if (server.result()) throw new Error(`Harness API exited before readiness; see harness-api-output.txt (${server.result().error?.message ?? server.result().code})`);
      try {
        const response = await fetch(new URL('/projects', api), { signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))) });
        if (response.ok && Array.isArray(await response.json())) { ready = true; break; }
      } catch { /* The server is still bootstrapping. */ }
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
    if (!ready) throw new Error(`Harness API was not ready within ${timeoutMs}ms; see harness-api-output.txt`);
    if (server.result()) throw new Error('Harness API exited at readiness');
    benchmark = start(command, args, {
      cwd,
      env: { ...env, DATABASE_DIR: path.join(storage, 'cli-db') },
      stdio: options.commandStdio ?? 'inherit',
    });
    const completion = [
      benchmark.exited,
      server.exited.then(() => { throw new Error('Harness API exited while the benchmark command was running'); }),
    ];
    if (options.commandTimeoutMs) completion.push(new Promise((_, reject) => {
      commandTimer = setTimeout(() => reject(new Error('Benchmark command exceeded its deadline')), options.commandTimeoutMs);
    }));
    const result = await Promise.race(completion);
    if (interrupted) return interrupted === 'SIGINT' ? 130 : 143;
    if (result.error) throw result.error;
    return result.code ?? 1;
  };
  let outcome;
  let cleanupFailure;
  try {
    outcome = { code: await execute() };
  } catch (error) {
    outcome = { error };
  } finally {
    clearTimeout(commandTimer);
    const cleanup = await Promise.allSettled([stop(benchmark, stopTimeoutMs), stop(server, stopTimeoutMs)]);
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
    cleanupFailure = cleanup.find((result) => result.status === 'rejected');
  }
  if ('error' in outcome) {
    if (cleanupFailure) console.error('Cleanup also failed:', cleanupFailure.reason);
    throw outcome.error;
  }
  if (cleanupFailure) throw cleanupFailure.reason;
  return outcome.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await withHarnessApi(process.argv[2], process.argv.slice(3));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
