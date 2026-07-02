#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(__filename, '..', '..');
const reportsDir = path.join(root, '.omega', 'reports');
const PROTO_PATH = path.join(root, 'proto', 'tasks.proto');

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function findPort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferred;
      server.close(() => resolve(port));
    });
    server.listen(preferred);
  });
}

function startMockLlm() {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          requests.push(JSON.parse(body));
        } catch {
          requests.push(body);
        }
        if (req.url?.startsWith('/v1/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'moonshot-v1-8k' }] }));
          return;
        }
        if (req.url?.startsWith('/v1/chat/completions')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'benchmark result' } }] }));
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

function startHarness(port, grpcPort, dbDir) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      DATABASE_URL: 'postgresql://localhost:5432/omega',
      DATABASE_DIR: dbDir,
      PORT: String(port),
      GRPC_PORT: String(grpcPort),
      KIMI_API_KEY: '',
    };
    const proc = spawn('node', ['apps/server/dist/index.js'], { cwd: root, env, stdio: 'pipe' });
    resolve(proc);
  });
}

async function waitForApi(apiUrl, maxMs = 30000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiUrl}/projects`);
      if (res.ok) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

async function createProject(apiUrl, name, projectPath) {
  const res = await fetch(`${apiUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path: projectPath }),
  });
  if (!res.ok) throw new Error(`createProject failed: ${res.status}`);
  return res.json();
}

async function registerProvider(apiUrl, mockPort) {
  const res = await fetch(`${apiUrl}/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'benchmark-kimi',
      kind: 'kimi',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: 'bench',
      defaultModel: 'moonshot-v1-8k',
      capabilities: [{ name: 'moonshot-v1-8k', level: 'advanced' }],
      enabled: true,
    }),
  });
  if (!res.ok) throw new Error(`registerProvider failed: ${res.status}`);
}

async function createTask(apiUrl, projectId, title) {
  const res = await fetch(`${apiUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title, complexity: 'simple', tags: [] }),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
  return res.json();
}

async function runTask(apiUrl, taskId) {
  const res = await fetch(`${apiUrl}/tasks/${taskId}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`runTask failed: ${res.status}`);
  return res.json();
}

async function waitForTask(apiUrl, taskId, maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiUrl}/tasks/${taskId}`);
    if (!res.ok) throw new Error('Failed to fetch task');
    const task = await res.json();
    if (task.status === 'done' || task.status === 'failed') return task;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Task did not finish in time');
}

function grpcClient(grpcPort) {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition);
  const Service = proto.omega.TaskIngestion;
  return new Service(`127.0.0.1:${grpcPort}`, grpc.credentials.createInsecure());
}

function grpcSubmit(client, projectId, title) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    client.submitTask({ project_id: projectId, title, auto_run: true }, (err, response) => {
      const latency = Date.now() - start;
      if (err) return reject(err);
      resolve({ response, latency });
    });
  });
}

async function main() {
  await fs.mkdir(reportsDir, { recursive: true });
  const ts = nowIso();
  const reportFile = path.join(reportsDir, `benchmark-${ts}.json`);
  const dbDir = path.join('/tmp', `omega-bench-${Date.now()}`);

  const httpPort = await findPort(4000);
  const grpcPort = await findPort(50051);
  const apiUrl = `http://127.0.0.1:${httpPort}`;

  console.log(`Starting benchmark server on HTTP ${httpPort}, gRPC ${grpcPort}`);
  const mockLlm = await startMockLlm();
  const server = await startHarness(httpPort, grpcPort, dbDir);
  await waitForApi(apiUrl);

  await registerProvider(apiUrl, mockLlm.port);
  const project = await createProject(apiUrl, 'benchmark-project', '/tmp/benchmark-project');

  const results = {
    timestamp: new Date().toISOString(),
    httpPort,
    grpcPort,
    measurements: {},
  };

  // HTTP task creation latency
  const httpCreateStart = Date.now();
  const httpTask = await createTask(apiUrl, project.id, 'HTTP benchmark task');
  results.measurements.httpCreateTaskMs = Date.now() - httpCreateStart;

  // gRPC task submission + auto-run latency
  const client = grpcClient(grpcPort);
  const grpcResult = await grpcSubmit(client, project.id, 'gRPC benchmark task');
  results.measurements.grpcSubmitTaskMs = grpcResult.latency;

  // Time to run a simple task through the mock LLM
  const runStart = Date.now();
  await runTask(apiUrl, httpTask.id);
  const finishedTask = await waitForTask(apiUrl, httpTask.id);
  results.measurements.taskRunTotalMs = Date.now() - runStart;
  results.measurements.taskStatus = finishedTask.status;

  // gRPC task completion time
  const grpcTaskId = grpcResult.response.id;
  const grpcFinished = await waitForTask(apiUrl, grpcTaskId);
  results.measurements.grpcTaskStatus = grpcFinished.status;

  await fs.writeFile(reportFile, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Benchmark report written to ${reportFile}`);
  console.log(JSON.stringify(results.measurements, null, 2));

  // Cleanup
  client.close();
  server.kill();
  mockLlm.server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
