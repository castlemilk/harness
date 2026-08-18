import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDataSource,
  DataSourceError,
  resolveBaseUrl,
  type UseCaseDataSourceConfig,
} from './data-source.js';

/**
 * The plugin-facing half of the data seam: where a shell's backend resolves to,
 * what a failure carries, and that the Connect call really is the wire format
 * the omega Go API serves.
 */

const config: UseCaseDataSourceConfig = {
  id: 'omega-api',
  label: 'Omega API',
  baseUrl: 'http://localhost:8080',
  envVar: 'VITE_UC_OMEGA_API_URL',
  probePath: '/api/v1/dashboard/status',
};

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(
  respond: (req: CapturedRequest) => Response | Promise<Response>,
): CapturedRequest[] {
  const calls: CapturedRequest[] = [];
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const req = { url: String(input), init };
    calls.push(req);
    return Promise.resolve(respond(req));
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('resolveBaseUrl', () => {
  it('uses the declared default when the env var is unset', () => {
    expect(resolveBaseUrl(config)).toBe('http://localhost:8080');
    expect(resolveBaseUrl({ ...config, envVar: undefined })).toBe('http://localhost:8080');
  });

  it('lets the env override win, so an operator can repoint a shell', () => {
    vi.stubEnv('VITE_UC_OMEGA_API_URL', 'https://omega.internal:8443');
    expect(resolveBaseUrl(config)).toBe('https://omega.internal:8443');
    expect(createDataSource(config).config.baseUrl).toBe('https://omega.internal:8443');
  });

  it('ignores an empty override rather than pointing the shell at nothing', () => {
    vi.stubEnv('VITE_UC_OMEGA_API_URL', '');
    expect(resolveBaseUrl(config)).toBe('http://localhost:8080');
  });

  it('strips a trailing slash so paths do not double up', () => {
    expect(resolveBaseUrl({ ...config, baseUrl: 'http://localhost:8080/' })).toBe(
      'http://localhost:8080',
    );
  });
});

describe('getJson', () => {
  it('fetches against the resolved base url', async () => {
    const calls = stubFetch(() => json([{ id: 'a' }]));
    const rows = await createDataSource(config).getJson<{ id: string }[]>('/foreman/objectives');
    expect(rows).toEqual([{ id: 'a' }]);
    expect(calls[0].url).toBe('http://localhost:8080/foreman/objectives');
  });

  it('throws an error carrying the status and a bounded body excerpt', async () => {
    stubFetch(() => new Response('x'.repeat(1000), { status: 503 }));
    const err = await createDataSource(config)
      .getJson('/boom')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DataSourceError);
    const failure = err as DataSourceError;
    expect(failure.status).toBe(503);
    expect(failure.bodyExcerpt).toHaveLength(401); // 400 chars plus the ellipsis
    expect(failure.message).toContain('Omega API: GET /boom failed: 503');
  });
});

describe('postConnect', () => {
  it('posts Connect-JSON to /<service>/<method> with the protocol header', async () => {
    const calls = stubFetch(() => json({ portfolioValue: 12 }));
    const out = await createDataSource(config).postConnect<{ portfolioValue: number }>(
      'omega.v1.VictoriaService',
      'GetPortfolio',
      { limit: 5 },
    );

    expect(out.portfolioValue).toBe(12);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/omega.v1.VictoriaService/GetPortfolio');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toEqual({
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    });
    expect(calls[0].init?.body).toBe('{"limit":5}');
  });

  it('names the method in the failure, not just the status', async () => {
    stubFetch(() => new Response('{"code":"unimplemented"}', { status: 404 }));
    await expect(
      createDataSource(config).postConnect('omega.v1.VictoriaService', 'GetSignals'),
    ).rejects.toThrow('Omega API: omega.v1.VictoriaService/GetSignals failed: 404 {"code":"unimplemented"}');
  });
});

describe('probe', () => {
  it('reports ok with a latency when the probe path answers 2xx', async () => {
    const calls = stubFetch(() => json({ status: 'healthy' }));
    const result = await createDataSource(config).probe();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.latencyMs)).toBe(true);
    expect(calls[0].url).toBe('http://localhost:8080/api/v1/dashboard/status');
  });

  it('carries the status when the backend answers but is unhealthy', async () => {
    stubFetch(() => new Response('', { status: 502 }));
    expect(await createDataSource(config).probe()).toMatchObject({
      ok: false,
      error: 'HTTP 502',
    });
  });

  it('carries the transport error when the backend is not there at all', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('Failed to fetch')));
    expect(await createDataSource(config).probe()).toEqual({
      ok: false,
      error: 'Failed to fetch',
    });
  });

  it('falls back to the base url when no probe path is declared', async () => {
    const calls = stubFetch(() => json({}));
    await createDataSource({ ...config, probePath: undefined }).probe();
    expect(calls[0].url).toBe('http://localhost:8080/');
  });
});

describe('sse', () => {
  it('opens against the resolved url and closes through the returned function', () => {
    const closed: string[] = [];
    const opened: string[] = [];
    class StubEventSource {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      constructor(readonly url: string) {
        opened.push(url);
      }
      close() {
        closed.push(this.url);
      }
    }
    vi.stubGlobal('EventSource', StubEventSource);

    const close = createDataSource(config).sse('/stream', () => undefined);
    expect(opened).toEqual(['http://localhost:8080/stream']);
    expect(closed).toEqual([]);
    close();
    expect(closed).toEqual(['http://localhost:8080/stream']);
  });

  it('closes when the caller aborts the signal it passed', () => {
    const closed: string[] = [];
    class StubEventSource {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      constructor(readonly url: string) {}
      close() {
        closed.push(this.url);
      }
    }
    vi.stubGlobal('EventSource', StubEventSource);

    const controller = new AbortController();
    createDataSource(config).sse('/stream', () => undefined, { signal: controller.signal });
    controller.abort();
    expect(closed).toEqual(['http://localhost:8080/stream']);
  });
});
