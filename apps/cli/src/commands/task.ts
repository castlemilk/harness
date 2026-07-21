import { Command } from 'commander';
import { apiFetch } from '../api.js';
import { taskFeedCmd } from './task-feed.js';

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
  .action(async (id: string, opts: { tokenBudget?: number; maxSubtasks?: number; maxIterations?: number; concurrency?: number }) => {
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
