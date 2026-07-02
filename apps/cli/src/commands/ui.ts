import { Command } from 'commander';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function startBundledServer() {
  const serverPath = path.resolve(__dirname, 'server.js');
  if (existsSync(serverPath)) {
    return spawn(process.execPath, [serverPath], { stdio: 'inherit' });
  }
  return undefined;
}

export const uiCmd = new Command('ui')
  .description('Open the harness web UI')
  .action(async () => {
    const server = startBundledServer() ??
      spawn('pnpm', ['--filter', '@omega/server', 'dev'], {
        stdio: 'inherit',
        shell: true,
      });

    setTimeout(async () => {
      await open('http://localhost:4000');
    }, 2500);

    server.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  });
