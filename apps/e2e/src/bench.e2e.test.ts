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
          let parsedBody: { tools?: { function?: { name?: string } }[]; max_tokens?: number } = {};
          try {
            parsedBody = JSON.parse(body) as typeof parsedBody;
          } catch {
            parsedBody = {};
          }
          // Warmup connectivity probe (max_tokens=1, no tools): answer without
          // consuming a scripted turn. POST /providers fires one at creation,
          // and a probe that advanced `turn` would desync every scripted
          // response after it — the planner would be handed the publish call
          // and the whole run derails into retry backoffs.
          const isWarmupProbe = parsedBody.max_tokens === 1 || (parsedBody.tools ?? []).length === 0;
          if (isWarmupProbe) {
            res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
            return;
          }
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
                        { name: 'test', tool: 'run_command', input: { command: 'node test.js' } },
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
          } else if (turn === 2) {
            // Run the test command before finishing. The executor rejects a
            // finish when the project carries a test script that no run_command
            // ever invoked ("this task has a test suite but you have not run
            // any test command") — a publish-then-finish script would be
            // rejected on every turn until the step cap turned the run failed.
            response = {
              choices: [
                {
                  message: {
                    content: '',
                    tool_calls: [
                      {
                        id: 'call-test',
                        type: 'function',
                        function: { name: 'run_command', arguments: JSON.stringify({ command: 'node test.js' }) },
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
    GLM_API_KEY: '',
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
      description: 'This project already passes all validation scripts. Use publish and finish.',
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
      // Pin the mock explicitly. Without this the runner leaves the task
      // unpinned and the router chooses among ALL enabled providers — on any
      // machine with seeded defaults that is ollama-local/llama3, whose 404s
      // retry on 30s/60s/90s backoffs and blow the test's deadline.
      provider: 'bench-mock',
      model: 'moonshot-v1-8k',
    });

    expect(report.total).toBe(1);
    expect(report.results[0].status).toBe('done');
    expect(report.results[0].evaluation.passed).toBe(true);
    expect(report.results[0].spanCount).toBeGreaterThan(0);

    const reportFile = await writeReport(report, path.join(root, '.omega', 'reports'));
    expect(reportFile).toContain('benchmark-');
  }, 120000);

  afterAll(async () => {
    if (server) {
      server.kill();
      await new Promise((r) => setTimeout(r, 500));
      // The server force-exits on SIGTERM within its watchdog budget, but a
      // hung graceful path must not leak a process that holds port 4005 and
      // poisons every later run against it.
      if (!server.killed) server.kill('SIGKILL');
    }
    mockLlm?.server.close();
  });
});
