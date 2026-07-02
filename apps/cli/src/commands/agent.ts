import { Command } from 'commander';
import { apiFetch } from '../api.js';

export const agentCmd = new Command('agent').description('Autonomous agent loop');

agentCmd
  .command('run')
  .description('Run a single agent task')
  .requiredOption('--project <id>', 'project id')
  .requiredOption('--title <title>', 'task title')
  .option('--description <text>', 'task description')
  .option('--complexity <level>', 'simple | medium | complex', 'complex')
  .option('--auto-publish', 'publish if validation passes', false)
  .action(
    async (opts: {
      project: string;
      title: string;
      description?: string;
      complexity: string;
      autoPublish: boolean;
    }) => {
      const tags = ['agent'];
      if (opts.autoPublish) tags.push('publish');
      const task = (await apiFetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: opts.project,
          title: opts.title,
          description: opts.description,
          complexity: opts.complexity,
          tags,
        }),
      })) as { id: string };
      console.log(JSON.stringify(task, null, 2));
      const result = await apiFetch(`/tasks/${task.id}/run`, { method: 'POST' });
      console.log(JSON.stringify(result, null, 2));
    }
  );

agentCmd
  .command('loop')
  .description('Continuously run agent tasks')
  .requiredOption('--project <id>', 'project id')
  .option('--interval <min>', 'minutes between loops', '30')
  .option('--auto-publish', 'publish if validation passes', false)
  .option('--prompt <text>', 'overriding self-improvement prompt')
  .action(
    async (opts: {
      project: string;
      interval: string;
      autoPublish: boolean;
      prompt?: string;
    }) => {
      const intervalMin = parseInt(opts.interval, 10);
      const intervalMs = intervalMin * 60 * 1000;

      const runOnce = async () => {
        const title =
          opts.prompt ??
          'Improve the Omega harness: fix a TODO, add a test, refactor a function, or improve documentation';
        const tags = ['agent', 'self-improve'];
        if (opts.autoPublish) tags.push('publish');
        const task = (await apiFetch('/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: opts.project,
            title,
            description:
              'Use the available tools to make a small, verifiable improvement to the codebase. Run lint and tests. Finish with a summary.',
            complexity: 'complex',
            tags,
          }),
        })) as { id: string };
        console.log(`Created task ${task.id}`);
        const result = await apiFetch(`/tasks/${task.id}/run`, { method: 'POST' });
        console.log(JSON.stringify(result, null, 2));
        return result;
      };

      await runOnce();
      if (intervalMs > 0) {
        console.log(`Looping every ${opts.interval} minute(s). Press Ctrl+C to stop.`);
        setInterval(() => {
          void runOnce();
        }, intervalMs);
      }
    }
  );

agentCmd
  .command('steps')
  .description('Show steps for a task')
  .argument('<id>', 'task id')
  .action(async (id: string) => {
    const steps = await apiFetch(`/tasks/${id}/steps`);
    console.log(JSON.stringify(steps, null, 2));
  });

agentCmd
  .command('traces')
  .description('Show traces for a task')
  .argument('<id>', 'task id')
  .action(async (id: string) => {
    const traces = await apiFetch(`/tasks/${id}/traces`);
    console.log(JSON.stringify(traces, null, 2));
  });

agentCmd
  .command('diffs')
  .description('Show diffs for a task')
  .argument('<id>', 'task id')
  .action(async (id: string) => {
    const diffs = await apiFetch(`/tasks/${id}/diffs`);
    console.log(JSON.stringify(diffs, null, 2));
  });
