import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HarnessApiClient } from './api-client.js';
import { createHarnessMcpServer, resolveHarnessApiUrl } from './server.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function connectWith(fetchImpl: typeof fetch) {
  const api = new HarnessApiClient({ baseUrl: 'http://localhost:4000', fetchImpl });
  const server = createHarnessMcpServer({ client: api });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'harness-test', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe('harness MCP server', () => {
  it('registers project, task, run and runtime tools', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const { client, server } = await connectWith(fetchImpl);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'omega_harness_info',
          'omega_projects_list',
          'omega_project_create',
          'omega_tasks_list',
          'omega_task_create',
          'omega_task_run',
          'omega_task_cancel',
          'omega_runs_list',
          'omega_runtimes_list',
          'omega_runtime_health',
          'omega_flow_start',
          'omega_flows_list',
          'omega_flow_cancel',
        ])
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('proxies tool calls to the harness API', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse({ tasks: [{ id: 't1', title: 'demo' }] });
    }) as unknown as typeof fetch;
    const { client, server } = await connectWith(fetchImpl);
    try {
      const result = await client.callTool({ name: 'omega_tasks_list', arguments: { limit: 5 } });
      expect(calls[0]).toBe('http://localhost:4000/v1/tasks?limit=5');
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('"demo"');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('surfaces API errors as MCP tool errors', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Task not found' }, 404)) as unknown as typeof fetch;
    const { client, server } = await connectWith(fetchImpl);
    try {
      const result = await client.callTool({ name: 'omega_task_get', arguments: { taskId: 'missing' } });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('Task not found');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('resolves the API url from the environment', () => {
    expect(resolveHarnessApiUrl({ OMEGA_API_URL: 'http://harness.internal:9000/' })).toBe('http://harness.internal:9000');
    expect(resolveHarnessApiUrl({ PORT: '4321' })).toBe('http://127.0.0.1:4321');
  });
});
