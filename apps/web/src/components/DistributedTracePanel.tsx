import { useCallback, useEffect, useState } from 'react';
import { api, type FlowTraceResponse, type TraceSpanView } from '../lib/api.js';

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED']);
const PALETTE = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];

function serviceColor(service: string): string {
  let hash = 0;
  for (let i = 0; i < service.length; i++) hash = (hash * 31 + service.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

interface WaterfallSpan extends TraceSpanView {
  depth: number;
}

function toWaterfall(spans: TraceSpanView[]): WaterfallSpan[] {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthOf = (span: TraceSpanView, seen: Set<string>): number => {
    if (!span.parentSpanId || seen.has(span.spanId)) return 0;
    const parent = byId.get(span.parentSpanId);
    if (!parent) return 0;
    seen.add(span.spanId);
    return 1 + depthOf(parent, seen);
  };
  return spans.map((span) => ({ ...span, depth: depthOf(span, new Set()) }));
}

function SpanRow({
  span,
  minStart,
  totalMs,
}: {
  span: WaterfallSpan;
  minStart: number;
  totalMs: number;
}) {
  const [open, setOpen] = useState(false);
  const left = totalMs > 0 ? ((span.startTimeMs - minStart) / totalMs) * 100 : 0;
  const width = totalMs > 0 ? Math.max((span.durationMs / totalMs) * 100, 0.8) : 100;
  const hasDetails = Object.keys(span.attributes).length > 0 || span.events.length > 0;

  return (
    <div className="py-0.5">
      <button
        onClick={() => { setOpen((o) => !o); }}
        className="w-full text-left"
        title={hasDetails ? 'Show attributes' : undefined}
      >
        <div className="flex items-center gap-1">
          <span
            className="truncate text-[10px] text-gray-700"
            style={{ paddingLeft: `${String(span.depth * 8)}px`, maxWidth: '45%' }}
          >
            {span.name}
          </span>
          <span className={`h-2 flex-1 overflow-hidden rounded bg-gray-100 relative`}>
            <span
              className={`absolute top-0 h-2 rounded ${serviceColor(span.service)} ${span.status === 'error' ? 'opacity-60 ring-1 ring-red-500' : ''}`}
              style={{ left: `${left.toFixed(2)}%`, width: `${Math.min(width, 100 - left).toFixed(2)}%` }}
            />
          </span>
          <span className="w-14 text-right text-[10px] text-gray-500">{formatMs(span.durationMs)}</span>
        </div>
      </button>
      {open && hasDetails && (
        <div className="ml-2 mt-1 space-y-1">
          <div className="text-[9px] text-gray-400">
            {span.service} · {span.kind} · {span.status} · {shortId(span.spanId)}
          </div>
          {Object.keys(span.attributes).length > 0 && (
            <pre className="max-h-24 overflow-auto rounded bg-white p-1 text-[9px]">
              {JSON.stringify(span.attributes, null, 2)}
            </pre>
          )}
          {span.events.map((event, i) => (
            <div key={i} className="text-[9px] text-gray-500">
              • {event.name}
              {event.attributes && Object.keys(event.attributes).length > 0
                ? ` ${JSON.stringify(event.attributes)}`
                : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DistributedTracePanel({ taskId }: { taskId: string }) {
  const [data, setData] = useState<FlowTraceResponse | null>(null);
  const [flowStatus, setFlowStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const flows = await api.listFlows(taskId);
      if (flows.flows.length === 0) {
        setData(null);
        setFlowStatus(null);
        return;
      }
      const latest = flows.flows[0];
      setFlowStatus(latest.status);
      setData(await api.getFlowTrace(latest.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flowStatus || TERMINAL.has(flowStatus)) return;
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => { clearInterval(timer); };
  }, [flowStatus, load]);

  const spans = data?.trace?.spans ?? [];
  const waterfall = toWaterfall(spans);
  const minStart = spans.length > 0 ? Math.min(...spans.map((s) => s.startTimeMs)) : 0;
  const endMax = spans.length > 0 ? Math.max(...spans.map((s) => s.endTimeMs)) : 0;
  const totalMs = Math.max(1, endMax - minStart);

  return (
    <div className="max-h-72 overflow-auto rounded bg-gray-50 p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium text-gray-600">Distributed trace</span>
        {data?.source && (
          <span className="rounded bg-gray-200 px-1 text-[9px] text-gray-600">{data.source}</span>
        )}
        {flowStatus && (
          <span className="rounded bg-gray-200 px-1 text-[9px] text-gray-600">{flowStatus}</span>
        )}
        <button onClick={() => { void load(); }} className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[9px]">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="text-[10px] text-red-600">{error}</div>}
      {!error && !data && !loading && (
        <div className="text-[10px] text-gray-400">No cuttlefish flow for this task.</div>
      )}

      {data && (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-1 text-[9px] text-gray-500">
            {data.traceId && <span className="font-mono">{shortId(data.traceId)}</span>}
            {data.trace?.services.map((service) => (
              <span key={service} className="flex items-center gap-1 rounded bg-white px-1 py-0.5">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${serviceColor(service)}`} />
                {service}
              </span>
            ))}
            {data.trace && <span>{formatMs(data.trace.durationMs)} total</span>}
          </div>

          {waterfall.length > 0 && (
            <div>
              {waterfall.map((span) => (
                <SpanRow key={span.spanId} span={span} minStart={minStart} totalMs={totalMs} />
              ))}
            </div>
          )}

          {waterfall.length === 0 && data.databaseSpans.length > 0 && (
            <div className="space-y-1">
              {data.databaseSpans.map((span) => (
                <div key={span.spanId} className="flex justify-between rounded bg-white px-1 py-0.5 text-[10px]">
                  <span>{span.name}</span>
                  <span className={span.status === 'error' ? 'text-red-600' : 'text-gray-500'}>{span.status}</span>
                </div>
              ))}
            </div>
          )}

          {data.runnerTrace != null && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[9px] text-gray-500">Cuttlefish runner trace</summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-white p-1 text-[9px]">
                {JSON.stringify(data.runnerTrace, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
