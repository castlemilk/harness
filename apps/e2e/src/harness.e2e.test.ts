import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const API = 'http://localhost:4004';

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

function startMockLlmServer(): Promise<{ server: http.Server; port: number; requests: unknown[] }> {
  return new Promise((resolve) => {
    const requests: unknown[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
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
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed.',
                  },
                },
              ],
            })
          );
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

describe('harness e2e with Kimi', () => {
  let server: ReturnType<typeof spawn> | undefined;
  let mockLlm: Awaited<ReturnType<typeof startMockLlmServer>> | undefined;
  const dbDir = `/tmp/harness-e2e-${Date.now()}`;
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://localhost:5432/omega',
    DATABASE_DIR: dbDir,
    PORT: '4004',
    GRPC_PORT: '50054',
    // Use a blank KIMI_API_KEY so the seeder does not create a real Kimi provider.
    // The e2e suite creates its own mock Kimi provider pointed at a local LLM stub.
    KIMI_API_KEY: '',
  };

  beforeAll(async () => {
    mockLlm = await startMockLlmServer();

    // Set up database
    execSync('pnpm --filter @omega/db migrate:deploy', { cwd: root, env, stdio: 'inherit' });
    execSync('pnpm --filter @omega/db seed', { cwd: root, env, stdio: 'inherit' });

    // Start server
    server = spawn('node', ['apps/server/dist/index.js'], { cwd: root, env, stdio: 'pipe' });

    server.stdout?.on('data', (data) => { console.log(`server: ${data}`); });
    server.stderr?.on('data', (data) => { console.error(`server err: ${data}`); });

    await waitForApi();

    // Register a Kimi provider that points to our local mock LLM server.
    // This lets the e2e suite exercise the full harness flow without a real API key.
    const providerRes = await fetch(`${API}/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'kimi-mock',
        kind: 'kimi',
        baseUrl: `http://127.0.0.1:${mockLlm.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'moonshot-v1-8k',
        capabilities: [{ name: 'moonshot-v1-8k', level: 'advanced' }],
        enabled: true,
      }),
    });
    expect(providerRes.status).toBe(201);
  }, 120000);

  afterAll(async () => {
    if (server) {
      server.kill();
      await new Promise((r) => setTimeout(r, 500));
      if (!server.killed) server.kill('SIGKILL');
    }
    if (mockLlm) {
      mockLlm.server.close();
    }
  });

  it('creates a project, task, and runs it through the Kimi provider', async () => {
    const projectRes = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'e2e-project', path: '/tmp/e2e-project' }),
    });
    expect(projectRes.status).toBe(201);
    const project = (await projectRes.json()) as { id: string };

    const taskRes = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Summarize the concept of machine learning in one sentence',
        complexity: 'complex',
        tags: [],
      }),
    });
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

    const runRes = await fetch(`${API}/tasks/${task.id}/run`, { method: 'POST' });
    expect(runRes.status).toBe(200);
    const ran = (await runRes.json()) as { status: string; result?: string; error?: string };

    if (ran.status !== 'done') {
      console.error('Task failed:', ran.error);
    }
    expect(ran.status).toBe('done');
    expect(ran.result).toBeTruthy();
    expect(ran.result?.length).toBeGreaterThan(10);
    expect(ran.error).toBeFalsy();

    // Confirm the mock LLM actually received the chat completion request.
    expect(
      mockLlm?.requests.some(
        (r: unknown) =>
          typeof r === 'object' &&
          r !== null &&
          (r as Record<string, unknown>).model === 'moonshot-v1-8k'
      )
    ).toBe(true);
  });
});
