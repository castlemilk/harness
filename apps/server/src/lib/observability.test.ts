import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTempoTrace, getHotspots, normalizeTempoTrace } from './observability.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TEMPO_QUERY_URL;
});

const TRACE_ID = 'a'.repeat(32);

const tempoPayload = {
  batches: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'omega-harness' } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: TRACE_ID,
              spanId: '1'.repeat(16),
              name: 'flow.run',
              kind: 'SPAN_KIND_INTERNAL',
              startTimeUnixNano: '1000000000',
              endTimeUnixNano: '3000000000',
              attributes: [{ key: 'omega.task.id', value: { stringValue: 'task-1' } }],
              status: { code: 'STATUS_CODE_OK' },
              events: [
                {
                  timeUnixNano: '2000000000',
                  name: 'cuttlefish.run.status',
                  attributes: [{ key: 'status', value: { stringValue: 'RUNNING' } }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'cuttlefish-controlplane' } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: TRACE_ID,
              spanId: '2'.repeat(16),
              parentSpanId: '1'.repeat(16),
              name: 'POST /api/runs/start',
              kind: 'SPAN_KIND_SERVER',
              startTimeUnixNano: '1500000000',
              endTimeUnixNano: '2500000000',
              status: 2,
              attributes: [{ key: 'http.response.status_code', value: { intValue: '500' } }],
            },
          ],
        },
      ],
    },
  ],
};

describe('normalizeTempoTrace', () => {
  it('flattens OTLP batches into spans with service, timing and status', () => {
    const trace = normalizeTempoTrace(TRACE_ID, tempoPayload);
    expect(trace.spanCount).toBe(2);
    expect(trace.services).toEqual(['cuttlefish-controlplane', 'omega-harness']);
    expect(trace.durationMs).toBe(2000);

    const flow = trace.spans.find((s) => s.name === 'flow.run');
    expect(flow?.service).toBe('omega-harness');
    expect(flow?.status).toBe('ok');
    expect(flow?.durationMs).toBe(2000);
    expect(flow?.attributes['omega.task.id']).toBe('task-1');
    expect(flow?.events[0]?.name).toBe('cuttlefish.run.status');

    const controlplane = trace.spans.find((s) => s.service === 'cuttlefish-controlplane');
    expect(controlplane?.parentSpanId).toBe('1'.repeat(16));
    expect(controlplane?.status).toBe('error');
    expect(controlplane?.attributes['http.response.status_code']).toBe(500);
  });

  it('fetches and normalizes a trace from Tempo', async () => {
    const fetchMock = vi.fn(async (_url: string | URL) => new Response(JSON.stringify(tempoPayload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.TEMPO_QUERY_URL = 'http://tempo.test:3200';

    const trace = await fetchTempoTrace(TRACE_ID);
    expect(trace?.spanCount).toBe(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/api/traces/${TRACE_ID}`);
  });

  it('rejects malformed trace ids without calling Tempo', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTempoTrace('not-a-trace')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function vector(metric: Record<string, string>, value: number) {
  return { metric, value: [1_700_000_000, String(value)] };
}

describe('getHotspots', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MIMIR_QUERY_URL;
  });

  it('ranks operations by p95 latency from spanmetrics', async () => {
    process.env.MIMIR_QUERY_URL = 'http://mimir.test:9009';
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/ready')) return new Response('ready', { status: 200 });
      if (href.includes('/label/__name__/values')) {
        return new Response(
          JSON.stringify({ status: 'success', data: ['traces_spanmetrics_calls_total', 'traces_spanmetrics_latency_bucket'] }),
          { status: 200 }
        );
      }
      const expr = decodeURIComponent(new URL(href).searchParams.get('query') ?? '');
      if (expr.includes('status_code=~')) {
        return new Response(
          JSON.stringify({ status: 'success', data: { result: [vector({ service_name: 'omega-harness', span_name: 'flow.run' }, 0.02)] } }),
          { status: 200 }
        );
      }
      if (expr.includes('histogram_quantile(0.5')) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { result: [
              vector({ service_name: 'omega-harness', span_name: 'flow.run' }, 120),
              vector({ service_name: 'cuttlefish-controlplane', span_name: 'POST /api/runs/start' }, 40),
            ] },
          }),
          { status: 200 }
        );
      }
      if (expr.includes('histogram_quantile(0.95')) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { result: [
              vector({ service_name: 'omega-harness', span_name: 'flow.run' }, 400),
              vector({ service_name: 'cuttlefish-controlplane', span_name: 'POST /api/runs/start' }, 90),
            ] },
          }),
          { status: 200 }
        );
      }
      if (expr.includes('histogram_quantile(0.99')) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { result: [
              vector({ service_name: 'omega-harness', span_name: 'flow.run' }, 900),
              vector({ service_name: 'cuttlefish-controlplane', span_name: 'POST /api/runs/start' }, 150),
            ] },
          }),
          { status: 200 }
        );
      }
      if (expr.includes('calls_total') && expr.includes('rate')) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { result: [
              vector({ service_name: 'omega-harness', span_name: 'flow.run' }, 0.5),
              vector({ service_name: 'cuttlefish-controlplane', span_name: 'POST /api/runs/start' }, 0.5),
            ] },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ status: 'success', data: { result: [] } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getHotspots({ window: '15m', limit: 5 });
    expect(result.available).toBe(true);
    expect(result.metrics).toEqual({
      calls: 'traces_spanmetrics_calls_total',
      duration: 'traces_spanmetrics_latency_bucket',
    });
    expect(result.entries[0]).toMatchObject({
      service: 'omega-harness',
      operation: 'flow.run',
      p50Ms: 120,
      p95Ms: 400,
      p99Ms: 900,
      callsPerSec: 0.5,
    });
    expect(result.entries[0].errorRate).toBeCloseTo(0.04, 5);
    expect(result.byService[0]?.service).toBe('omega-harness');
  });

  it('reports Mimir as unavailable when /ready fails', async () => {
    process.env.MIMIR_QUERY_URL = 'http://mimir.test:9009';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const result = await getHotspots();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('not reachable');
  });
});
