import { Command } from 'commander';
import { spawn } from 'child_process';
import open from 'open';

export const uiCmd = new Command('ui')
  .description('Open the harness web UI')
  .action(async () => {
    const server = spawn('pnpm', ['--filter', '@omega/server', 'dev'], {
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
