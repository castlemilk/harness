import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const API = 'http://localhost:4003';

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
    let turn = 0;
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
          const toolCalls = [];
          if (turn === 0) {
            toolCalls.push({
              id: 'call-1',
              type: 'function',
              function: { name: 'think', arguments: JSON.stringify({ thought: 'Plan: create a file and finish.' }) },
            });
          } else if (turn === 1) {
            toolCalls.push({
              id: 'call-2',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'agent-output.md', content: '# Agent was here\n' }),
              },
            });
          } else if (turn === 2) {
            toolCalls.push({
              id: 'call-3',
              type: 'function',
              function: { name: 'run_command', arguments: JSON.stringify({ command: 'cat agent-output.md' }) },
            });
          } else {
            toolCalls.push({
              id: 'call-4',
              type: 'function',
              function: { name: 'finish', arguments: JSON.stringify({ summary: 'Created agent-output.md', success: true }) },
            });
          }
          turn++;
          res.end(JSON.stringify({ choices: [{ message: { content: '', tool_calls: toolCalls } }] }));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });
    });

    server.listen(0, 'localhost', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

async function createTempGitRepo(repoPath: string): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(path.join(repoPath, 'README.md'), '# temp\n', 'utf-8');
  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "agent@omega.local"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Omega Agent"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
  execSync('git commit -m "init"', { cwd: repoPath, stdio: 'ignore' });
}

describe('harness agent loop', () => {
  let server: ReturnType<typeof spawn> | undefined;
  let mockLlm: Awaited<ReturnType<typeof startMockLlmServer>> | undefined;
  const dbDir = `/tmp/harness-agent-e2e-${Date.now()}`;
  const repoPath = `/tmp/harness-agent-e2e-${Date.now()}`;
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://localhost:5432/omega',
    DATABASE_DIR: dbDir,
    PORT: '4003',
    GRPC_PORT: '50053',
    KIMI_API_KEY: '',
  };

  beforeAll(async () => {
    mockLlm = await startMockLlmServer();
    await createTempGitRepo(repoPath);

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
        name: 'agent-mock',
        kind: 'kimi',
        baseUrl: `http://localhost:${mockLlm.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'moonshot-v1-8k',
        capabilities: [{ name: 'moonshot-v1-8k', level: 'advanced', supportsTools: true }],
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

  it('runs an agent task, records steps/traces/diffs', async () => {
    const projectRes = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'agent-e2e', path: repoPath }),
    });
    expect(projectRes.status).toBe(201);
    const project = (await projectRes.json()) as { id: string };

    const taskRes = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: 'Create agent-output.md',
        description: 'Create a markdown file demonstrating the agent worked.',
        complexity: 'complex',
        tags: ['agent'],
      }),
    });
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

    const runRes = await fetch(`${API}/tasks/${task.id}/run`, { method: 'POST' });
    if (!runRes.ok) {
      const errBody = await runRes.text();
      console.error('Run failed:', runRes.status, errBody);
    }
    expect(runRes.status).toBe(200);
    const ran = (await runRes.json()) as { status: string; result?: string; error?: string };

    if (ran.status !== 'done') {
      console.error('Agent task failed:', ran.error);
    }
    expect(ran.status).toBe('done');
    expect(ran.error).toBeFalsy();

    const stepsRes = await fetch(`${API}/tasks/${task.id}/steps`);
    expect(stepsRes.status).toBe(200);
    const steps = (await stepsRes.json()) as { name: string; status: string }[];
    expect(steps.length).toBeGreaterThan(0);

    const tracesRes = await fetch(`${API}/tasks/${task.id}/traces`);
    expect(tracesRes.status).toBe(200);
    const traces = (await tracesRes.json()) as { role: string }[];
    expect(traces.some((t) => t.role === 'assistant')).toBe(true);

    const diffsRes = await fetch(`${API}/tasks/${task.id}/diffs`);
    expect(diffsRes.status).toBe(200);
    const diffs = (await diffsRes.json()) as { patch: string }[];
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].patch).toContain('agent-output.md');

    const agentRunRes = await fetch(`${API}/tasks/${task.id}/agent-run`);
    expect(agentRunRes.status).toBe(200);
    const agentRun = (await agentRunRes.json()) as { resultStatus: string; branch: string };
    expect(agentRun.resultStatus).toBe('done');
    expect(agentRun.branch).toContain(task.id);
  }, 120000);
});
