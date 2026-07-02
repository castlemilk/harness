import { Command } from 'commander';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { render } from 'ink';
import React from 'react';
import { TuiApp } from './tui.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API = process.env.HARNESS_API_URL ?? 'http://localhost:4000';

function startBundledServer() {
  const serverPath = path.resolve(__dirname, 'server.js');
  if (existsSync(serverPath)) {
    return spawn(process.execPath, [serverPath], { stdio: 'inherit' });
  }
  return undefined;
}

async function isApiReady(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/projects`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApi(maxMs = 15000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isApiReady()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

async function ensureProject() {
  const cwd = process.cwd();
  const name = path.basename(cwd);

  try {
    const listRes = await fetch(`${API}/projects`);
    const projects = (await listRes.json()) as { id: string; path: string }[];
    const existing = projects.find((p) => p.path === cwd);
    if (existing) {
      console.log(`Using existing project: ${name}`);
      return;
    }

    const createRes = await fetch(`${API}/projects`, {
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
    let server = undefined;
    const alreadyRunning = await isApiReady();
    const useTui = options.tui;

    if (!alreadyRunning) {
      server = startBundledServer() ??
        spawn('pnpm', ['--filter', '@omega/server', 'dev'], {
          stdio: 'inherit',
          shell: true,
        });

      server.on('exit', (code) => {
        process.exit(code ?? 0);
      });
    } else {
      console.log('Using existing harness server on port 4000');
    }

    try {
      await waitForApi();
      await ensureProject();
      await open(API);
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
      const { waitUntilExit } = render(React.createElement(TuiApp));
      await waitUntilExit();
      if (server && !alreadyRunning) {
        server.kill();
      }
    }
  });
