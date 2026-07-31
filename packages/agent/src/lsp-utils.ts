import path from 'node:path';
import { clientForPath, type LspClient } from './lsp/index.js';
import { isInsideProject } from './project-utils.js';
import type { ToolResult } from './tool-types.js';

const lspClientsByProject = new Map<string, Map<string, LspClient>>();

export function setLspClients(projectPath: string, clients: Map<string, LspClient>): void {
  if (clients.size === 0) {
    lspClientsByProject.delete(projectPath);
    return;
  }
  lspClientsByProject.set(projectPath, clients);
}

export function clearLspClients(projectPath: string): void {
  lspClientsByProject.delete(projectPath);
}

function clientsForProject(projectPath: string): Map<string, LspClient> | undefined {
  return lspClientsByProject.get(projectPath);
}

export async function lspDiagnostics(projectPath: string, filePath: string): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  const clients = clientsForProject(projectPath);
  const client = clients ? clientForPath(clients, target) : undefined;
  if (!client) {
    return { success: true, output: 'No language server available for this file type.' };
  }
  try {
    const diagnostics = await client.getDiagnostics(target);
    if (diagnostics.length === 0) return { success: true, output: 'No diagnostics.' };
    const lines = diagnostics.map((d) => `${String(d.range.start.line)}:${String(d.range.start.character)} ${d.message}`);
    return { success: true, output: lines.join('\n') };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function lspHover(
  projectPath: string,
  filePath: string,
  line: number,
  character: number
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  const hoverClients = clientsForProject(projectPath);
  const client = hoverClients ? clientForPath(hoverClients, target) : undefined;
  if (!client) {
    return { success: true, output: 'No language server available for this file type.' };
  }
  try {
    const hover = await client.getHover(target, line, character);
    return { success: true, output: hover || 'No hover information.' };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function lspSymbol(projectPath: string, query: string): Promise<ToolResult> {
  const lspClients = clientsForProject(projectPath);
  if (!lspClients) {
    return { success: true, output: 'No language servers available.' };
  }
  try {
    const results: string[] = [];
    const seen = new Set<string>();
    for (const client of new Set(lspClients.values())) {
      const symbols = await client.findSymbol(query);
      for (const s of symbols) {
        const key = `${s.name}:${String(s.kind)}:${s.location?.uri ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const loc = s.location ? `${s.location.uri}:${String(s.location.range.start.line)}` : '';
        results.push(`${s.name} (${String(s.kind)}) ${loc}`);
      }
    }
    if (results.length === 0) return { success: true, output: 'No symbols found.' };
    return { success: true, output: results.slice(0, 20).join('\n') };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}
