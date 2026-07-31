import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api.js';
import { TraceFlow } from './TraceFlow.js';

interface Subtask {
  id: string;
  title: string;
  status: string;
  model?: string | null;
  provider?: string | null;
  error?: string | null;
  result?: string | null;
  tags?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface TraceSpan {
  id: string;
  name: string;
  status: string;
  startTime: string;
  endTime?: string;
  attributes?: Record<string, unknown>;
}

interface Props {
  taskId: string;
  projectId: string;
  /** When true, auto-poll for updates (e.g. task is in_progress). */
  live?: boolean;
}

function statusColor(status: string) {
  if (status === 'done') return 'text-green-600';
  if (status === 'failed') return 'text-red-600';
  if (status === 'in_progress') return 'text-yellow-600';
  return 'text-gray-500';
}

function statusBg(status: string) {
  if (status === 'done') return 'bg-green-500';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'in_progress') return 'bg-yellow-500';
  return 'bg-gray-300';
}

function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${String(m)}m ${String(Math.round(s - m * 60))}s`;
}

function TimelineBar({ subtask }: { subtask: Subtask }) {
  const start = subtask.createdAt ? new Date(subtask.createdAt).getTime() : 0;
  const end = subtask.updatedAt ? new Date(subtask.updatedAt).getTime() : Date.now();
  const duration = start > 0 ? end - start : 0;

  return (
    <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-1">
      <div className={`h-1.5 rounded-full ${statusBg(subtask.status)}`} style={{ width: `${String(Math.min(100, Math.max(8, duration / 100)))}%` }} />
      <span>{duration > 0 ? formatDuration(duration) : '—'}</span>
    </div>
  );
}

function IterationInfo({ spans }: { spans: TraceSpan[] }) {
  const reviewSpans = spans.filter((s) => s.name.startsWith('orchestrator.review'));
  const planSpan = spans.find((s) => s.name === 'orchestrator.plan');
  const subtaskSpans = spans.filter((s) => s.name.startsWith('orchestrator.subtask'));

  if (reviewSpans.length === 0 && !planSpan) return null;

  return (
    <div className="flex flex-wrap gap-2 text-[10px]">
      {planSpan && (
        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
          plan: {planSpan.endTime ? formatDuration(new Date(planSpan.endTime).getTime() - new Date(planSpan.startTime).getTime()) : '…'}
        </span>
      )}
      {reviewSpans.length > 0 && (
        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
          reviews: {String(reviewSpans.length)}
        </span>
      )}
      {subtaskSpans.length > 0 && (
        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
          subtasks: {String(subtaskSpans.length)}
        </span>
      )}
    </div>
  );
}

export function OrchestrationView({ taskId, projectId, live = false }: Props) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [taskResult, traceData] = await Promise.all([
        api.getTasks(projectId).catch(() => ({ tasks: [] as Subtask[], total: 0 })),
        api.getTraceFlow(taskId).catch(() => null),
      ]);
      const parentTag = `parent:${taskId}`;
      const children = (taskResult.tasks as Subtask[]).filter((t) => parseTags(t.tags).includes(parentTag));
      children.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
      setSubtasks(children);

      if (traceData && typeof traceData === 'object' && 'spans' in traceData) {
        setSpans((traceData as { spans: TraceSpan[] }).spans);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [taskId, projectId]);

  // Auto-poll when live
  useEffect(() => {
    if (!live) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [live, taskId, projectId]);

  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const failedCount = subtasks.filter((s) => s.status === 'failed').length;
  const runningCount = subtasks.filter((s) => s.status === 'in_progress').length;
  const progress = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <div className="text-gray-600">
            Sub-agents: {doneCount}/{subtasks.length} done
            {failedCount > 0 && <span className="text-red-600 ml-2">{failedCount} failed</span>}
            {runningCount > 0 && <span className="text-yellow-600 ml-2">{runningCount} running</span>}
          </div>
          <div className="flex items-center gap-2">
            {live && <span className="text-[10px] text-green-600">● live</span>}
            <button
              onClick={() => { void load(); }}
              className="px-2 py-1 bg-gray-100 rounded text-xs"
            >
              Refresh
            </button>
          </div>
        </div>
        {subtasks.length > 0 && (
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${failedCount > 0 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${String(progress)}%` }}
            />
          </div>
        )}
      </div>

      {/* Iteration info from traces */}
      <IterationInfo spans={spans} />

      {loading && <div className="text-gray-400 text-xs">Loading…</div>}

      {/* Subtask list */}
      <div className="space-y-2 max-h-80 overflow-auto">
        {subtasks.map((subtask, idx) => (
          <div key={subtask.id} className="bg-gray-50 p-2 rounded">
            <div className="flex justify-between gap-2">
              <span className="font-medium truncate text-sm">
                <span className="text-gray-400 mr-1">{String(idx + 1)}.</span>
                {subtask.title}
              </span>
              <span className={`text-xs ${statusColor(subtask.status)}`}>{subtask.status}</span>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-gray-500">
              <span className="font-mono">{subtask.provider ?? 'auto'}</span>
              <span className="font-mono">{subtask.model ?? 'auto'}</span>
            </div>
            <TimelineBar subtask={subtask} />
            {subtask.error && <div className="mt-1 text-red-600 text-[10px]">{subtask.error}</div>}
            {subtask.result && !subtask.error && (
              <div className="mt-1 text-gray-600 text-[10px] truncate" title={subtask.result}>{subtask.result}</div>
            )}
          </div>
        ))}
        {subtasks.length === 0 && !loading && (
          <div className="text-gray-400">No sub-agents recorded yet.</div>
        )}
      </div>

      <div>
        <button
          onClick={() => { setShowTrace((v) => !v); }}
          className="px-2 py-1 bg-gray-100 rounded text-xs"
        >
          {showTrace ? 'Hide' : 'Show'} orchestrator trace
        </button>
        {showTrace && (
          <div className="mt-2">
            <TraceFlow taskId={taskId} />
          </div>
        )}
      </div>
    </div>
  );
}
