import { Command } from 'commander';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { render } from 'ink';
import React from 'react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PORT = 4000;
const MAX_PORT = 4010;

function findAvailablePort(preferred = DEFAULT_PORT, max = MAX_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    if (preferred > max) {
      reject(new Error(`No available ports between ${DEFAULT_PORT.toString()} and ${max.toString()}`));
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

function startBundledServer(env: NodeJS.ProcessEnv) {
  const serverPath = path.resolve(__dirname, 'server.js');
  if (existsSync(serverPath)) {
    return spawn(process.execPath, [serverPath], { stdio: 'inherit', env });
  }
  return undefined;
}

async function isApiReady(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/projects`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApi(apiUrl: string, maxMs = 15000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isApiReady(apiUrl)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

async function ensureProject(apiUrl: string) {
  const cwd = process.cwd();
  const name = path.basename(cwd);

  try {
    const listRes = await fetch(`${apiUrl}/projects`);
    const projects = (await listRes.json()) as { id: string; path: string }[];
    const existing = projects.find((p) => p.path === cwd);
    if (existing) {
      console.log(`Using existing project: ${name}`);
      return;
    }

    const createRes = await fetch(`${apiUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: cwd }),
    });
    if (createRes.ok) {
      console.log(`Added project: ${name}`);
    } else {
      console.warn('Could not auto-add project:', await createRes.text());
    }
  } catch (err) {
    console.warn('Could not auto-detect project:', err);
  }
}

export const uiCmd = new Command('ui')
  .description('Open the harness web UI')
  .option('--no-tui', 'Do not open the terminal console alongside the web UI')
  .action(async (options: { tui: boolean }) => {
    const defaultApiUrl = process.env.HARNESS_API_URL ?? `http://localhost:${DEFAULT_PORT.toString()}`;
    let server: ReturnType<typeof spawn> | undefined;
    const alreadyRunning = await isApiReady(defaultApiUrl);
    const useTui = options.tui;
    let apiUrl = defaultApiUrl;

    if (!alreadyRunning) {
      const port = await findAvailablePort();
      apiUrl = `http://localhost:${port.toString()}`;
      process.env.HARNESS_API_URL = apiUrl;

      const env = { ...process.env, PORT: port.toString(), HARNESS_API_URL: apiUrl };
      server = startBundledServer(env) ??
        spawn('pnpm', ['--filter', '@omega/server', 'dev'], {
          stdio: 'inherit',
          shell: true,
          env,
        });

      server.on('exit', (code) => {
        process.exit(code ?? 0);
      });
    } else {
      console.log(`Using existing harness server on ${defaultApiUrl}`);
    }

    try {
      await waitForApi(apiUrl);
      await ensureProject(apiUrl);
      await open(apiUrl);
    } catch (err) {
      console.error(err);
      server?.kill();
      process.exit(1);
    }

    if (useTui) {
      if (!process.stdin.isTTY) {
        console.log('Terminal is not interactive; skipping TUI. Open the web UI above.');
        return;
      }
      const { TuiApp } = await import('./tui.js');
      const { waitUntilExit } = render(React.createElement(TuiApp));
      await waitUntilExit();
      if (server && !alreadyRunning) {
        server.kill();
      }
    }
  });
