#!/usr/bin/env node
/**
 * Recover a crash-looping Micropod network plugin without touching any Apple
 * container daemons.
 *
 *   node scripts/ops/micropod-net-recover.mjs --network omega-nat-test
 *   node scripts/ops/micropod-net-recover.mjs --auto
 *
 * A vmnet plugin that cannot create its network (`vmnet_return_t 1001`) retries
 * every ~10s and holds a pending operation that blocks the container API. The
 * fix is to stop that one launchd job and remove its network state; the runtime
 * itself is fine. This script refuses to touch `default` or any
 * `cuttlefish*` network, and never signals Apple daemons or other plugins.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const NETWORKS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.container', 'networks');
const SOCKET = process.env.MICROPOD_DOCKER_SOCKET ?? `${os.homedir()}/.micropod/docker.sock`;
const args = process.argv.slice(2);

function option(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function run(cmd, timeoutMs, env = {}) {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    timeout: timeoutMs,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    maxBuffer: 8 * 1024 * 1024,
  });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function guardName(name) {
  if (name === 'default' || name.startsWith('cuttlefish')) {
    console.error(`refusing to touch network "${name}" — only ad-hoc/test networks are safe to recover.`);
    process.exit(1);
  }
}

function detectCrashingNetwork() {
  const health = run(['node', path.join(import.meta.dirname, 'micropod-health.mjs'), '--json'], 60_000);
  try {
    const report = JSON.parse(health.stdout);
    return report.networkCrashLoops?.[0]?.network;
  } catch {
    return undefined;
  }
}

let network = option('--network');
if (!network && args.includes('--auto')) network = detectCrashingNetwork();
if (!network) {
  if (args.includes('--auto')) {
    console.log('[net-recover] no crash-looping network detected; nothing to do.');
    process.exit(0);
  }
  console.error('usage: micropod-net-recover.mjs --network <name> | --auto');
  process.exit(1);
}
guardName(network);

const uid = process.getuid?.() ?? Number(run(['id', '-u'], 5_000).stdout.trim());
const job = `com.apple.container.container-network-vmnet.${network}`;
const networkDir = path.join(NETWORKS_DIR, network);

console.log(`[net-recover] booting out ${job}`);
run(['launchctl', 'bootout', `gui/${uid}/${job}`], 20_000);

await new Promise((resolve) => setTimeout(resolve, 15_000));

const logs = run(['container', 'system', 'logs'], 15_000);
const stillFailing = logs.stdout
  .split('\n')
  .filter((line) => line.includes('helper failed') && line.includes(`[id=${network}]`))
  .slice(-3);
const recent = stillFailing.some((line) => {
  const stamp = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(line)?.[1];
  const parsed = stamp ? Date.parse(stamp.replace(' ', 'T')) : Number.NaN;
  return !Number.isFinite(parsed) || Date.now() - parsed < 30_000;
});
if (recent) {
  console.error(`[net-recover] ${network} is still failing after bootout; aborting before touching its state.`);
  console.error('  The plugin may have been restarted by another process (e.g. container system start).');
  console.error('  Stop that process or use the escalation ladder in docs/micropod-recovery.md.');
  process.exit(2);
}

if (fs.existsSync(networkDir)) {
  const storageRoot = process.env.OMEGA_STORAGE_ROOT ?? path.join(os.homedir(), '.omega');
  const backupDir = path.join(storageRoot, 'recovery', 'micropod', `${network}-${String(Date.now())}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.cpSync(networkDir, backupDir, { recursive: true });
  console.log(`[net-recover] backed up state to ${backupDir}`);
  fs.rmSync(networkDir, { recursive: true, force: true });
  console.log(`[net-recover] removed ${networkDir}`);
} else {
  console.log(`[net-recover] no state directory for ${network}`);
}

const health = run(['node', path.join(import.meta.dirname, 'micropod-health.mjs')], 60_000, {
  DOCKER_HOST: `unix://${SOCKET}`,
});
process.stdout.write(health.stdout);
process.exit(health.ok ? 0 : 3);
