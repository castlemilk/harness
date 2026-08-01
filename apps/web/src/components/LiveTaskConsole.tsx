import { useEffect, useRef, useState } from 'react';
import { streamUrls } from '../lib/api.js';
import { DiffViewer } from './DiffViewer.js';

interface LiveTask {
  id: string;
  status: string;
  result?: string | null;
  error?: string | null;
  provider?: string | null;
  model?: string | null;
}

interface LiveTrace {
  id: string;
  role: string;
  content: string;
  toolCalls?: string | null;
  createdAt: string;
  stepId?: string;
}

interface LiveSpan {
  id: string;
  name: string;
  spanId: string;
  parentId?: string | null;
  startTime: string;
  endTime?: string | null;
  status: string;
  attributes?: Record<string, unknown>;
  events?: { time: string; name: string; attributes?: Record<string, unknown> }[];
  children: LiveSpan[];
}

interface LiveDiff {
  id: string;
  branch: string;
  patch: string;
  createdAt?: string;
}

interface LiveAgentRun {
  id: string;
  resultStatus: string;
  branch: string;
  baseCommit: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptVersionId?: string;
  turnDurationMs?: number;
  phaseTimings?: string;
  currentPhase?: string;
  currentPhaseStartedAt?: string;
  currentTurn?: number;
}

interface InitPayload {
  task?: LiveTask;
  traces?: LiveTrace[];
  spans?: LiveSpan[];
  diffs?: LiveDiff[];
  agentRun?: LiveAgentRun | null;
}

function statusColor(status: string) {
  if (status === 'done') return 'text-green-600';
  if (status === 'failed') return 'text-red-600';
  if (status === 'in_progress') return 'text-yellow-600';
  return 'text-gray-500';
}

function spanStatusColor(status: string) {
  if (status === 'ok') return 'text-green-600';
  if (status === 'error') return 'text-red-600';
  return 'text-gray-500';
}

function upsertSpan(roots: LiveSpan[], span: Omit<LiveSpan, 'children'>): LiveSpan[] {
  const clone = roots.map((s) => ({ ...s, children: [...s.children] }));
  // Replace an existing span (by spanId) wherever it lives in the tree.
  function replace(nodes: LiveSpan[]): boolean {
    for (const node of nodes) {
      if (node.spanId === span.spanId) {
        Object.assign(node, span, { children: node.children });
        return true;
      }
      if (replace(node.children)) return true;
    }
    return false;
  }
  if (replace(clone)) return clone;
  const node: LiveSpan = { ...span, children: [] };
  if (!span.parentId) {
    clone.push(node);
    return clone;
  }
  function attach(nodes: LiveSpan[]): boolean {
    for (const n of nodes) {
      if (n.spanId === span.parentId) {
        n.children.push(node);
        return true;
      }
      if (attach(n.children)) return true;
    }
    return false;
  }
  if (!attach(clone)) clone.push(node);
  return clone;
}

function SpanRow({ span, depth = 0 }: { span: LiveSpan; depth?: number }) {
  return (
    <div>
      <div
        className="flex items-center gap-2 py-0.5 px-1 text-[11px]"
        style={{ paddingLeft: `${String(depth * 14 + 4)}px` }}
      >
        <span className="font-medium truncate">{span.name}</span>
        <span className={`text-[10px] ${spanStatusColor(span.status)}`}>{span.status}</span>
        <span className="text-gray-400 text-[10px]">{span.endTime ? 'done' : 'running'}</span>
      </div>
      {span.children.map((child) => (
        <SpanRow key={child.spanId} span={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds.toString()}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes.toString()}m` : `${minutes.toString()}m${seconds.toString()}s`;
}

function parsePhaseTimings(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number') out[k] = v;
      }
      return out;
    }
  } catch {
    // fall through
  }
  return {};
}

function PhaseTimings({ timings }: { timings: string }) {
  const parsed = parsePhaseTimings(timings);
  const entries = Object.entries(parsed);
  if (entries.length === 0) return null;
  const total = entries.reduce((acc, [, ms]) => acc + ms, 0);
  return (
    <div>
      <div className="flex justify-between text-gray-500">
        <span>Phases</span>
        <span className="font-mono text-[10px]">
          {entries.map(([phase, ms]) => `${phase}=${formatDuration(ms)}`).join(' · ')}
        </span>
      </div>
      <div className="mt-1 flex h-1.5 rounded overflow-hidden bg-gray-200">
        {entries.map(([phase, ms], idx) => (
          <div
            key={phase}
            className={idx % 2 === 0 ? 'bg-blue-400' : 'bg-blue-600'}
            style={{ width: `${((ms / total) * 100).toFixed(2)}%` }}
            title={`${phase}: ${formatDuration(ms)} (${((ms / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
    </div>
  );
}

export function LiveTaskConsole({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<LiveTask | null>(null);
  const [agentRun, setAgentRun] = useState<LiveAgentRun | null>(null);
  const [traces, setTraces] = useState<LiveTrace[]>([]);
  const [spans, setSpans] = useState<LiveSpan[]>([]);
  const [diffs, setDiffs] = useState<LiveDiff[]>([]);
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState(false);
  const traceBoxRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (ended) return undefined;
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(id); };
  }, [ended]);

  useEffect(() => {
    setTask(null);
    setAgentRun(null);
    setTraces([]);
    setSpans([]);
    setDiffs([]);
    setEnded(false);

    const es = new EventSource(streamUrls.task(taskId));
    setConnected(true);

    es.addEventListener('init', (ev) => {
      const data = JSON.parse((ev).data as string) as InitPayload;
      if (data.task) setTask(data.task);
      if (data.traces) setTraces(data.traces);
      if (data.diffs) setDiffs(data.diffs);
      if (data.agentRun) setAgentRun(data.agentRun);
      if (data.spans) {
        setSpans(() => {
          let roots: LiveSpan[] = [];
          for (const s of data.spans ?? []) roots = upsertSpan(roots, s);
          return roots;
        });
      }
    });

    es.addEventListener('task', (ev) => {
      const data = JSON.parse((ev).data as string) as LiveTask;
      setTask((prev) => ({ ...prev, ...data }));
    });

    es.addEventListener('trace', (ev) => {
      const data = JSON.parse((ev).data as string) as LiveTrace;
      setTraces((prev) => (prev.some((t) => t.id === data.id) ? prev : [...prev, data]));
    });

    es.addEventListener('span', (ev) => {
      const data = JSON.parse((ev).data as string) as Omit<LiveSpan, 'children'>;
      setSpans((prev) => upsertSpan(prev, data));
    });

    es.addEventListener('diff', (ev) => {
      const data = JSON.parse((ev).data as string) as LiveDiff;
      setDiffs((prev) => [...prev.filter((d) => d.id !== data.id), data]);
    });

    es.addEventListener('agent-run', (ev) => {
      const data = JSON.parse((ev).data as string) as LiveAgentRun;
      setAgentRun((prev) => ({ ...prev, ...data }));
    });

    es.addEventListener('end', (ev) => {
      const data = JSON.parse((ev).data as string) as { id: string; status: string };
      setTask((prev) => (prev ? { ...prev, status: data.status } : prev));
      setEnded(true);
      es.close();
    });

    es.onerror = () => {
      setConnected(false);
      // EventSource retries automatically while OPEN/CONNECTING; nothing else to do.
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [taskId]);

  // Auto-scroll the trace stream to the newest entry.
  useEffect(() => {
    const el = traceBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [traces]);

  const latestDiff = diffs.at(-1);

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 p-2 rounded space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-gray-500">Live status</span>
          <span className="flex items-center gap-2">
            {!ended && (
              <span
                className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
                title={connected ? 'connected' : 'reconnecting…'}
              />
            )}
            <span className={statusColor(task?.status ?? 'unknown')}>{task?.status ?? 'connecting…'}</span>
          </span>
        </div>
        {(task?.provider ?? task?.model) && (
          <div className="flex justify-between">
            <span className="text-gray-500">Provider</span>
            <span>{task.provider}/{task.model}</span>
          </div>
        )}
        {agentRun && (
          <>
            <div className="flex justify-between">
              <span className="text-gray-500">Agent run</span>
              <span className={statusColor(agentRun.resultStatus)}>{agentRun.resultStatus}</span>
            </div>
            {agentRun.totalTokens !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-500">Tokens</span>
                <span>
                  {agentRun.promptTokens ?? 0}p / {agentRun.completionTokens ?? 0}c / {agentRun.totalTokens} total
                </span>
              </div>
            )}
            {agentRun.turnDurationMs !== undefined && agentRun.turnDurationMs !== null && (
              <div className="flex justify-between">
                <span className="text-gray-500">Turn duration</span>
                <span>{formatDuration(agentRun.turnDurationMs)}</span>
              </div>
            )}
            {agentRun.currentPhase && !ended && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Current phase</span>
                <span className="flex items-center gap-1.5">
                  {agentRun.resultStatus === 'running' && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                  )}
                  <span>
                    phase={agentRun.currentPhase}
                    {agentRun.currentPhaseStartedAt && (
                      <>
                        {' '}
                        ({formatDuration(now - new Date(agentRun.currentPhaseStartedAt).getTime())})
                      </>
                    )}
                  </span>
                </span>
              </div>
            )}
            {agentRun.phaseTimings && <PhaseTimings timings={agentRun.phaseTimings} />}
          </>
        )}
        {task?.error && <div className="text-red-600">{task.error}</div>}
      </div>

      <div>
        <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">
          Live trace ({traces.length})
        </h5>
        <div ref={traceBoxRef} className="space-y-1 max-h-48 overflow-auto bg-gray-50 rounded p-2">
          {traces.length === 0 && <div className="text-gray-400">Waiting for traces…</div>}
          {traces.map((trace) => (
            <div key={trace.id} className="bg-white p-1.5 rounded">
              <div className="flex justify-between text-gray-500 text-[10px] mb-0.5">
                <span className="font-medium capitalize">{trace.role}</span>
                <span>{new Date(trace.createdAt).toLocaleTimeString()}</span>
              </div>
              {trace.content && (
                <pre className="text-[10px] overflow-auto max-h-24 whitespace-pre-wrap">
                  {trace.content.length > 800 ? `${trace.content.slice(0, 800)}…` : trace.content}
                </pre>
              )}
              {trace.toolCalls && (
                <pre className="text-[10px] text-blue-700 overflow-auto max-h-24 mt-0.5 whitespace-pre-wrap">
                  {trace.toolCalls}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">Spans</h5>
        <div className="max-h-40 overflow-auto bg-gray-50 rounded p-1">
          {spans.length === 0 ? (
            <div className="text-gray-400 px-1 py-0.5">No spans yet.</div>
          ) : (
            spans.map((span) => <SpanRow key={span.spanId} span={span} />)
          )}
        </div>
      </div>

      <div>
        <h5 className="font-medium text-xs text-gray-500 mb-1 uppercase tracking-wide">Latest diff</h5>
        {latestDiff ? (
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 font-mono">{latestDiff.branch}</div>
            <div className="max-h-48 overflow-auto">
              <DiffViewer patch={latestDiff.patch} defaultExpanded={false} />
            </div>
          </div>
        ) : (
          <div className="text-gray-400">No diff yet.</div>
        )}
      </div>
    </div>
  );
}
