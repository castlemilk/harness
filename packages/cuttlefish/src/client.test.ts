import { describe, it, expect, vi } from 'vitest';
import { CuttlefishApiError, CuttlefishClient } from './client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof CuttlefishClient>[0]> = {}) {
  return new CuttlefishClient({
    baseUrl: 'http://localhost:4444',
    token: 'cf_sa_test',
    projectId: 'proj-1',
    fetchImpl,
    ...overrides,
  });
}

describe('CuttlefishClient', () => {
  it('sends auth and project headers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ runs: [] })) as unknown as typeof fetch;
    await client(fetchImpl).listRuns();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4444/api/runs');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer cf_sa_test');
    expect(headers['x-cuttle-project']).toBe('proj-1');
  });

  it('starts a run and parses the response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ run: { id: 'run-1', status: 'QUEUED' }, taskInstances: [] }),
    ) as unknown as typeof fetch;
    const result = await client(fetchImpl).startRun({
      workflowYAML: 'apiVersion: cuttlefish.dev/v1alpha1',
      inputs: { taskTitle: 'hi' },
    });
    expect(result.run.id).toBe('run-1');
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      workflowYAML: 'apiVersion: cuttlefish.dev/v1alpha1',
      inputs: { taskTitle: 'hi' },
    });
  });

  it('raises CuttlefishApiError with status and body on failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)) as unknown as typeof fetch;
    await expect(client(fetchImpl).listWorkflows()).rejects.toMatchObject({
      name: 'CuttlefishApiError',
      status: 401,
    });
  });

  it('returns null for a missing run instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'not found' }, 404)) as unknown as typeof fetch;
    await expect(client(fetchImpl).getRun('missing')).resolves.toBeNull();
  });

  it('resolves a workflow name to its latest published version', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = String(url);
      if (path.endsWith('/api/workflows')) {
        return jsonResponse({ workflows: [{ id: 'wf-1', name: 'sleepy' }] });
      }
      if (path.endsWith('/api/workflows/wf-1/versions')) {
        return jsonResponse({
          versions: [
            { id: 'v1', versionNum: 1 },
            { id: 'v2', versionNum: 2 },
          ],
        });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
    await expect(client(fetchImpl).resolveWorkflowVersionId('sleepy')).resolves.toBe('v2');
  });

  it('passes a UUID through as a workflow version id', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const uuid = '99999999-8888-7777-6666-555555555555';
    await expect(client(fetchImpl).resolveWorkflowVersionId(uuid)).resolves.toBe(uuid);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('collects run logs from the per-attempt response shape', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        attempts: [
          { nodeId: 'hello', logText: 'hello from cuttlefish\n' },
          { nodeId: 'world', logText: '' },
        ],
      }),
    ) as unknown as typeof fetch;
    const logs = await client(fetchImpl).getRunLogs('run-1');
    expect(logs).toContain('hello from cuttlefish');
    expect(logs).toContain('[hello]');
  });

  it('passes through a plain logs string response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ logs: 'line one\nline two' })) as unknown as typeof fetch;
    await expect(client(fetchImpl).getRunLogs('run-1')).resolves.toBe('line one\nline two');
  });

  it('health returns false on failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new CuttlefishApiError('boom', 0);
    }) as unknown as typeof fetch;
    await expect(client(fetchImpl).health()).resolves.toBe(false);
  });
});
