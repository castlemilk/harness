// ─── In-Memory Store (ring buffer of last 500 traces) ──────────────────────

let traceCounter = 0;

export interface TraceEvent {
  ts: number;
  phase:
    | 'route.start'
    | 'route.candidates'
    | 'route.scored'
    | 'route.selected'
    | 'route.fallback'
    | 'rate_limit.backpressure'
    | 'circuit.open_skip'
    | 'warmup.success'
    | 'warmup.failure'
    | 'llm.request'
    | 'llm.response'
    | 'llm.error'
    | 'agent.loop.iteration'
    | 'agent.loop.complete'
    | 'timeout.abort'
    | 'cascade.budget'
    | 'task.complete';
  data?: Record<string, unknown>;
}

export interface Trace {
  traceId: string;
  taskId: string;
  startedAt: number;
  events: TraceEvent[];
  completedAt?: number;
  outcome?: 'success' | 'error' | 'timeout' | 'rate_limited' | 'auth_error';
  totalMs?: number;
  provider?: string;
  model?: string;
}

const MAX_TRACES = 500;
const traces: Trace[] = [];
const taskIndex = new Map<string, Trace[]>();

export function startTrace(taskId: string): Trace {
  const trace: Trace = {
    traceId: `tr-${(traceCounter++).toString(36)}`,
    taskId,
    startedAt: Date.now(),
    events: [],
  };
  traces.push(trace);

  // Store all traces per task (supports retries)
  const existing = taskIndex.get(taskId) ?? [];
  existing.push(trace);
  taskIndex.set(taskId, existing);

  if (traces.length > MAX_TRACES) {
    const old = traces.shift();
    if (!old) return trace;
    const list = taskIndex.get(old.taskId);
    if (list) {
      const idx = list.indexOf(old);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) taskIndex.delete(old.taskId);
    }
  }
  return trace;
}

export function traceEvent(trace: Trace, phase: TraceEvent['phase'], data?: Record<string, unknown>): void {
  trace.events.push({ ts: Date.now(), phase, data });
}

export function completeTrace(
  trace: Trace,
  outcome: Trace['outcome'],
  provider?: string,
  model?: string,
): void {
  trace.completedAt = Date.now();
  trace.totalMs = trace.completedAt - trace.startedAt;
  trace.outcome = outcome;
  trace.provider = provider;
  trace.model = model;
}

// ─── Query API ──────────────────────────────────────────────────────────────

export function getTrace(taskId: string): Trace | undefined {
  const list = taskIndex.get(taskId);
  return list?.[list.length - 1];
}

export function getAllTracesForTask(taskId: string): Trace[] {
  return taskIndex.get(taskId) ?? [];
}

export function getRecentTraces(limit = 50): Trace[] {
  return traces.slice(-limit).reverse();
}

export function getTraceStats(): {
  totalTraces: number;
  avgMs: number;
  byOutcome: Record<string, number>;
  byProvider: Record<string, { count: number; avgMs: number; errorRate: number }>;
} {
  const completed = traces.filter((t) => t.totalMs != null);
  const avgMs = completed.length > 0
    ? completed.reduce((s, t) => s + (t.totalMs ?? 0), 0) / completed.length
    : 0;

  const byOutcome: Record<string, number> = {};
  for (const t of traces) {
    const key = t.outcome ?? 'pending';
    byOutcome[key] = (byOutcome[key] ?? 0) + 1;
  }

  const byProvider: Record<string, { count: number; avgMs: number; errorRate: number }> = {};
  for (const t of completed) {
    const key = t.provider ?? 'unknown';
    if (!(key in byProvider)) byProvider[key] = { count: 0, avgMs: 0, errorRate: 0 };
    byProvider[key].count++;
    byProvider[key].avgMs += t.totalMs ?? 0;
    if (t.outcome === 'error' || t.outcome === 'auth_error') byProvider[key].errorRate++;
  }
  for (const key of Object.keys(byProvider)) {
    const entry = byProvider[key];
    entry.avgMs = Math.round(entry.avgMs / entry.count);
    entry.errorRate = entry.errorRate / entry.count;
  }

  return { totalTraces: traces.length, avgMs: Math.round(avgMs), byOutcome, byProvider };
}

/**
 * Get a formatted summary of a trace for logging/debugging.
 */
export function formatTraceSummary(trace: Trace): string {
  const lines = [`[trace:${trace.traceId.slice(0, 8)}] task=${trace.taskId.slice(0, 8)}`];
  for (const ev of trace.events) {
    const rel = ev.ts - trace.startedAt;
    lines.push(`  +${String(rel)}ms ${ev.phase}${ev.data ? ' ' + JSON.stringify(ev.data) : ''}`);
  }
  if (trace.totalMs != null) {
    lines.push(`  total=${String(trace.totalMs)}ms outcome=${trace.outcome ?? ''} provider=${trace.provider ?? ''}/${trace.model ?? ''}`);
  }
  return lines.join('\n');
}
