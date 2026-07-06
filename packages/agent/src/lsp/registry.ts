import { LspClient } from './client.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LspServerConfig {
  command: string;
  args: string[];
  extensions: string[];
}

function findExecutable(name: string, projectPath: string): string | undefined {
  // Check PATH first.
  try {
    const resolved = execFileSync('command', ['-v', name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (resolved) return resolved;
  } catch {
    // fall through
  }

  // Search common node_modules/.bin locations.
  const candidates = [
    path.join(projectPath, 'node_modules', '.bin', name),
    path.join(process.cwd(), 'node_modules', '.bin', name),
    path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', name),
    path.join(__dirname, '..', '..', 'node_modules', '.bin', name),
    path.join(__dirname, '..', 'node_modules', '.bin', name),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return undefined;
}

const DEFAULT_SERVERS: LspServerConfig[] = [
  {
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  {
    command: 'gopls',
    args: ['serve'],
    extensions: ['.go'],
  },
  {
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py'],
  },
  {
    command: 'rust-analyzer',
    args: [],
    extensions: ['.rs'],
  },
];

export function detectServers(_projectPath: string): LspServerConfig[] {
  return DEFAULT_SERVERS;
}

export function createClients(projectPath: string): Map<string, LspClient> {
  const clients = new Map<string, LspClient>();
  for (const server of detectServers(projectPath)) {
    const executable = findExecutable(server.command, projectPath);
    if (!executable) continue;
    const client = new LspClient(executable, server.args, projectPath);
    for (const ext of server.extensions) {
      clients.set(ext, client);
    }
  }
  return clients;
}

export function clientForPath(clients: Map<string, LspClient>, filePath: string): LspClient | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return clients.get(ext);
}
