import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { withHarnessApi } from './with-harness-api.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(root, 'apps/cli/dist/index.js');

async function port() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const value = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return value;
}

async function fixture(t, mode = 'ready') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-api-ci-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const apiUrl = `http://127.0.0.1:${await port()}`;
  const env = {
    PATH: process.env.PATH,
    TMPDIR: cwd,
    OMEGA_STORAGE_ROOT: path.join(cwd, 'storage'),
    HARNESS_API_URL: apiUrl,
    GRPC_PORT: '0',
    FIXTURE_DIR: cwd,
    FIXTURE_MODE: mode,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'CI Fixture', GIT_COMMITTER_NAME: 'CI Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const serverEntry = path.join(cwd, 'api.mjs');
  fs.writeFileSync(serverEntry, `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.FIXTURE_DIR;
fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ pid: process.pid, database: process.env.DATABASE_DIR }));
if (process.env.FIXTURE_MODE === 'exit') process.exit(31);
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  fs.appendFileSync(path.join(dir, 'requests.jsonl'), JSON.stringify({ method: req.method, url: req.url, body }) + '\\n');
  if (process.env.FIXTURE_MODE === 'hang') return;
  if (process.env.FIXTURE_MODE === 'html') { res.end('<html>not an API</html>'); return; }
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/die') { res.end('{}'); setTimeout(() => process.exit(32), 10); return; }
  if (req.method === 'GET' && req.url === '/projects') { res.end('[]'); return; }
  if (req.method === 'POST' && req.url === '/projects') { res.end(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' })); return; }
  if (req.method === 'POST' && req.url === '/tasks') { res.end(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', status: 'todo' })); return; }
  // Stop at the execution boundary: there is no provider implementation here.
  if (req.method === 'POST' && req.url.endsWith('/run')) { res.statusCode = 422; res.end(JSON.stringify({ error: 'fixture: provider execution intentionally stopped' })); return; }
  res.statusCode = 404; res.end('{}');
});
server.listen(Number(process.env.PORT), '127.0.0.1');
process.on('SIGTERM', () => {
  if (process.env.FIXTURE_MODE === 'ignore-term') return;
  server.closeAllConnections(); server.close(() => process.exit(0));
});
`);
  const command = path.join(cwd, 'command.mjs');
  fs.writeFileSync(command, `import fs from 'node:fs';
import path from 'node:path';
fs.writeFileSync(path.join(process.env.FIXTURE_DIR, 'command.json'), JSON.stringify({ pid: process.pid, database: process.env.DATABASE_DIR }));
if (process.env.FIXTURE_MODE === 'die') { await fetch(process.env.HARNESS_API_URL + '/die'); setInterval(() => {}, 1000); }
else if (process.env.FIXTURE_MODE === 'command-hang') { setInterval(() => {}, 1000); }
else process.exit(Number(process.env.COMMAND_EXIT ?? 0));
`);
  const options = {
    env, cwd, serverEntry,
    timeoutMs: 2000, stopTimeoutMs: 150, commandTimeoutMs: 5000,
    logPath: path.join(cwd, 'server.log'),
  };
  const read = (file) => JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
  const gone = (file) => {
    const { pid } = read(file);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  };
  return { cwd, apiUrl, env, options, read, gone, command };
}

test('ready API surrounds the command and separates server/CLI storage', async (t) => {
  const f = await fixture(t);
  assert.equal(await withHarnessApi(process.execPath, [f.command], f.options), 0);
  assert.equal(f.read('server.json').database, path.join(f.env.OMEGA_STORAGE_ROOT, 'server-db'));
  assert.equal(f.read('command.json').database, path.join(f.env.OMEGA_STORAGE_ROOT, 'cli-db'));
  f.gone('server.json'); f.gone('command.json');
});

test('command failure is preserved and its API is stopped', async (t) => {
  const f = await fixture(t);
  f.env.COMMAND_EXIT = '17';
  assert.equal(await withHarnessApi(process.execPath, [f.command], f.options), 17);
  f.gone('server.json');
});

test('API startup exit fails without invoking the command', async (t) => {
  const f = await fixture(t, 'exit');
  await assert.rejects(withHarnessApi(process.execPath, [f.command], f.options), /exited before readiness/);
  assert.ok(!fs.existsSync(path.join(f.cwd, 'command.json')));
  f.gone('server.json');
});

for (const mode of ['hang', 'html']) {
  test(`readiness rejects ${mode} responses within a deadline and cleans up`, async (t) => {
    const f = await fixture(t, mode);
    const start = Date.now();
    await assert.rejects(withHarnessApi(process.execPath, [f.command], { ...f.options, timeoutMs: 250 }), /not ready within/);
    assert.ok(Date.now() - start < 2000);
    assert.ok(!fs.existsSync(path.join(f.cwd, 'command.json')));
    f.gone('server.json');
  });
}

test('occupied API port is not reused or stopped', async (t) => {
  const f = await fixture(t);
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(Number(new URL(f.apiUrl).port), '127.0.0.1', resolve));
  try {
    await assert.rejects(withHarnessApi(process.execPath, [f.command], f.options), { code: 'EADDRINUSE' });
    assert.ok(occupied.listening);
    assert.ok(!fs.existsSync(path.join(f.cwd, 'server.json')));
  } finally { await new Promise((resolve) => occupied.close(resolve)); }
});

test('shutdown force-stops only the owned API when SIGTERM is ignored', async (t) => {
  const f = await fixture(t, 'ignore-term');
  const start = Date.now();
  assert.equal(await withHarnessApi(process.execPath, [f.command], f.options), 0);
  assert.ok(Date.now() - start < 3000);
  f.gone('server.json');
});

test('API exit while a command is running fails and stops that command', async (t) => {
  const f = await fixture(t, 'die');
  await assert.rejects(withHarnessApi(process.execPath, [f.command], f.options), /exited while the benchmark/);
  f.gone('server.json'); f.gone('command.json');
});

test('command deadline cleans up both processes', async (t) => {
  const f = await fixture(t, 'command-hang');
  await assert.rejects(withHarnessApi(process.execPath, [f.command], { ...f.options, commandTimeoutMs: 150 }), /command exceeded/);
  f.gone('server.json'); f.gone('command.json');
});

test('SIGTERM cancellation stops the owned command and API', async (t) => {
  const f = await fixture(t, 'command-hang');
  const caller = path.join(f.cwd, 'caller.mjs');
  fs.writeFileSync(caller, `import { withHarnessApi } from ${JSON.stringify(new URL('./with-harness-api.mjs', import.meta.url).href)};\nprocess.exitCode = await withHarnessApi(${JSON.stringify(process.execPath)}, [${JSON.stringify(f.command)}], ${JSON.stringify(f.options)});\n`);
  const child = spawn(process.execPath, [caller], { env: f.env, stdio: 'ignore' });
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(path.join(f.cwd, 'command.json')) && Date.now() < deadline) await delay(20);
  assert.ok(fs.existsSync(path.join(f.cwd, 'command.json')));
  child.kill('SIGTERM');
  let timer;
  try {
    assert.equal(await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cancellation did not finish')), 2000); })]), 143);
  } finally { clearTimeout(timer); }
  f.gone('server.json'); f.gone('command.json');
});

async function runCli(f, args, extra = {}) {
  const output = fs.openSync(path.join(f.cwd, 'cli.log'), 'w');
  try {
    return await withHarnessApi(process.execPath, [cli, '--api', f.apiUrl, ...args], {
      ...f.options, timeoutMs: 30_000, commandTimeoutMs: 20_000, commandStdio: ['ignore', output, output], ...extra,
    });
  } finally { fs.closeSync(output); }
}

test('real checked-out server and CLI reach API readiness without executing a task', async (t) => {
  const f = await fixture(t);
  assert.equal(await runCli(f, ['bench', 'run', '--suite', 'fast', '--task-id', '__ci_no_tasks__'], {
    serverEntry: path.join(root, 'apps/server/dist/index.js'), stopTimeoutMs: 5000,
  }), 0);
  assert.match(fs.readFileSync(path.join(f.cwd, 'cli.log'), 'utf8'), /No benchmark tasks to run/);
  assert.match(fs.readFileSync(path.join(f.cwd, 'server.log'), 'utf8'), /SIGTERM received, shutting down/);
  assert.ok(fs.existsSync(path.join(f.env.OMEGA_STORAGE_ROOT, 'router-state.json')));
  assert.ok(fs.existsSync(path.join(f.env.OMEGA_STORAGE_ROOT, 'server-db')));
  await assert.rejects(fetch(f.apiUrl + '/projects'), /fetch failed/);
});

test('real CLI fixture reaches project/task/run API contracts and preserves regression failure', async (t) => {
  const f = await fixture(t);
  const baseline = path.join(f.cwd, 'baseline.json');
  fs.writeFileSync(baseline, JSON.stringify({ timestamp: new Date().toISOString(), suite: 'fast', total: 1, passed: 1, failed: 0, timeouts: 0, totalDurationMs: 0, results: [] }));
  const reports = path.join(f.cwd, 'reports');
  assert.equal(await runCli(f, ['bench', 'run', '--suite', 'fast', '--task-id', 'fast-string-utility', '--output-dir', reports, '--baseline', baseline, '--fail-on-regression']), 1);
  const requests = fs.readFileSync(path.join(f.cwd, 'requests.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(requests.some((r) => r.method === 'POST' && r.url === '/projects'));
  assert.ok(requests.some((r) => r.method === 'POST' && r.url === '/tasks' && JSON.parse(r.body).tags.includes('benchmark')));
  assert.ok(requests.some((r) => r.method === 'POST' && r.url.endsWith('/run')));
  const reportFile = fs.readdirSync(reports).find((file) => file.endsWith('.json'));
  const report = JSON.parse(fs.readFileSync(path.join(reports, reportFile), 'utf8'));
  assert.equal(report.total, 1); assert.equal(report.passed, 0); assert.equal(report.failed, 1);
  assert.match(fs.readFileSync(path.join(f.cwd, 'cli.log'), 'utf8'), /Regression detected/);
  f.gone('server.json');
});
