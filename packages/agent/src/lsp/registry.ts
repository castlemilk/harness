import { LspClient } from './client.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.venv']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LspServerConfig {
  command: string;
  args: string[];
  extensions: string[];
}

function findExecutable(name: string, projectPath: string): string | undefined {
  // Check PATH first using a shell builtin (portable across macOS/Linux).
  try {
    const resolved = execFileSync('/bin/sh', ['-c', `command -v ${name}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
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
    path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.bin', name),
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

function hasMatchingExtension(projectPath: string, extensions: string[]): boolean {
  const seen = new Set<string>();
  function walk(dir: string, depth: number): boolean {
    if (depth <= 0) return false;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (walk(path.join(dir, entry.name), depth - 1)) return true;
        continue;
      }
      if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext) && !seen.has(ext)) {
          seen.add(ext);
          if (seen.size >= 1) return true;
        }
      }
    }
    return false;
  }
  return walk(projectPath, 3);
}

export function detectServers(projectPath: string): LspServerConfig[] {
  return DEFAULT_SERVERS.filter((server) => hasMatchingExtension(projectPath, server.extensions));
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
