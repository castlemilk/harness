import { Command } from 'commander';
import { apiFetch } from '../api.js';

export const projectCmd = new Command('project').description('Manage projects');

projectCmd
  .command('add')
  .description('Add a project')
  .requiredOption('--name <name>', 'project name')
  .requiredOption('--path <path>', 'project directory path')
  .option('--repoUrl <url>', 'repository URL')
  .option('--description <text>', 'project description')
  .action(async (opts) => {
    const project = await apiFetch('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts.name,
        path: opts.path,
        repoUrl: opts.repoUrl,
        description: opts.description,
      }),
    });
    console.log(JSON.stringify(project, null, 2));
  });

projectCmd
  .command('list')
  .description('List projects')
  .action(async () => {
    const projects = await apiFetch('/projects');
    console.log(JSON.stringify(projects, null, 2));
  });

projectCmd
  .command('remove')
  .description('Remove a project')
  .argument('<id>', 'project id')
  .action(async (id) => {
    await apiFetch(`/projects/${id}`, { method: 'DELETE' });
    console.log('Project removed.');
  });
