import { Command } from 'commander';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import open from 'open';
import {
  defaultDatabaseDir,
  defaultDatabaseUrl,
  firstFreePort,
  portInUse,
  repoRoot,
  waitForHttp,
} from '../lib/repo.js';

/**
 * `harness dev` — the local development supervisor.
 *
 * `pnpm dev` backgrounds the server with `&`, which means it never migrates the
 * database, never waits for the API before starting the web app, interleaves
 * two streams of unlabelled output, and orphans the server when you Ctrl-C.
 * This command fixes all four, and pins one database so migrating and serving
 * agree on which one they mean.
 */

const COLORS: Record<string, string> = {
  server: '[36m', // cyan
  web: '[35m', // magenta
  db: '[33m', // yellow
};
const DIM = '[2m';
const RESET = '[0m';
const BOLD = '[1m';

function prefixed(label: string, child: ChildProcess): void {
  const colour = COLORS[label] ?? '';
  const tag = `${colour}${label.padEnd(6)}${RESET} ${DIM}│${RESET} `;
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    readline.createInterface({ input: stream }).on('line', (line) => {
      process.stdout.write(`${tag}${line}\n`);
    });
  }
}

function run(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  prefixed(label, child);
  return child;
}

export const devCmd = new Command('dev')
  .description('Run the API and web app locally against one database')
  .option('--api-port <port>', 'API port', '4000')
  .option('--web-port <port>', 'Web dev-server port', '5173')
  .option('--no-open', 'Do not open a browser')
  .option('--no-migrate', 'Skip the migration step')
  .option('--engine', 'Also run the Foreman pulse engine (makes real provider calls)')
  .option('--seed <kind>', 'Seed before starting: demo | e2e')
  .action(
    async (options: {
      apiPort: string;
      webPort: string;
      open: boolean;
      migrate: boolean;
      engine?: boolean;
      seed?: string;
    }) => {
      const root = repoRoot();
      const databaseDir = defaultDatabaseDir(root);
      const databaseUrl = defaultDatabaseUrl();

      const requestedApi = Number(options.apiPort);
      const requestedWeb = Number(options.webPort);

      // A stale process squatting the port would otherwise serve old code and
      // make everything look like it works.
      if (await portInUse(requestedApi)) {
        console.error(
          `${BOLD}Port ${String(requestedApi)} is already in use.${RESET}\n` +
            `Something is already listening there — stop it, or pass --api-port.\n` +
            `  lsof -nP -iTCP:${String(requestedApi)} -sTCP:LISTEN`,
        );
        process.exit(1);
      }
      const webPort = await firstFreePort(requestedWeb);
      // The server also binds gRPC; without its own free port a second dev
      // instance dies on EADDRINUSE even though the API port was free.
      const grpcPort = await firstFreePort(50051);
      if (webPort !== requestedWeb) {
        console.log(`${DIM}Web port ${String(requestedWeb)} busy; using ${String(webPort)}.${RESET}`);
      }

      const apiUrl = `http://localhost:${String(requestedApi)}`;
      const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_DIR: databaseDir,
      };

      console.log(`${BOLD}Omega harness dev${RESET}`);
      console.log(`${DIM}  database  ${databaseDir}${RESET}`);
      console.log(`${DIM}  api       ${apiUrl}${RESET}`);
      console.log(`${DIM}  web       http://localhost:${String(webPort)}${RESET}`);
      if (options.engine) {
        console.log(
          `${COLORS.db}  engine    ON — pulses will call real providers and spend money${RESET}`,
        );
      }
      console.log('');

      const children: ChildProcess[] = [];
      let shuttingDown = false;

      const shutdown = (code: number): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        for (const child of children) {
          // SIGTERM lets the server drain its queue and close the database.
          if (!child.killed) child.kill('SIGTERM');
        }
        setTimeout(() => {
          for (const child of children) if (!child.killed) child.kill('SIGKILL');
          process.exit(code);
        }, 3000).unref();
      };

      process.on('SIGINT', () => { shutdown(0); });
      process.on('SIGTERM', () => { shutdown(0); });

      // --- migrate ------------------------------------------------------
      if (options.migrate) {
        const ok = await new Promise<boolean>((resolve) => {
          const migrate = run(
            'db',
            'node',
            ['--import', 'tsx', 'src/migrate.ts'],
            `${root}/packages/db`,
            baseEnv,
          );
          migrate.on('exit', (code) => { resolve(code === 0); });
        });
        if (!ok) {
          console.error('Migration failed; not starting the server.');
          process.exit(1);
        }
      }

      // --- seed ---------------------------------------------------------
      if (options.seed) {
        const script =
          options.seed === 'e2e' ? '../../scripts/seed-foreman-e2e.ts' : 'src/seed.ts';
        const ok = await new Promise<boolean>((resolve) => {
          const seed = run('db', 'node', ['--import', 'tsx', script], `${root}/packages/db`, baseEnv);
          seed.on('exit', (code) => { resolve(code === 0); });
        });
        if (!ok) console.error('Seed failed; continuing with whatever is already there.');
      }

      // --- server -------------------------------------------------------
      const server = run(
        'server',
        'node',
        ['--import', 'tsx', 'src/index.ts'],
        `${root}/apps/server`,
        {
          ...baseEnv,
          PORT: String(requestedApi),
          GRPC_PORT: String(grpcPort),
          // Tell the API which web origin to expect, since the port floats.
          CORS_ORIGINS: `http://localhost:${String(webPort)},http://127.0.0.1:${String(webPort)}`,
          FOREMAN_ENGINE: options.engine ? '1' : '0',
        },
      );
      children.push(server);
      server.on('exit', (code) => {
        if (!shuttingDown) {
          console.error(`\nServer exited (${String(code)}). Shutting down.`);
          shutdown(code ?? 1);
        }
      });

      // The web app is useless before the API answers, so wait rather than
      // racing and showing the user a wall of failed requests.
      const ready = await waitForHttp(`${apiUrl}/projects`);
      if (!ready) {
        console.error('API did not become ready in time.');
        shutdown(1);
        return;
      }

      // --- web ----------------------------------------------------------
      const web = run(
        'web',
        'node',
        ['node_modules/vite/bin/vite.js', '--port', String(webPort), '--strictPort'],
        `${root}/apps/web`,
        { ...baseEnv, VITE_API_URL: apiUrl },
      );
      children.push(web);
      web.on('exit', (code) => {
        if (!shuttingDown) {
          console.error(`\nWeb dev server exited (${String(code)}). Shutting down.`);
          shutdown(code ?? 1);
        }
      });

      const webUrl = `http://localhost:${String(webPort)}`;
      if (await waitForHttp(webUrl, 30_000)) {
        // Four lines, and each one answers a question a first run actually
        // asks. The Plugins line is here rather than in the docs because the
        // tab is the answer to "what did this build ship, and is its backend
        // up" — and nobody reads a doc while the app is already open.
        console.log(`\n${BOLD}Ready${RESET} → ${webUrl}   ${DIM}(Ctrl-C to stop both)${RESET}`);
        console.log(
          `${DIM}  Objectives   ${
            options.seed
              ? 'seeded — pick one from the switcher in the top bar'
              : 'none seeded — run `task db:seed:e2e`, or `task dev:seed`'
          }${RESET}`,
        );
        console.log(`${DIM}  Plugins tab  shows the installed use-case shells and their health${RESET}`);
        console.log(`${DIM}  Trouble?     task doctor${RESET}\n`);
        if (options.open) await open(webUrl);
      }
    },
  );
