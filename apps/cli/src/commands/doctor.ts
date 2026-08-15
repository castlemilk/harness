import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  defaultDatabaseDir,
  dirSizeMb,
  findDataDirs,
  portInUse,
  repoRoot,
} from '../lib/repo.js';

/**
 * `harness doctor` — check the local environment before blaming the code.
 *
 * Exists because of a real trap: `DATABASE_DIR` used to default to
 * `./pglite-data` in each package, resolving against that package's directory,
 * so `pnpm db:migrate` and `pnpm dev` operated on *different databases*. You
 * migrated, the server didn't see the tables, and nothing explained why. The
 * defaults are anchored at the repo root now; this reports any leftovers.
 */

const OK = '[32m✓[0m';
const WARN = '[33m![0m';
const BAD = '[31m✗[0m';
const DIM = '[2m';
const RESET = '[0m';
const BOLD = '[1m';

interface Finding {
  level: 'ok' | 'warn' | 'bad';
  title: string;
  detail?: string;
}

function render(findings: Finding[]): void {
  for (const f of findings) {
    const icon = f.level === 'ok' ? OK : f.level === 'warn' ? WARN : BAD;
    console.log(`${icon} ${f.title}`);
    if (f.detail) {
      for (const line of f.detail.split('\n')) console.log(`  ${DIM}${line}${RESET}`);
    }
  }
}

export const doctorCmd = new Command('doctor')
  .description('Diagnose the local dev environment')
  .option('--api-port <port>', 'API port to check', '4000')
  .action(async (options: { apiPort: string }) => {
    const root = repoRoot();
    const findings: Finding[] = [];

    console.log(`${BOLD}Omega harness doctor${RESET}`);
    console.log(`${DIM}${root}${RESET}\n`);

    // --- databases ------------------------------------------------------
    const dirs = findDataDirs(root);
    const canonical = defaultDatabaseDir(root);

    if (dirs.length === 0) {
      findings.push({
        level: 'warn',
        title: 'No database found',
        detail: `Run: task db:migrate   (creates ${path.relative(root, canonical)})`,
      });
    } else if (dirs.length === 1) {
      findings.push({
        level: 'ok',
        title: `One database: ${path.relative(root, dirs[0])} (${String(dirSizeMb(dirs[0]))} MB)`,
      });
    } else {
      // The per-package defaults now point at the root, so any others are
      // leftovers from before that fix — worth naming, since they still hold
      // data someone may want.
      const legacy = dirs.filter((d) => d !== canonical);
      findings.push({
        level: 'warn',
        title: `${String(legacy.length)} legacy database(s) alongside the canonical one`,
        detail:
          `canonical (in use): ${path.relative(root, canonical)}  (${String(dirSizeMb(canonical))} MB)\n` +
          legacy
            .map((d) => `legacy:            ${path.relative(root, d)}  (${String(dirSizeMb(d))} MB)`)
            .join('\n') +
          '\n\nThese exist because DATABASE_DIR used to resolve against each' +
          '\npackage directory, so the server and the migration addressed' +
          '\ndifferent databases. Both now default to the repo root.' +
          '\nNothing was deleted — to read an old one:' +
          `\n  DATABASE_DIR=${path.relative(root, legacy[0] ?? '')} task dev` +
          '\nOnce you are sure you do not need them, delete the legacy dirs.',
      });
    }

    // --- schema ---------------------------------------------------------
    const migrationsDir = path.join(root, 'packages/db/prisma/migrations');
    const migrations = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter((d) => !d.startsWith('.'))
      : [];
    findings.push({
      level: migrations.length > 0 ? 'ok' : 'warn',
      title: `${String(migrations.length)} migration(s) on disk`,
      detail: migrations.length > 0 ? `latest: ${migrations.sort().at(-1) ?? ''}` : undefined,
    });

    // --- ports ----------------------------------------------------------
    const apiPort = Number(options.apiPort);
    const apiBusy = await portInUse(apiPort);
    findings.push({
      level: apiBusy ? 'warn' : 'ok',
      title: apiBusy
        ? `Port ${String(apiPort)} is in use — a server is already running`
        : `Port ${String(apiPort)} is free`,
      detail: apiBusy
        ? `Confirm it is the one you want before testing against it:\n  lsof -nP -iTCP:${String(apiPort)} -sTCP:LISTEN`
        : undefined,
    });

    // --- providers ------------------------------------------------------
    const envPath = path.join(root, '.env');
    const keyNames = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'KIMI_API_KEY', 'GLM_API_KEY'];
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf-8');
      const present = keyNames.filter((k) => new RegExp(`^${k}=.+`, 'm').test(env));
      findings.push({
        level: present.length > 0 ? 'ok' : 'warn',
        title:
          present.length > 0
            ? `${String(present.length)} provider key(s) configured`
            : 'No provider keys in .env — the pulse engine cannot call a model',
        detail: present.length > 0 ? present.join(', ') : undefined,
      });
    } else {
      findings.push({
        level: 'warn',
        title: 'No .env file',
        detail: 'cp .env.example .env, then add at least one provider key.',
      });
    }

    // --- external agent CLIs --------------------------------------------
    // PTY-based CLIs (agy, opencode, cursor-cli) fail with a bare
    // "posix_spawnp failed" when node-pty's spawn-helper loses its executable
    // bit — the CLIs themselves work fine by hand, so it looks like anything
    // but what it is.
    const helpers = ptySpawnHelpers(root);
    const broken = helpers.filter((h) => !isExecutable(h));
    if (helpers.length > 0) {
      findings.push({
        level: broken.length > 0 ? 'bad' : 'ok',
        title:
          broken.length > 0
            ? `node-pty spawn-helper is not executable — every PTY-based agent CLI will fail`
            : 'node-pty spawn-helper is executable',
        detail:
          broken.length > 0
            ? `Run: node scripts/fix-node-pty.mjs\n${broken.map((b) => path.relative(root, b)).join('\n')}`
            : undefined,
      });
    }

    const clis = ['agy', 'codex', 'opencode', 'cursor-agent'];
    const present = clis.filter((c) => onPath(c));
    findings.push({
      level: present.length > 0 ? 'ok' : 'warn',
      title:
        present.length > 0
          ? `${String(present.length)} external agent CLI(s) on PATH`
          : 'No external agent CLIs on PATH — external:<cli> harnesses cannot run',
      detail: present.length > 0 ? present.join(', ') : undefined,
    });

    // --- engine ---------------------------------------------------------
    findings.push({
      level: 'ok',
      title:
        process.env.FOREMAN_ENGINE === '1'
          ? 'Pulse engine ENABLED — heartbeats will call real providers'
          : 'Pulse engine off (set FOREMAN_ENGINE=1, or task dev:engine, to enable)',
    });

    console.log('');
    render(findings);

    const bad = findings.filter((f) => f.level === 'bad').length;
    console.log('');
    if (bad > 0) {
      console.log(`${BAD} ${String(bad)} problem(s) need attention.`);
      process.exitCode = 1;
    } else {
      console.log(`${OK} Environment looks usable.`);
    }
  });

/** Every node-pty spawn-helper in the workspace. */
function ptySpawnHelpers(root: string): string[] {
  const base = path.join(root, 'node_modules', '.pnpm');
  if (!fs.existsSync(base)) return [];
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth === 0 && !e.name.startsWith('node-pty@')) continue;
        walk(full, depth + 1);
      } else if (e.name === 'spawn-helper') out.push(full);
    }
  };
  walk(base, 0);
  return out;
}

function isExecutable(file: string): boolean {
  try {
    return (fs.statSync(file).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function onPath(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
