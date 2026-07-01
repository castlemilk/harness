#!/usr/bin/env node
import { program } from 'commander';
import { projectCmd } from './commands/project.js';
import { taskCmd } from './commands/task.js';
import { uiCmd } from './commands/ui.js';
import { skillCmd } from './commands/skill.js';

program
  .name('harness')
  .description('Omega harness CLI')
  .version('0.1.0')
  .option('--api <url>', 'API base URL', 'http://localhost:4000');

program.addCommand(projectCmd);
program.addCommand(taskCmd);
program.addCommand(uiCmd);
program.addCommand(skillCmd);

program.parse();
