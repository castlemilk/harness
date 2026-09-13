#!/usr/bin/env node
/**
 * Bounded health check for the Micropod / Apple Container runtime.
 *
 *   node scripts/ops/micropod-health.mjs [--json] [--quiet]
 *
 * Exit codes:
 *   0  healthy
 *   2  network-crash-loop   (recoverable: micropod-net-recover.mjs)
 *   3  api-unresponsive     (no crash loop found; runtime is stuck)
 *   4  socket-missing       (Micropod not running)
 *
 * The crash-loop probe reads `container system logs`, which keeps working even
 * when the container API hangs. A vmnet plugin that fails to create its network
 * (`vmnet_return_t 1001`) retries every ~10s and holds a pending operation that
 * makes every container API call block — this check catches that before tooling
 * piles more operations onto the runtime.
 *
 * Never mutates anything.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const quiet = args.includes('--quiet');

const SOCKET = process.env.MICROPOD_DOCKER_SOCKET ?? `${os.homedir()}/.micropod/docker.sock`;
const API_TIMEOUT_MS = Number(process.env.MICROPOD_HEALTH_TIMEOUT_MS ?? 15_000);
const CRASH_WINDOW_MS = Number(process.env.MICROPOD_CRASH_WINDOW_MS ?? 120_000);
const CRASH_THRESHOLD = 3;

// launchd runs periodic jobs with a minimal PATH; resolve the CLIs explicitly.
const BIN_CANDIDATES = {
  container: ['/usr/local/bin/container', '/opt/homebrew/bin/container'],
  docker: [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
  ],
};
const CHILD_PATH = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  process.env.PATH ?? '',
].filter(Boolean).join(':');

function resolveBin(name) {
  for (const candidate of BIN_CANDIDATES[name] ?? []) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

const CONTAINER = resolveBin('container');
const DOCKER = resolveBin('docker');

function run(cmd, timeoutMs, env = {}) {
  const started = Date.now();
  const result = spawnSync(cmd[0], cmd.slice(1), {
    timeout: timeoutMs,
    env: { ...process.env, PATH: CHILD_PATH, ...env },
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - started,
  };
}

function recentNetworkFailures(logText) {
  const now = Date.now();
  const byNetwork = new Map();
  for (const line of logText.split('\n')) {
    if (!line.includes('container-network-vmnet') || !line.includes('helper failed')) continue;
    const id = /\[id=([^\]]+)\]/.exec(line)?.[1];
    if (!id) continue;
    const stamp = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(line)?.[1];
    const parsed = stamp ? Date.parse(stamp.replace(' ', 'T')) : Number.NaN;
    const recent = !Number.isFinite(parsed) || now - parsed <= CRASH_WINDOW_MS;
    if (!recent) continue;
    const entry = byNetwork.get(id) ?? { network: id, failures: 0, sample: line.slice(0, 240) };
    entry.failures += 1;
    byNetwork.set(id, entry);
  }
  return [...byNetwork.values()].filter((entry) => entry.failures >= CRASH_THRESHOLD);
}

function diskFreeBytes() {
  const result = run(['df', '-k', '/'], 5_000);
  const line = result.stdout.split('\n')[1] ?? '';
  const columns = line.trim().split(/\s+/);
  const availKb = Number(columns[3]);
  return Number.isFinite(availKb) ? availKb * 1024 : null;
}

const socketPresent = fs.existsSync(SOCKET);
const docker = socketPresent
  ? run([DOCKER, 'ps', '--format', '{{.Names}}'], 10_000, { DOCKER_HOST: `unix://${SOCKET}` })
  : { ok: false, timedOut: false, stdout: '', stderr: 'socket missing', status: null, durationMs: 0 };
const containerList = socketPresent
  ? run([CONTAINER, 'list'], API_TIMEOUT_MS)
  : { ok: false, timedOut: false, stdout: '', stderr: 'socket missing', status: null, durationMs: 0 };
const systemLogs = run([CONTAINER, 'system', 'logs'], 15_000);

const crashLoops = systemLogs.ok ? recentNetworkFailures(systemLogs.stdout) : [];
const apiResponsive = containerList.ok && containerList.stdout.includes('ID');

let status = 'healthy';
let exitCode = 0;
let remedy = null;
if (!socketPresent) {
  status = 'socket-missing';
  exitCode = 4;
  remedy = 'Start Micropod (open -a Micropod).';
} else if (crashLoops.length > 0) {
  status = 'network-crash-loop';
  exitCode = 2;
  remedy = `Run: node scripts/ops/micropod-net-recover.mjs --network ${crashLoops[0].network}`;
} else if (!apiResponsive) {
  status = 'api-unresponsive';
  exitCode = 3;
  remedy = 'See docs/micropod-recovery.md (escalation ladder; avoid killing Apple container daemons).';
}

const report = {
  status,
  healthy: status === 'healthy',
  socket: { path: SOCKET, present: socketPresent },
  api: {
    responsive: apiResponsive,
    containerListMs: containerList.durationMs,
    containerListTimedOut: containerList.timedOut,
    dockerShimOk: docker.ok,
  },
  networkCrashLoops: crashLoops,
  logsReadable: systemLogs.ok,
  diskFreeBytes: diskFreeBytes(),
  remedy,
  checkedAt: new Date().toISOString(),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else if (!quiet) {
  console.log(`micropod: ${status}${report.healthy ? '' : ` — ${remedy ?? ''}`}`);
  if (!report.healthy) {
    console.log(`  socket=${String(socketPresent)} api=${String(apiResponsive)} logs=${String(systemLogs.ok)}`);
    for (const loop of crashLoops) console.log(`  crash-loop: ${loop.network} (${String(loop.failures)} recent failures)`);
  }
}

process.exit(exitCode);
