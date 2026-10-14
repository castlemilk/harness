import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');

/**
 * End-to-end coverage for the standalone MCP server and its runtime execution
 * loop.
 *
 * The whole chain runs for real: MCP stdio transport -> embedded express app ->
 * prisma/PGlite -> run endpoint -> agent executor -> provider -> status poll ->
 * terminal state. Nothing is stubbed except the LLM itself.
 *
 * Footprint is deliberately tiny, so this is cheap enough to run routinely:
 *   - one MCP child process (no separately-started harness server, no gRPC)
 *   - one in-process mock LLM on an ephemeral port
 *   - a throwaway PGlite directory (~40MB) removed on teardown
 *   - no Docker, no cuttlefish, no real API keys, no real provider calls
 *
 * Requires a prior `pnpm -r build` (the CLI is spawned from dist).
 */

interface JsonRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

/** Minimal MCP stdio client: handshake, then request/response over stdin. */
class McpStdioClient {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, (value: JsonRpcResponse) => void>();
  stderr = '';

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let index = this.buffer.indexOf('\n');
      while (index !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line.length > 0) {
          try {
            const message = JSON.parse(line) as JsonRpcResponse;
            if (typeof message.id === 'number') {
              this.pending.get(message.id)?.(message);
              this.pending.delete(message.id);
            }
          } catch {
            // Not JSON-RPC framing; ignore partial/other output.
          }
        }
        index = this.buffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'omega-e2e', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  request(method: string, params: unknown, timeoutMs = 60_000): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const message = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${String(timeoutMs)}ms\nstderr:\n${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      this.child.stdin.write(message);
    });
  }

  /** Calls a tool and returns its parsed JSON payload, failing on tool errors. */
  async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const response = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    if (response.error) throw new Error(`MCP error calling ${name}: ${response.error.message}`);
    const result = response.result as unknown as ToolResult;
    const text = result.content?.[0]?.text ?? '';
    if (result.isError) throw new Error(`tool ${name} failed: ${text}`);
    return JSON.parse(text) as unknown;
  }
}

function startMockLlmServer(): Promise<{ server: http.Server; port: number; requests: unknown[] }> {
  return new Promise((resolve) => {
    const requests: unknown[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer | string) => {
        body += String(chunk);
      });
      req.on('end', () => {
        try {
          requests.push(JSON.parse(body));
        } catch {
          requests.push(body);
        }
        if (req.url?.startsWith('/v1/chat/completions')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      'Machine learning is a subset of artificial intelligence that lets systems learn from data rather than explicit rules.',
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

/** Waits for the child's stderr banner that the embedded API is listening. */
async function waitForEmbeddedApi(
  client: McpStdioClient,
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 60_000
): Promise<string> {
  const banner = /embedded API ready at (\S+)/;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = banner.exec(client.stderr);
    if (match?.[1]) return match[1];
    if (child.exitCode !== null) {
      throw new Error(`MCP server exited early (code ${String(child.exitCode)})\nstderr:\n${client.stderr}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`embedded API did not come up in ${String(timeoutMs)}ms\nstderr:\n${client.stderr}`);
}

describe('standalone MCP server e2e', () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let client: McpStdioClient | undefined;
  let mockLlm: Awaited<ReturnType<typeof startMockLlmServer>> | undefined;
  let tmpRoot: string;
  let apiBase = '';

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-mcp-e2e-'));
    mockLlm = await startMockLlmServer();

    child = spawn(process.execPath, ['apps/cli/dist/index.js', 'mcp', '--standalone'], {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        // Fresh throwaway database; the embedded bootstrap migrates it on boot.
        DATABASE_URL: 'postgresql://localhost:5432/omega',
        DATABASE_DIR: path.join(tmpRoot, 'pglite'),
        // Blank every real provider key so a developer's ~/.env can never leak
        // into the run and spend tokens. Only the local stub below is reachable.
        OPENROUTER_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        OLLAMA_BASE_URL: 'http://127.0.0.1:1',
        // Point the seeded provider at the local stub so no real API is called.
        KIMI_API_KEY: 'test-key',
        KIMI_BASE_URL: `http://127.0.0.1:${String(mockLlm.port)}/v1`,
        // Prove no external harness server is required.
        OMEGA_API_URL: 'http://127.0.0.1:1',
      },
    }) as ChildProcessWithoutNullStreams;

    client = new McpStdioClient(child);
    apiBase = await waitForEmbeddedApi(client, child);
    await client.initialize();
  }, 120_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      // Escalate if the graceful path does not land.
      await new Promise((r) => setTimeout(r, 750));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await new Promise<void>((resolve) => {
      if (mockLlm) mockLlm.server.close(() => resolve());
      else resolve();
    });
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('advertises its tools over stdio with no external harness server', async () => {
    const response = await client?.request('tools/list', {});
    const tools = (response?.result?.tools ?? []) as { name: string }[];
    expect(tools.length).toBeGreaterThanOrEqual(30);
    const names = tools.map((t) => t.name);
    for (const expected of [
      'omega_harness_info',
      'omega_project_create',
      'omega_task_create',
      'omega_task_run',
      'omega_task_get',
      'omega_flow_start',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('reads and writes through the embedded API and prisma', async () => {
    const info = (await client?.callTool('omega_harness_info', {})) as { object: string };
    expect(info.object).toBe('harness');

    const project = (await client?.callTool('omega_project_create', {
      name: 'mcp-e2e',
      path: path.join(tmpRoot, 'project'),
    })) as { id: string; name: string };
    expect(project.id).toBeTruthy();

    // GET /v1/projects returns a bare array, not { projects: [...] }.
    const listed = (await client?.callTool('omega_projects_list', {})) as { id: string; name: string }[];
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.some((p) => p.id === project.id)).toBe(true);
  });

  it('runs a task through the execution loop to a terminal state', async () => {
    const projects = (await client?.callTool('omega_projects_list', {})) as { id: string; name: string }[];
    const projectId = projects.find((p) => p.name === 'mcp-e2e')?.id;
    expect(projectId).toBeTruthy();

    const task = (await client?.callTool('omega_task_create', {
      projectId,
      title: 'Summarize machine learning in one sentence',
      description: 'Answer in a single sentence.',
      complexity: 'simple',
    })) as { id: string };
    expect(task.id).toBeTruthy();

    // Pin the provider so the router cannot reach for anything else. This is
    // setup rather than the chain under test, and harness.e2e.test.ts pins it
    // the same way; the run itself still goes through MCP end to end.
    const patchRes = await fetch(`${apiBase}/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'kimi', model: 'k3' }),
    });
    expect(patchRes.status).toBe(200);

    // wait=true drives the runtime execution loop: dispatch, then poll the task
    // until it reaches done/failed/cancelled, bounded by waitTimeoutMs.
    const settled = (await client?.callTool(
      'omega_task_run',
      { taskId: task.id, wait: true, waitTimeoutMs: 90_000, pollIntervalMs: 500 },
      120_000
    )) as { dispatch: { status: string }; task: { status: string; result?: string; error?: string }; polls: number };

    expect(['in_progress', 'done']).toContain(settled.dispatch.status);
    expect(settled.polls).toBeGreaterThan(0);
    expect(settled.task.status).toBe('done');
    expect(settled.task.error).toBeFalsy();
    expect(settled.task.result ?? '').toContain('artificial intelligence');

    // The mock LLM must have been reached: proves the run executed a real
    // provider call through the whole chain rather than short-circuiting.
    const shapes = (mockLlm?.requests ?? []).map((r) => (typeof r === 'object' && r !== null ? Object.keys(r as object) : typeof r));
    expect(shapes.length).toBeGreaterThan(0);
    expect(
      mockLlm?.requests.some(
        (r: unknown) => typeof r === 'object' && r !== null && 'model' in (r as Record<string, unknown>)
      )
    ).toBe(true);
  }, 180_000);
});