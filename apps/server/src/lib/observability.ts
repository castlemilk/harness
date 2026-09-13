import type { FlowRun, PrismaClient, RuntimeConnection, Task } from '@omega/db';
import { createRuntimeClient } from './runtime-connections.js';

/**
 * Queries for the distributed trace pipeline: spans live in Tempo, span-derived
 * metrics (service + operation latency/calls/errors) live in Mimir. Both are
 * optional — when unreachable the API degrades to database trace rows.
 */

const DEFAULT_TIMEOUT_MS = 5_000;

export function tempoQueryUrl(): string {
  const configured = process.env.TEMPO_QUERY_URL?.trim();
  return (configured && configured.length > 0 ? configured : 'http://127.0.0.1:13200').replace(/\/+$/, '');
}

export function mimirQueryUrl(): string {
  const configured = process.env.MIMIR_QUERY_URL?.trim();
  return (configured && configured.length > 0 ? configured : 'http://127.0.0.1:9009').replace(/\/+$/, '');
}

async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Tempo / OTLP span normalization ────────────────────────────────────────

export interface TraceSpanView {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  kind: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, unknown>;
  events: { timeMs: number; name: string; attributes?: Record<string, unknown> }[];
}

export interface TraceView {
  traceId: string;
  source: 'tempo' | 'database';
  services: string[];
  spanCount: number;
  startTimeMs: number;
  durationMs: number;
  spans: TraceSpanView[];
}

interface OtlpAttribute {
  key: string;
  value?: Record<string, unknown>;
}

function decodeAttributeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if ('stringValue' in v) return v.stringValue;
  if ('boolValue' in v) return v.boolValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) {
    const arr = v.arrayValue as { values?: unknown[] } | undefined;
    return (arr?.values ?? []).map(decodeAttributeValue);
  }
  if ('kvlistValue' in v) {
    const kv = v.kvlistValue as { values?: { key: string; value: unknown }[] } | undefined;
    return Object.fromEntries((kv?.values ?? []).map((entry) => [entry.key, decodeAttributeValue(entry.value)]));
  }
  return value;
}

function decodeAttributes(attributes: unknown): Record<string, unknown> {
  if (!Array.isArray(attributes)) return {};
  const out: Record<string, unknown> = {};
  for (const raw of attributes as unknown[]) {
    if (raw === null || typeof raw !== 'object') continue;
    const attr = raw as OtlpAttribute;
    if (typeof attr.key !== 'string') continue;
    out[attr.key] = decodeAttributeValue(attr.value);
  }
  return out;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

function decodeStatus(status: unknown): 'ok' | 'error' | 'unset' {
  const code =
    typeof status === 'object' && status !== null
      ? (status as Record<string, unknown>).code
      : status;
  if (code === 2 || code === 'STATUS_CODE_ERROR') return 'error';
  if (code === 1 || code === 'STATUS_CODE_OK') return 'ok';
  return 'unset';
}

function nanos(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n / 1_000_000 : 0;
}

/** Normalizes Tempo's OTLP-JSON trace response into a flat span list. */
export function normalizeTempoTrace(traceId: string, payload: unknown): TraceView {
  const root = payload as { batches?: unknown[]; resourceSpans?: unknown[] };
  const batches = (root.batches ?? root.resourceSpans ?? []) as Record<string, unknown>[];
  const spans: TraceSpanView[] = [];
  const services = new Set<string>();

  for (const batch of batches) {
    const resource = (batch.resource ?? {}) as { attributes?: unknown };
    const serviceAttrs = decodeAttributes(resource.attributes);
    const service = typeof serviceAttrs['service.name'] === 'string'
      ? serviceAttrs['service.name']
      : 'unknown';
    services.add(service);

    const scopeSpans = (batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? []) as Record<string, unknown>[];
    for (const scopeSpan of scopeSpans) {
      const rawSpans = (scopeSpan.spans ?? []) as Record<string, unknown>[];
      for (const raw of rawSpans) {
        const startTimeMs = nanos(raw.startTimeUnixNano);
        const endTimeMs = nanos(raw.endTimeUnixNano);
        const rawKind = raw.kind;
        spans.push({
          traceId: typeof raw.traceId === 'string' ? raw.traceId : traceId,
          spanId: toText(raw.spanId),
          parentSpanId: typeof raw.parentSpanId === 'string' && raw.parentSpanId.length > 0
            ? raw.parentSpanId
            : undefined,
          name: toText(raw.name) || 'unnamed',
          service,
          kind: typeof rawKind === 'string' ? rawKind.replace('SPAN_KIND_', '').toLowerCase() : 'internal',
          startTimeMs,
          endTimeMs,
          durationMs: Math.max(0, endTimeMs - startTimeMs),
          status: decodeStatus(raw.status),
          attributes: decodeAttributes(raw.attributes),
          events: Array.isArray(raw.events)
            ? (raw.events as Record<string, unknown>[]).map((event) => ({
                timeMs: nanos(event.timeUnixNano),
                name: toText(event.name) || 'event',
                attributes: decodeAttributes(event.attributes),
              }))
            : [],
        });
      }
    }
  }

  spans.sort((a, b) => a.startTimeMs - b.startTimeMs);
  const startTimeMs = spans.length > 0 ? Math.min(...spans.map((s) => s.startTimeMs)) : 0;
  const endTimeMs = spans.length > 0 ? Math.max(...spans.map((s) => s.endTimeMs)) : 0;
  return {
    traceId,
    source: 'tempo',
    services: [...services].sort(),
    spanCount: spans.length,
    startTimeMs,
    durationMs: Math.max(0, endTimeMs - startTimeMs),
    spans,
  };
}

export async function fetchTempoTrace(traceId: string): Promise<TraceView | null> {
  if (!/^[0-9a-f]{32}$/i.test(traceId)) return null;
  try {
    const payload = await fetchJson<unknown>(`${tempoQueryUrl()}/api/traces/${encodeURIComponent(traceId)}`);
    return normalizeTempoTrace(traceId, payload);
  } catch {
    return null;
  }
}

// ─── Mimir / span metrics hotspots ──────────────────────────────────────────

interface PromVectorSample {
  metric: Record<string, string | undefined>;
  value: [number, string];
}

async function mimirQuery(expr: string): Promise<PromVectorSample[]> {
  const url = `${mimirQueryUrl()}/prometheus/api/v1/query?query=${encodeURIComponent(expr)}`;
  const payload = await fetchJson<{ status: string; data?: { result?: PromVectorSample[] } }>(url);
  return payload.data?.result ?? [];
}

async function mimirMetricNames(): Promise<string[]> {
  const match = encodeURIComponent('{__name__=~"traces_spanmetrics.*"}');
  const url = `${mimirQueryUrl()}/prometheus/api/v1/label/__name__/values?match[]=${match}`;
  const payload = await fetchJson<{ status: string; data?: string[] }>(url);
  return payload.data ?? [];
}

function sampleValue(sample: PromVectorSample | undefined): number {
  if (!sample) return 0;
  const parsed = Number(sample.value[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface Hotspot {
  service: string;
  operation: string;
  callsPerSec: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface HotspotsResult {
  available: boolean;
  reason?: string;
  window: string;
  queryUrl: string;
  metrics: { calls?: string; duration?: string };
  entries: Hotspot[];
  byService: { service: string; callsPerSec: number; p95Ms: number; errorRate: number }[];
  generatedAt: string;
}

function parseWindowMs(window: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(window);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'ms') return value;
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60 * 1000;
  return value * 60 * 60 * 1000;
}

function keyOf(metric: Record<string, string | undefined>): string {
  return `${metric.service_name ?? 'unknown'}|${metric.span_name ?? 'unknown'}`;
}

function mergeHotspots(
  calls: PromVectorSample[],
  errors: PromVectorSample[],
  quantiles: { p50: PromVectorSample[]; p95: PromVectorSample[]; p99: PromVectorSample[] }
): Hotspot[] {
  const byKey = new Map<string, Hotspot>();

  const upsert = (metric: Record<string, string | undefined>): Hotspot => {
    const key = keyOf(metric);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        service: metric.service_name ?? 'unknown',
        operation: metric.span_name ?? 'unknown',
        callsPerSec: 0,
        errorRate: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      };
      byKey.set(key, entry);
    }
    return entry;
  };

  for (const sample of calls) upsert(sample.metric).callsPerSec = sampleValue(sample);
  for (const sample of quantiles.p50) upsert(sample.metric).p50Ms = sampleValue(sample);
  for (const sample of quantiles.p95) upsert(sample.metric).p95Ms = sampleValue(sample);
  for (const sample of quantiles.p99) upsert(sample.metric).p99Ms = sampleValue(sample);

  const errorCounts = new Map<string, number>();
  for (const sample of errors) {
    const key = keyOf(sample.metric);
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + sampleValue(sample));
  }
  for (const [key, entry] of byKey) {
    const errs = errorCounts.get(key) ?? 0;
    entry.errorRate = entry.callsPerSec > 0 ? errs / entry.callsPerSec : 0;
  }

  return [...byKey.values()].sort((a, b) => b.p95Ms - a.p95Ms);
}

/**
 * Ranks service/operation pairs by p95 latency using spanmetrics recorded in
 * Mimir. Metric names are discovered so collector/connector version changes
 * don't silently break the endpoint.
 */
export async function getHotspots(options: { window?: string; limit?: number } = {}): Promise<HotspotsResult> {
  const window = options.window ?? '15m';
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const result: HotspotsResult = {
    available: false,
    window,
    queryUrl: mimirQueryUrl(),
    metrics: {},
    entries: [],
    byService: [],
    generatedAt: new Date().toISOString(),
  };

  if (!(await ping(`${mimirQueryUrl()}/ready`))) {
    result.reason = `Mimir not reachable at ${mimirQueryUrl()}`;
    return result;
  }

  let names: string[];
  try {
    names = await mimirMetricNames();
  } catch {
    result.reason = 'Mimir spanmetrics series not found (yet)';
    return result;
  }
  const callsName = names.find((n) => n.endsWith('_calls_total') || n.endsWith('_calls'));
  const durationName = names.find((n) => n.includes('duration') || n.includes('latency'));
  if (!callsName || !durationName) {
    result.reason = 'spanmetrics metrics not exported yet';
    result.metrics = { calls: callsName, duration: durationName };
    return result;
  }
  const durationBucket = durationName.endsWith('_bucket') ? durationName : `${durationName}_bucket`;
  result.metrics = { calls: callsName, duration: durationName };

  const windowMs = parseWindowMs(window);
  const range = `${String(Math.max(30, Math.round(windowMs / 1000)))}s`;
  const callsExpr = `sum by (service_name, span_name) (rate(${callsName}{}[${range}]))`;
  const errorsExpr = `sum by (service_name, span_name) (rate(${callsName}{status_code=~"STATUS_CODE_ERROR|2"}[${range}]))`;
  const quantile = (q: number): string =>
    `histogram_quantile(${String(q)}, sum by (le, service_name, span_name) (rate(${durationBucket}[${range}])))`;

  try {
    const [calls, errors, p50, p95, p99] = await Promise.all([
      mimirQuery(callsExpr),
      mimirQuery(errorsExpr).catch(() => [] as PromVectorSample[]),
      mimirQuery(quantile(0.5)).catch(() => [] as PromVectorSample[]),
      mimirQuery(quantile(0.95)).catch(() => [] as PromVectorSample[]),
      mimirQuery(quantile(0.99)).catch(() => [] as PromVectorSample[]),
    ]);
    const entries = mergeHotspots(calls, errors, { p50, p95, p99 });
    result.entries = entries.slice(0, limit);
    result.available = entries.length > 0;
    if (!result.available) result.reason = 'no span samples in the selected window';

    const serviceTotals = new Map<string, { callsPerSec: number; weightedP95: number; weightedErr: number }>();
    for (const entry of entries) {
      const total = serviceTotals.get(entry.service) ?? { callsPerSec: 0, weightedP95: 0, weightedErr: 0 };
      total.callsPerSec += entry.callsPerSec;
      total.weightedP95 += entry.p95Ms * entry.callsPerSec;
      total.weightedErr += entry.errorRate * entry.callsPerSec;
      serviceTotals.set(entry.service, total);
    }
    result.byService = [...serviceTotals.entries()]
      .map(([service, total]) => ({
        service,
        callsPerSec: total.callsPerSec,
        p95Ms: total.callsPerSec > 0 ? total.weightedP95 / total.callsPerSec : 0,
        errorRate: total.callsPerSec > 0 ? total.weightedErr / total.callsPerSec : 0,
      }))
      .sort((a, b) => b.p95Ms - a.p95Ms);
  } catch (err) {
    result.reason = err instanceof Error ? err.message : String(err);
  }
  return result;
}

// ─── Flow trace assembly ────────────────────────────────────────────────────

export interface FlowTraceResult {
  flowId: string;
  traceId: string | null;
  source: 'tempo' | 'database' | 'none';
  trace: TraceView | null;
  databaseSpans: {
    traceId: string;
    spanId: string;
    parentId: string | null;
    name: string;
    startTime: string;
    endTime: string | null;
    status: string;
    attributes: unknown;
  }[];
  runnerTrace: unknown;
  flow: FlowRun & { runtime?: RuntimeConnection | null; task?: Task | null };
}

type FlowWithRelations = FlowRun & { runtime?: RuntimeConnection | null; task?: Task | null };

export async function buildFlowTrace(prisma: PrismaClient, flowId: string): Promise<FlowTraceResult | null> {
  const flow = (await prisma.flowRun.findUnique({
    where: { id: flowId },
    include: { runtime: true, task: true },
  })) as FlowWithRelations | null;
  if (!flow) return null;

  const traceId = flow.traceId ?? null;
  const trace = traceId ? await fetchTempoTrace(traceId) : null;

  const databaseSpans = flow.taskId
    ? await prisma.traceSpan.findMany({
        where: { taskId: flow.taskId },
        orderBy: { startTime: 'asc' },
      })
    : [];

  let runnerTrace: unknown = null;
  if (flow.runtime) {
    try {
      const client = createRuntimeClient(flow.runtime);
      runnerTrace = await client.getWorkflowRunTrace(flow.externalRunId);
    } catch {
      // Runner trace is enrichment; absence is normal (history may be disabled).
    }
  }

  return {
    flowId: flow.id,
    traceId: trace?.traceId ?? traceId,
    source: trace ? 'tempo' : databaseSpans.length > 0 ? 'database' : 'none',
    trace,
    databaseSpans: databaseSpans.map((span) => ({
      traceId: span.traceId,
      spanId: span.spanId,
      parentId: span.parentId,
      name: span.name,
      startTime: span.startTime.toISOString(),
      endTime: span.endTime?.toISOString() ?? null,
      status: span.status,
      attributes: parseJsonOrNull(span.attributes),
    })),
    runnerTrace,
    flow,
  };
}

function parseJsonOrNull(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function observabilityStatus(): Promise<Record<string, unknown>> {
  const [tempoOk, mimirOk] = await Promise.all([
    ping(`${tempoQueryUrl()}/ready`),
    ping(`${mimirQueryUrl()}/ready`),
  ]);
  return {
    tracing: {
      enabled: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()),
      otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'omega-harness',
      sampler: process.env.OTEL_TRACES_SAMPLER ?? 'parentbased_always_on',
    },
    tempo: { url: tempoQueryUrl(), ok: tempoOk },
    mimir: { url: mimirQueryUrl(), ok: mimirOk },
  };
}
