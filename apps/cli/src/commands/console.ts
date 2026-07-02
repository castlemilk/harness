import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { TuiApp } from './tui.js';

export const consoleCmd = new Command('console')
  .description('Open the harness TUI console')
  .action(() => {
    if (!process.stdin.isTTY) {
      console.error('The harness console requires an interactive terminal (TTY).');
      process.exit(1);
    }
    render(React.createElement(TuiApp));
  });
