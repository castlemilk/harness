import { Command } from 'commander';
import { apiFetch } from '../api.js';

export const taskCmd = new Command('task').description('Manage tasks');

taskCmd
  .command('create')
  .description('Create a task')
  .requiredOption('--project <id>', 'project id')
  .requiredOption('--title <title>', 'task title')
  .option('--description <text>', 'task description')
  .option('--complexity <level>', 'simple | medium | complex', 'simple')
  .option('--tags <tags>', 'comma-separated tags')
  .action(async (opts: { project: string; title: string; description?: string; complexity: string; tags?: string }) => {
    const task = await apiFetch('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: opts.project,
        title: opts.title,
        description: opts.description,
        complexity: opts.complexity,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
      }),
    });
    console.log(JSON.stringify(task, null, 2));
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
  .action(async (id: string) => {
    const result = await apiFetch(`/tasks/${id}/run`, { method: 'POST' });
    console.log(JSON.stringify(result, null, 2));
  });
