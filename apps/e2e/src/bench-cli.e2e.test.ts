import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const API = 'http://localhost:4006';

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
    let turn = 0;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url?.startsWith('/v1/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'moonshot-v1-8k' }] }));
          return;
        }

        if (req.url?.startsWith('/v1/chat/completions')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          let response;
          if (turn === 0) {
            response = {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      reasoning: 'smoke benchmark task',
                      plan: [
                        { name: 'validate', tool: 'publish', input: {} },
                        { name: 'finish', tool: 'finish', input: { summary: 'done', success: true } },
                      ],
                    }),
                  },
                },
              ],
            };
          } else if (turn === 1) {
            response = {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      tool_calls: [
                        { id: 'call-publish', name: 'publish', arguments: {} },
                      ],
                    }),
                  },
                },
              ],
            };
          } else {
            response = {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      tool_calls: [
                        { id: 'call-finish', name: 'finish', arguments: { summary: 'done', success: true } },
                      ],
                    }),
                  },
                },
              ],
            };
          }
          turn++;
          res.end(JSON.stringify(response));
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

describe('harness bench CLI', () => {
  let server: ReturnType<typeof spawn> | undefined;
  let mockLlm: Awaited<ReturnType<typeof startMockLlmServer>> | undefined;
  const testId = Date.now();
  const dbDir = `/tmp/harness-bench-cli-e2e-db-${testId}`;
  const reportsDir = `/tmp/harness-bench-cli-e2e-reports-${testId}`;
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://localhost:5432/omega',
    DATABASE_DIR: dbDir,
    PORT: '4006',
    GRPC_PORT: '50056',
    HARNESS_API_URL: API,
    KIMI_API_KEY: '',
  };

  beforeAll(async () => {
    mockLlm = await startMockLlmServer();

    execSync('pnpm --filter @omega/db migrate:deploy', { cwd: root, env, stdio: 'inherit' });
    execSync('pnpm --filter @omega/db seed', { cwd: root, env, stdio: 'inherit' });

    server = spawn('node', ['apps/server/dist/index.js'], { cwd: root, env, stdio: 'pipe' });
    server.stdout?.on('data', (data) => { console.log(`server: ${data}`); });
    server.stderr?.on('data', (data) => { console.error(`server err: ${data}`); });

    await waitForApi();

    const providerRes = await fetch(`${API}/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'bench-cli-mock',
        kind: 'kimi',
        baseUrl: `http://127.0.0.1:${mockLlm.port}/v1`,
        apiKey: 'bench',
        defaultModel: 'moonshot-v1-8k',
        capabilities: [{ name: 'moonshot-v1-8k', level: 'advanced' }],
        enabled: true,
      }),
    });
    expect(providerRes.status).toBe(201);
  }, 120000);

  it('runs omega bench optimise end-to-end', async () => {
    const runProc = spawn('node', [
      'apps/cli/dist/index.js',
      '--api',
      API,
      'bench',
      'run',
      '--suite',
      'synthetic',
      '--n-tasks',
      '1',
      '--timeout',
      '30000',
      '--output-dir',
      reportsDir,
    ], { cwd: root, env, stdio: 'pipe' });

    let runStdout = '';
    runProc.stdout?.on('data', (data) => { runStdout += data; console.log(`run: ${data}`); });
    runProc.stderr?.on('data', (data) => { console.error(`run err: ${data}`); });

    const runCode = await new Promise<number>((resolve) => runProc.on('close', resolve));
    expect(runCode).toBe(0);
    expect(runStdout).toContain('Report written to');

    const optProc = spawn('node', [
      'apps/cli/dist/index.js',
      '--api',
      API,
      'bench',
      'optimise',
      '--output-dir',
      reportsDir,
    ], { cwd: root, env, stdio: 'pipe' });

    let optStdout = '';
    optProc.stdout?.on('data', (data) => { optStdout += data; console.log(`opt: ${data}`); });
    optProc.stderr?.on('data', (data) => { console.error(`opt err: ${data}`); });

    const optCode = await new Promise<number>((resolve) => optProc.on('close', resolve));
    expect(optCode).toBe(0);
    expect(optStdout).toContain('Created self-improve task');
  }, 300000);

  afterAll(() => {
    server?.kill();
    mockLlm?.server.close();
  });
});
