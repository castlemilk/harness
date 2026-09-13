#!/usr/bin/env node
/**
 * Periodic Micropod health check. Detect-only: never mutates the runtime.
 *
 * Writes the latest report to $OMEGA_STORAGE_ROOT/recovery/micropod/health.json,
 * appends one status line to health.log, and on an unhealthy result appends to
 * alerts.log and posts a macOS notification. Installed as a LaunchAgent by
 * scripts/ops/install-micropod-watchdog.sh, which runs it with the absolute
 * node path so launchd's minimal PATH is irrelevant.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT_DIR = path.join(process.env.OMEGA_STORAGE_ROOT ?? path.join(os.homedir(), '.omega'), 'recovery', 'micropod');
fs.mkdirSync(OUT_DIR, { recursive: true });

const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ops', 'micropod-health.mjs'), '--json'], {
  timeout: 120_000,
  encoding: 'utf-8',
  env: { ...process.env, PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin' },
});

let report = { status: 'unknown' };
try {
  report = JSON.parse(result.stdout);
} catch {
  report = { status: 'unknown', error: result.stderr?.slice(0, 200) ?? 'no output' };
}

const now = new Date().toISOString();
fs.writeFileSync(path.join(OUT_DIR, 'health.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.appendFileSync(path.join(OUT_DIR, 'health.log'), `${now} ${report.status}\n`);

try {
  const log = fs.readFileSync(path.join(OUT_DIR, 'health.log'), 'utf-8').split('\n');
  if (log.length > 2000) {
    fs.writeFileSync(path.join(OUT_DIR, 'health.log'), `${log.slice(-2000).join('\n')}\n`);
  }
} catch {
  // Log truncation is best-effort.
}

if (report.status !== 'healthy') {
  const remedy = typeof report.remedy === 'string' && report.remedy.length > 0 ? report.remedy : 'see docs/micropod-recovery.md';
  fs.appendFileSync(path.join(OUT_DIR, 'alerts.log'), `${now} ${report.status} ${remedy}\n`);
  spawnSync(
    'osascript',
    ['-e', `display notification "micropod: ${report.status}" with title "Omega micropod watchdog" subtitle "${remedy}"`],
    { timeout: 10_000 }
  );
}