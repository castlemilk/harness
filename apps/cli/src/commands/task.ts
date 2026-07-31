import { Command } from 'commander';
import { apiFetch, getApiUrl } from '../api.js';
import { taskFeedCmd } from './task-feed.js';

function formatStatus(status: string): string {
  switch (status) {
    case 'done': return '\x1b[32m✓ done\x1b[0m';
    case 'failed': return '\x1b[31m✗ failed\x1b[0m';
    case 'in_progress': return '\x1b[33m● running\x1b[0m';
    default: return status;
  }
}

async function streamTaskEvents(taskId: string): Promise<void> {
  const url = `${getApiUrl()}/tasks/${taskId}/stream`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`Failed to connect to SSE stream: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!res.ok || !res.body) {
    console.error(`SSE stream returned ${String(res.status)}`);
    return;
  }

  console.log(`\n--- Streaming events for task ${taskId} (Ctrl+C to stop) ---\n`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let taskStatus = 'in_progress';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            handleEvent(eventType, parsed);
            if (eventType === 'task') {
              taskStatus = parsed.status as string;
            }
          } catch {
            // not JSON, skip
          }
          eventType = '';
        } else if (line === '' && eventType) {
          // empty line resets event type (SSE spec)
          eventType = '';
        }
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error(`\nStream error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (taskStatus === 'done' || taskStatus === 'failed') {
    console.log(`\nTask finished: ${formatStatus(taskStatus)}`);
  }
}

async function readSse(
  res: Response,
  onFrame: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.ok || !res.body) {
    console.error(`SSE stream returned ${String(res.status)}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            onFrame(eventType, JSON.parse(line.slice(6)) as Record<string, unknown>);
          } catch {
            // not JSON, skip
          }
          eventType = '';
        } else if (line === '') {
          eventType = '';
        }
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error(`\nStream error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function watchTask(taskId: string): Promise<void> {
  let task: Record<string, unknown>;
  try {
    const data = (await apiFetch(`/tasks/${taskId}`)) as Record<string, unknown>;
    if (!data || typeof data.id !== 'string') {
      console.error(`Task ${taskId} not found.`);
      return;
    }
    task = data;
  } catch (err) {
    console.error(`Failed to load task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const title = typeof task.title === 'string' ? task.title : taskId;
  const status = formatStatus(typeof task.status === 'string' ? task.status : '');
  const model = typeof task.model === 'string' ? task.model : typeof task.provider === 'string' ? task.provider : '-';
  const createdAt = task.createdAt as string | undefined;
  const elapsed = createdAt ? formatElapsed(createdAt) : '';
  const complexity = typeof task.complexity === 'string' ? task.complexity : undefined;

  console.log(`\n━━━ attaching to ${taskId.slice(0, 8)} — ${sanitizeTitle(title)}`);
  console.log(`  status=${status}  model=${model}  elapsed=${elapsed}${complexity ? `  complexity=${complexity}` : ''}`);
  if (typeof task.result === 'string') console.log(`  result: ${task.result.slice(0, 300)}`);
  if (typeof task.error === 'string') console.log(`  error: ${task.error.slice(0, 300)}`);
  console.log(`  Ctrl+C detaches (task keeps running). Re-attach: harness task watch ${taskId}\n`);

  let finished = false;
  const onFrame = (event: string, parsed: Record<string, unknown>): void => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    switch (event) {
      case 'init': {
        const agentRun = parsed.agentRun as Record<string, unknown> | undefined;
        const spans = parsed.spans as unknown[] | undefined;
        const diffs = parsed.diffs as unknown[] | undefined;
        const t = parsed.task as Record<string, unknown> | undefined;
        if (t) {
          console.log(`[${ts}] snapshot: ${formatStatus(typeof t.status === 'string' ? t.status : '')}${typeof t.model === 'string' ? ` (${t.model})` : ''}`);
        }
        if (spans && spans.length > 0) console.log(`[${ts}] ${String(spans.length)} trace span(s) replayed`);
        if (diffs && diffs.length > 0) console.log(`[${ts}] ${String(diffs.length)} diff(s) replayed`);
        if (agentRun) {
          const parts: string[] = [];
          if (typeof agentRun.turnDurationMs === 'number') {
            parts.push(`turn=${Math.round(agentRun.turnDurationMs / 1000)}s`);
          }
          const phase = agentRun.phaseTimings;
          if (phase && typeof phase === 'object') {
            const phases = Object.entries(phase as Record<string, unknown>)
              .map(([k, v]) => `${k}:${Math.round(Number(v) / 1000)}s`)
              .join(',');
            parts.push(`phases=${phases}`);
          }
          if (typeof agentRun.totalTokens === 'number') parts.push(`tokens=${agentRun.totalTokens}`);
          if (typeof agentRun.branch === 'string') parts.push(`branch=${agentRun.branch}`);
          if (parts.length > 0) console.log(`[${ts}] agentRun: ${parts.join('  ')}`);
        }
        break;
      }
      case 'span': {
        const name = String(parsed.name ?? '');
        const spanStatus = String(parsed.status ?? '');
        const mark = spanStatus === 'ok' ? '✓' : spanStatus === 'error' ? '✗' : '·';
        console.log(`[${ts}] ${mark} ${name}`);
        break;
      }
      case 'diff': {
        const patch = String(parsed.patch ?? '');
        const lines = patch.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).length;
        console.log(`[${ts}] diff: ${String(lines)} changed line(s)`);
        break;
      }
      case 'agent-run': {
        const parts: string[] = [];
        if (typeof parsed.resultStatus === 'string') parts.push(`status=${parsed.resultStatus}`);
        if (typeof parsed.totalTokens === 'number') parts.push(`tokens=${parsed.totalTokens}`);
        if (parts.length > 0) console.log(`[${ts}] agentRun update: ${parts.join('  ')}`);
        break;
      }
      case 'task': {
        console.log(`[${ts}] ${formatStatus(typeof parsed.status === 'string' ? parsed.status : '')}`);
        if (typeof parsed.result === 'string') console.log(`       ${parsed.result.slice(0, 400)}`);
        if (typeof parsed.error === 'string') console.log(`       ${parsed.error.slice(0, 400)}`);
        break;
      }
      case 'end': {
        finished = true;
        console.log(`[${ts}] ${formatStatus(typeof parsed.status === 'string' ? parsed.status : '')} — session ended.`);
        break;
      }
      default:
        break;
    }
  };

  const heartbeat = setInterval(() => {
    process.stderr.write('.');
  }, 15_000);

process.once('SIGINT', () => {
    clearInterval(heartbeat);
    console.log(`\nDetached — task ${taskId} continues in the background. Re-attach: harness task watch ${taskId}`);
    process.exit(0);
  });

  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}/tasks/${taskId}/stream`);
  } catch (err) {
    console.error(`Failed to connect to stream: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  await readSse(res, onFrame);
  clearInterval(heartbeat);

  if (finished) process.exit(0);
}

function handleEvent(event: string, data: Record<string, unknown>): void {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  switch (event) {
    case 'init': {
      const task = data.task as Record<string, unknown> | undefined;
      if (task) {
        console.log(`[${ts}] Task ${String(task.id).slice(0, 8)} status=${formatStatus(typeof task.status === 'string' ? task.status : '')}`);
        if (task.provider) console.log(`         provider=${typeof task.provider === 'string' ? task.provider : ''} model=${typeof task.model === 'string' ? task.model : ''}`);
      }
      const spans = data.spans as unknown[] | undefined;
      const diffs = data.diffs as unknown[] | undefined;
      if (spans && spans.length > 0) console.log(`         ${String(spans.length)} trace spans loaded`);
      if (diffs && diffs.length > 0) console.log(`         ${String(diffs.length)} diffs loaded`);
      break;
    }
    case 'task': {
      const status = formatStatus(typeof data.status === 'string' ? data.status : '');
      const result = typeof data.result === 'string' ? data.result.slice(0, 200) : '';
      const error = typeof data.error === 'string' ? data.error.slice(0, 200) : '';
      console.log(`[${ts}] Task status=${status}`);
      if (result) console.log(`         result: ${result}`);
      if (error) console.log(`         error: ${error}`);
      break;
    }
    case 'span': {
      const name = typeof data.name === 'string' ? data.name : '';
      const spanStatus = typeof data.status === 'string' ? data.status : '';
      const icon = spanStatus === 'ok' ? '✓' : spanStatus === 'error' ? '✗' : '·';
      const attrs = data.attributes as Record<string, unknown> | undefined;
      const detail = typeof attrs?.cli === 'string' ? ` (${attrs.cli})` : '';
      console.log(`[${ts}] ${icon} span: ${name}${detail}`);
      break;
    }
    case 'diff': {
      const patch = typeof data.patch === 'string' ? data.patch : '';
      const lines = patch.split('\n').length;
      console.log(`[${ts}] 📝 diff: ${String(lines)} lines`);
      break;
    }
    case 'agent-run': {
      const tokens = data.totalTokens ?? data.promptTokens;
      if (typeof tokens === 'number') console.log(`[${ts}] tokens: ${String(tokens)}`);
      break;
    }
    default:
      // Unknown event type, skip silently
      break;
  }
}

export const taskCmd = new Command('task').description('Manage tasks');

taskCmd
  .command('create')
  .description('Create a task')
  .requiredOption('--project <id>', 'project id')
  .requiredOption('--title <title>', 'task title')
  .option('--description <text>', 'task description')
  .option('--complexity <level>', 'simple | medium | complex', 'simple')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--orchestrate', 'run through the multi-agent orchestrator')
  .option('--max-subtasks <n>', 'orchestrator: max planned subtasks', parseInt)
  .option('--max-iterations <n>', 'orchestrator: max review rounds', parseInt)
  .option('--concurrency <n>', 'orchestrator: concurrent sub-agents', parseInt)
  .option('--token-budget <n>', 'per-run token budget', parseInt)
  .option('--run', 'run the task immediately after creating it')
  .action(async (opts: {
    project: string;
    title: string;
    description?: string;
    complexity: string;
    tags?: string;
    orchestrate?: boolean;
    maxSubtasks?: number;
    maxIterations?: number;
    concurrency?: number;
    tokenBudget?: number;
    run?: boolean;
  }) => {
    const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [];
    if (opts.orchestrate && !tags.includes('orchestrate')) tags.push('orchestrate');
    const task = await apiFetch('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: opts.project,
        title: opts.title,
        description: opts.description,
        complexity: opts.complexity,
        tags,
      }),
    }) as { id: string };
    console.log(JSON.stringify(task, null, 2));
    if (opts.run) {
      const result = await apiFetch(`/tasks/${task.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenBudget: opts.tokenBudget,
          maxSubtasks: opts.maxSubtasks,
          maxIterations: opts.maxIterations,
          concurrency: opts.concurrency,
        }),
      });
      console.log(JSON.stringify(result, null, 2));
    }
  });

taskCmd
  .command('list')
  .description('List tasks')
  .option('--project <id>', 'filter by project id')
  .action(async (opts: { project?: string }) => {
    const query = opts.project ? `?projectId=${opts.project}` : '';
    const tasks = await apiFetch(`/tasks${query}`);
    console.log(JSON.stringify(tasks, null, 2));
  });

interface TaskStatusRow {
  id: string;
  status: string;
  model?: string | null;
  provider?: string | null;
  title: string;
  createdAt: string;
  result?: string | null;
  error?: string | null;
}

const ANSI = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
};

function formatElapsed(createdAt: string): string {
  const ms = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${String(totalSec)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${String(min)}m${String(sec).padStart(2, '0')}`;
  return `${String(Math.floor(min / 60))}h${String(min % 60).padStart(2, '0')}m`;
}

function sanitizeTitle(title: string): string {
  return Array.from(title, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .slice(0, 70);
}

function renderBoard(rows: TaskStatusRow[]): number {
  if (rows.length === 0) {
    console.log(`${ANSI.dim}No tasks matching filters.${ANSI.reset}`);
    return 1;
  }
  console.log(`${ANSI.cyan}ID        STATUS            MODEL               ELAPSED  TASK${ANSI.reset}`);
  for (const task of rows) {
    const id = task.id.slice(0, 8);
    const status = formatStatus(task.status);
    const model = (task.model ?? task.provider ?? '-').padEnd(18).slice(0, 18);
    const elapsed = formatElapsed(task.createdAt).padEnd(7);
    console.log(`${id.padEnd(10)}${status.padEnd(18)}${model}${elapsed}${sanitizeTitle(task.title)}`);
  }
  return rows.length + 1;
}

async function subscribeTaskStream(onTask: (event: { id: string; status?: string; model?: string; provider?: string }) => void): Promise<() => void> {
  const res = await fetch(`${getApiUrl()}/tasks/stream`);
  if (!res.ok || !res.body) throw new Error(`SSE stream returned ${String(res.status)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ') && eventType === 'task') {
            try {
              onTask(JSON.parse(line.slice(6)) as { id: string; status?: string; model?: string; provider?: string });
            } catch {
              // skip malformed frames
            }
          }
        }
      }
    } catch {
      // stream closed
    }
  })();
  return () => {
    void reader.cancel().catch(() => undefined);
  };
}

function filterTaskRows(tasks: TaskStatusRow[], all: boolean): TaskStatusRow[] {
  const inFlight = tasks.filter((t) => t.status === 'in_progress');
  if (all) {
    const finished = tasks.filter((t) => t.status !== 'in_progress').slice(0, 10);
    return [...inFlight, ...finished];
  }
  return inFlight;
}

taskCmd
  .command('watch')
  .alias('attach')
  .description('Attach to a running task and stream its live events; Ctrl+C detaches (task keeps running)')
  .argument('<id>', 'task id to attach to')
  .action(async (id: string) => {
    await watchTask(id);
  });

taskCmd
  .command('status')
  .description('Show in-flight tasks, live-updating from the SSE stream (Ctrl+C to stop)')
  .option('--project <id>', 'filter by project id')
  .option('--all', 'also show recent finished tasks')
  .option('--limit <n>', 'max tasks to fetch', parseInt)
  .option('--once', 'snapshot only, do not subscribe to live updates')
  .option('--json', 'print raw snapshot JSON and exit')
  .action(async (opts: { project?: string; all?: boolean; limit?: number; once?: boolean; json?: boolean }) => {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const query = `?limit=${String(limit)}${opts.project ? `&projectId=${encodeURIComponent(opts.project)}` : ''}`;
    const data = (await apiFetch(`/tasks${query}`)) as { tasks: TaskStatusRow[]; total: number };
    const rows = filterTaskRows(data.tasks, Boolean(opts.all));

    if (opts.json || opts.once) {
      console.log(JSON.stringify({ tasks: rows, total: data.total }, null, 2));
      return;
    }

    let rendered = 0;
    const board = new Map<string, TaskStatusRow>(rows.map((t) => [t.id, t]));

    const redraw = (): void => {
      if (rendered > 0) {
        process.stdout.write(`\x1b[${String(rendered)}A\x1b[0J`);
      }
      const visible = filterTaskRows([...board.values()], Boolean(opts.all)).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      rendered = renderBoard(visible);
    };

    redraw();
    const stop = await subscribeTaskStream((event) => {
      const existing = board.get(event.id);
      board.set(event.id, {
        id: event.id,
        status: event.status ?? existing?.status ?? 'in_progress',
        model: event.model ?? existing?.model,
        provider: event.provider ?? existing?.provider,
        title: existing?.title ?? '<new task>',
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      redraw();
    });

    const onExit = (): void => {
      stop();
      process.exit(0);
    };
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
  });

taskCmd
  .command('run')
  .description('Run a task through the router')
  .argument('<id>', 'task id')
  .option('--token-budget <n>', 'per-run token budget', parseInt)
  .option('--max-subtasks <n>', 'orchestrator: max planned subtasks', parseInt)
  .option('--max-iterations <n>', 'orchestrator: max review rounds', parseInt)
  .option('--concurrency <n>', 'orchestrator: concurrent sub-agents', parseInt)
  .option('--watch', 'stream task events to the terminal via SSE')
  .action(async (id: string, opts: { tokenBudget?: number; maxSubtasks?: number; maxIterations?: number; concurrency?: number; watch?: boolean }) => {
    const result = await apiFetch(`/tasks/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenBudget: opts.tokenBudget,
        maxSubtasks: opts.maxSubtasks,
        maxIterations: opts.maxIterations,
        concurrency: opts.concurrency,
      }),
    });
    console.log(JSON.stringify(result, null, 2));

    if (opts.watch) {
      await streamTaskEvents(id);
    }
  });

taskCmd
  .command('orchestrate')
  .description('Run a task through the multi-agent orchestrator')
  .argument('<id>', 'task id')
  .option('--max-subtasks <n>', 'orchestrator: max planned subtasks', parseInt)
  .option('--max-iterations <n>', 'orchestrator: max review rounds', parseInt)
  .option('--concurrency <n>', 'orchestrator: concurrent sub-agents', parseInt)
  .option('--token-budget <n>', 'per-run token budget', parseInt)
  .action(async (id: string, opts: { maxSubtasks?: number; maxIterations?: number; concurrency?: number; tokenBudget?: number }) => {
    // Ensure the task is tagged for orchestration, then run it.
    const existing = await apiFetch(`/tasks/${id}`) as { tags?: string | string[] };
    const tags = Array.isArray(existing.tags) ? [...existing.tags] : JSON.parse(existing.tags ?? '[]') as string[];
    if (!tags.includes('orchestrate')) tags.push('orchestrate');
    await apiFetch(`/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    });
    const result = await apiFetch(`/tasks/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenBudget: opts.tokenBudget,
        maxSubtasks: opts.maxSubtasks,
        maxIterations: opts.maxIterations,
        concurrency: opts.concurrency,
      }),
    });
    console.log(JSON.stringify(result, null, 2));
  });

taskCmd.addCommand(taskFeedCmd);
