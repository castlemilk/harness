import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface SpanNode {
  id: string;
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  startTime: string;
  endTime?: string;
  status: string;
  attributes?: Record<string, unknown>;
  events?: { time: string; name: string; attributes?: Record<string, unknown> }[];
  children: SpanNode[];
}

interface TraceFlowData {
  traceId: string;
  spans: SpanNode[];
}

interface Props {
  taskId: string;
}

function formatDuration(start: string, end?: string): string {
  if (!end) return 'running';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusColor(status: string) {
  if (status === 'ok') return 'text-green-600';
  if (status === 'error') return 'text-red-600';
  return 'text-gray-500';
}

function SpanRow({ span, depth = 0 }: { span: SpanNode; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = span.children.length > 0;
  const hasAttributes = span.attributes ? Object.keys(span.attributes).length > 0 : false;
  const hasEvents = span.events ? span.events.length > 0 : false;
  const hasDetails = hasAttributes || hasEvents;

  return (
    <div>
      <div
        className="flex items-start gap-2 py-1 px-2 hover:bg-gray-100 rounded text-[11px]"
        style={{ paddingLeft: `${String(depth * 16 + 8)}px` }}
      >
        <button
          onClick={() => { setExpanded((e) => !e); }}
          className={`w-4 text-gray-400 ${hasChildren || hasDetails ? '' : 'invisible'}`}
        >
          {expanded ? '−' : '+'}
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{span.name}</span>
            <span className={`text-[10px] ${statusColor(span.status)}`}>{span.status}</span>
            <span className="text-gray-400">{formatDuration(span.startTime, span.endTime)}</span>
          </div>
          {expanded && hasDetails && (
            <div className="mt-1 space-y-1">
              {span.attributes && Object.keys(span.attributes).length > 0 && (
                <pre className="bg-white p-1 rounded text-[10px] overflow-auto max-h-24">
                  {JSON.stringify(span.attributes, null, 2)}
                </pre>
              )}
              {span.events && span.events.length > 0 && (
                <div className="text-[10px] text-gray-500">
                  {span.events.map((ev, i) => (
                    <div key={i}>• {new Date(ev.time).toLocaleTimeString()} {ev.name}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {expanded &&
        span.children.map((child) => <SpanRow key={child.spanId} span={child} depth={depth + 1} />)}
    </div>
  );
}

export function TraceFlow({ taskId }: Props) {
  const [data, setData] = useState<TraceFlowData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = (await api.getTraceFlow(taskId)) as TraceFlowData;
      setData(res);
    } catch {
      setData(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [taskId]);

  if (loading) return <div className="text-xs text-gray-400">Loading trace flow…</div>;
  if (!data || data.spans.length === 0) return <div className="text-xs text-gray-400">No trace spans recorded.</div>;

  return (
    <div className="max-h-64 overflow-auto bg-gray-50 rounded p-2">
      <div className="text-[10px] text-gray-500 mb-1">traceId: {data.traceId}</div>
      {data.spans.map((span) => (
        <SpanRow key={span.spanId} span={span} />
      ))}
    </div>
  );
}
