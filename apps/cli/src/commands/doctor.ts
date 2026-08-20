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
import {
  isOutOfTree,
  pluginPackage,
  pluginSourcesOnDisk,
  probeUrl,
  reachable,
  resolvePlugins,
} from '../lib/plugins.js';

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

    // --- stale builds ----------------------------------------------------
    // Workspace packages resolve through their `dist/`, so editing `src` has no
    // effect on a running server until the package is rebuilt. Silent, and it
    // looks exactly like your change not working.
    const stale = stalePackages(root);
    findings.push({
      level: stale.length > 0 ? 'warn' : 'ok',
      title:
        stale.length > 0
          ? `${String(stale.length)} package(s) have source newer than their build`
          : 'Package builds are up to date with their sources',
      detail:
        stale.length > 0
          ? `The server loads dist/, so these changes are NOT live:\n${stale.join('\n')}\n` +
            `Rebuild: pnpm --filter ${stale[0]} build   (or task build)`
          : undefined,
    });

    // --- use-case plugins -------------------------------------------------
    // Two failures this catches before they look like the app being broken: a
    // configured plugin that is not on disk (the harness cloned without the
    // omega repo beside it), and a plugin backend that isn't running (Victoria
    // reads the omega Go API on :8080, which this repo neither starts nor
    // depends on).
    findings.push(...(await pluginFindings(root)));

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

/**
 * The plugin section: does the configuration resolve, what did it resolve to,
 * and is each declared backend answering.
 *
 * A missing plugin is `bad` — it is a hard build failure, and saying so here is
 * the whole point of checking. An unreachable backend is `warn` and never
 * fails doctor: running the omega API is a separate, optional thing to do, and
 * the shell's own views say so honestly when it is absent.
 */
async function pluginFindings(root: string): Promise<Finding[]> {
  const { plugins, error } = await resolvePlugins(root);

  if (error !== null) {
    return [
      {
        level: 'bad',
        title: 'Use-case plugins do not resolve — the web build will fail at config load',
        detail: `${error}\nEdit foreman-plugins.json, or check out the repository that provides the plugin.`,
      },
    ];
  }

  if (plugins.length === 0) {
    return [
      {
        level: 'warn',
        title: 'No use-case plugins configured — every objective gets the core chrome only',
        detail:
          'foreman-plugins.json lists which shells this build ships.\n' +
          'Authoring guide: docs/USE-CASE-SHELLS.md',
      },
    ];
  }

  const lines = plugins.map((p) => {
    const pkg = pluginPackage(p.dir);
    const where = isOutOfTree(p.dir, root) ? 'out-of-tree' : 'in-repo';
    return `${p.id.padEnd(12)} ${p.spec}  (${where}${pkg ? `, ${pkg.name}@${pkg.version}` : ''})`;
  });

  const findings: Finding[] = [
    {
      level: 'ok',
      title: `${String(plugins.length)} use-case plugin(s) configured and on disk`,
      detail: `${lines.join('\n')}\nThe Plugins tab in the web app shows the same list, with live health.`,
    },
  ];

  for (const plugin of plugins) {
    const sources = pluginSourcesOnDisk(plugin.dir);
    if (sources.length === 0) continue;
    for (const source of sources) {
      const url = probeUrl(source);
      const up = await reachable(url);
      findings.push({
        level: up ? 'ok' : 'warn',
        title: up
          ? `${plugin.id}: ${source.label} is reachable (${url})`
          : `${plugin.id}: ${source.label} is not running (${url})`,
        detail: up
          ? undefined
          : `The ${plugin.id} tabs show live-data errors until it is. This is not a harness\n` +
            `problem and does not need fixing to use the rest of the app — see\n` +
            `docs/FOREMAN.md § Victoria live data for the one command that starts it.` +
            (source.envVar ? `\nPoint it elsewhere with ${source.envVar}=<url>.` : ''),
      });
    }
  }

  return findings;
}

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

/**
 * Workspace packages whose newest source file is newer than their newest build
 * artefact. These resolve through `dist/`, so a running server keeps executing
 * the old code.
 */
function stalePackages(root: string): string[] {
  const pkgDir = path.join(root, 'packages');
  if (!fs.existsSync(pkgDir)) return [];

  const newest = (dir: string): number => {
    let latest = 0;
    const walk = (d: string, depth: number) => {
      if (depth > 5) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else {
          try {
            latest = Math.max(latest, fs.statSync(full).mtimeMs);
          } catch {
            /* raced */
          }
        }
      }
    };
    walk(dir, 0);
    return latest;
  };

  const stale: string[] = [];
  for (const name of fs.readdirSync(pkgDir)) {
    const src = path.join(pkgDir, name, 'src');
    const dist = path.join(pkgDir, name, 'dist');
    if (!fs.existsSync(src) || !fs.existsSync(dist)) continue;
    if (newest(src) > newest(dist)) stale.push(`@omega/${name}`);
  }
  return stale;
}
