import { LspClient } from './client.js';

export interface LspServerConfig {
  command: string;
  args: string[];
  extensions: string[];
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
    const client = new LspClient(server.command, server.args, projectPath);
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
