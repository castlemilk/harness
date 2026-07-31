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
