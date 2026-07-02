import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const API = 'http://localhost:4002';
const GRPC_TARGET = 'localhost:50052';
const PROTO_PATH = path.resolve(root, 'proto/tasks.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
  omega: {
    TaskIngestion: grpc.ServiceClientConstructor;
  };
};

interface TaskIngestionClient extends grpc.Client {
  submitTask(request: unknown, callback: (err: grpc.ServiceError | null, response: unknown) => void): void;
}

async function waitForApi(maxMs = 30000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/projects`);
      if (res.ok) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

function startMockLlmServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url?.startsWith('/v1/chat/completions')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'gRPC test result' } }] }));
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

describe('harness gRPC task ingestion', () => {
  let server: ReturnType<typeof spawn> | undefined;
  let grpcClient: TaskIngestionClient;
  const dbPath = `/tmp/harness-grpc-e2e-${Date.now()}.sqlite`;
  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    PORT: '4002',
    GRPC_PORT: '50052',
    KIMI_API_KEY: '',
  };

  beforeAll(async () => {
    execSync('pnpm --filter @omega/db migrate:deploy', { cwd: root, env, stdio: 'inherit' });
    execSync('pnpm --filter @omega/db seed', { cwd: root, env, stdio: 'inherit' });

    server = spawn('node', ['apps/server/dist/index.js'], { cwd: root, env, stdio: 'pipe' });
    server.stdout?.on('data', (data) => console.log(`server: ${data}`));
    server.stderr?.on('data', (data) => console.error(`server err: ${data}`));

    await waitForApi();

    grpcClient = new proto.omega.TaskIngestion(GRPC_TARGET, grpc.credentials.createInsecure()) as unknown as TaskIngestionClient;
  });

  afterAll(async () => {
    if (server) {
      server.kill();
      await new Promise((r) => setTimeout(r, 500));
      if (!server.killed) server.kill('SIGKILL');
    }
    grpcClient?.close();
  });

  it('creates a task via gRPC and appears in the REST API', async () => {
    const projectRes = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'grpc-e2e', path: '/tmp/grpc-e2e' }),
    });
    expect(projectRes.status).toBe(201);
    const project = (await projectRes.json()) as { id: string };

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      grpcClient.submitTask(
        {
          project_id: project.id,
          title: 'gRPC ingested task',
          complexity: 'medium',
          tags: ['grpc'],
          auto_run: false,
        },
        (err, res) => {
          if (err) reject(err);
          else resolve((res as Record<string, unknown>) ?? {});
        }
      );
    });

    expect(response.id).toBeTruthy();
    expect(response.status).toBe('todo');

    const tasksRes = await fetch(`${API}/tasks?projectId=${project.id}`);
    expect(tasksRes.status).toBe(200);
    const tasks = (await tasksRes.json()) as { title: string; status: string }[];
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe('gRPC ingested task');
    expect(tasks[0].status).toBe('todo');
  });

  it('auto-runs a gRPC-submitted task through a mock provider', async () => {
    const mockLlm = await startMockLlmServer();

    const providerRes = await fetch(`${API}/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'grpc-mock',
        kind: 'kimi',
        baseUrl: `http://127.0.0.1:${mockLlm.port}/v1`,
        apiKey: 'test',
        defaultModel: 'moonshot-v1-8k',
        capabilities: [{ name: 'moonshot-v1-8k', level: 'advanced' }],
        enabled: true,
      }),
    });
    expect(providerRes.status).toBe(201);

    const projectRes = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'grpc-autorun', path: '/tmp/grpc-autorun' }),
    });
    expect(projectRes.status).toBe(201);
    const project = (await projectRes.json()) as { id: string };

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      grpcClient.submitTask(
        {
          project_id: project.id,
          title: 'Auto-run via gRPC',
          complexity: 'complex',
          auto_run: true,
        },
        (err, res) => {
          if (err) reject(err);
          else resolve((res as Record<string, unknown>) ?? {});
        }
      );
    });

    expect(response.status).toBe('done');
    expect(response.error).toBeFalsy();

    mockLlm.server.close();
  });
});
