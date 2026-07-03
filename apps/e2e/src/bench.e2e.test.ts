import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'node:fs/promises';
import type { BenchmarkTask } from '@omega/bench';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const API = 'http://localhost:4005';

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
            // Planning turn: return a simple plan.
            response = {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      reasoning: 'noop benchmark task',
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
                    content: '',
                    tool_calls: [
                      {
                        id: 'call-publish',
                        type: 'function',
                        function: { name: 'publish', arguments: JSON.stringify({}) },
                      },
                    ],
                  },
                },
              ],
            };
          } else {
            response = {
              choices: [
                {
                  message: {
                    content: '',
                    tool_calls: [
                      {
                        id: 'call-finish',
                        type: 'function',
                        function: { name: 'finish', arguments: JSON.stringify({ summary: 'done', success: true }) },
                      },
                    ],
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

describe('harness benchmark runner', () => {
  let server: ReturnType<typeof spawn> | undefined;
  let mockLlm: Awaited<ReturnType<typeof startMockLlmServer>> | undefined;
  const testId = Date.now();
  const dbDir = `/tmp/harness-bench-e2e-db-${testId}`;
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://localhost:5432/omega',
    DATABASE_DIR: dbDir,
    PORT: '4005',
    GRPC_PORT: '50055',
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
        name: 'bench-mock',
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

  it('runs a synthetic benchmark task end-to-end', async () => {
    const { runBenchmark, writeReport } = await import('@omega/bench');

    const task: BenchmarkTask = {
      id: 'noop-bench',
      name: 'noop-bench',
      title: 'Run validation on a clean project',
      description: 'This project already passes lint, test and build. Use publish and finish.',
      complexity: 'simple',
      setup: async (projectPath) => {
        const pkg = {
          name: 'noop-bench',
          version: '1.0.0',
          type: 'module',
          scripts: {
            lint: 'node lint.js',
            test: 'node test.js',
            build: 'node build.js',
          },
        };
        await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
        await fs.writeFile(path.join(projectPath, 'lint.js'), "console.log('lint ok');\n", 'utf-8');
        await fs.writeFile(path.join(projectPath, 'test.js'), "console.log('test ok');\n", 'utf-8');
        await fs.writeFile(path.join(projectPath, 'build.js'), "console.log('build ok');\n", 'utf-8');
      },
      evaluate: async (ctx) => {
        const summary = ctx.agentRun?.validationSummary
          ? (JSON.parse(ctx.agentRun.validationSummary) as { allPassed?: boolean })
          : { allPassed: false };
        return {
          passed: ctx.agentRun?.resultStatus === 'done' && summary.allPassed,
          message: `status=${ctx.agentRun?.resultStatus ?? 'unknown'}, allPassed=${String(summary.allPassed)}`,
        };
      },
    };

    const report = await runBenchmark([task], {
      apiUrl: API,
      suiteName: 'e2e-synthetic',
      timeoutMs: 60000,
    });

    expect(report.total).toBe(1);
    expect(report.results[0].status).toBe('done');
    expect(report.results[0].evaluation.passed).toBe(true);
    expect(report.results[0].spanCount).toBeGreaterThan(0);

    const reportFile = await writeReport(report, path.join(root, '.omega', 'reports'));
    expect(reportFile).toContain('benchmark-');
  }, 120000);

  afterAll(() => {
    server?.kill();
    mockLlm?.server.close();
  });
});
