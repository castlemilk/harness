import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clientForPath, type LspClient } from './lsp/index.js';

const execFileAsync = promisify(execFile);

let lspClients: Map<string, LspClient> | undefined;

export function setLspClients(clients: Map<string, LspClient>): void {
  lspClients = clients;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

const FORBIDDEN_PATTERNS = [
  'rm -rf',
  'git reset --hard',
  'git clean',
  'git push --force',
  'git push -f',
  '> /',
];

const SHELL_METACHARACTERS = /[|&;<>$`{}()[\]*?]/;

function sanitizeCommand(command: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Empty command' };
  }
  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (trimmed.toLowerCase().includes(forbidden.toLowerCase())) {
      return { ok: false, reason: `Forbidden command pattern detected: ${forbidden}` };
    }
  }
  if (SHELL_METACHARACTERS.test(trimmed)) {
    return {
      ok: false,
      reason:
        'Command contains shell metacharacters (|, &&, ;, redirects, globs, $(), etc.). run_command only supports simple commands without pipes or shell operators.',
    };
  }
  return { ok: true };
}

function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export async function readFile(projectPath: string, filePath: string): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!target.startsWith(path.resolve(projectPath))) {
    return { success: false, output: 'Path traversal blocked' };
  }
  try {
    const content = await fs.readFile(target, 'utf-8');
    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function writeFile(
  projectPath: string,
  filePath: string,
  content: string
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!target.startsWith(path.resolve(projectPath))) {
    return { success: false, output: 'Path traversal blocked' };
  }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf-8');
    return { success: true, output: `Wrote ${filePath}` };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function editFile(
  projectPath: string,
  filePath: string,
  oldString: string,
  newString: string
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!target.startsWith(path.resolve(projectPath))) {
    return { success: false, output: 'Path traversal blocked' };
  }
  try {
    const content = await fs.readFile(target, 'utf-8');
    if (!content.includes(oldString)) {
      return { success: false, output: `old_string not found in ${filePath}` };
    }
    const updated = content.replace(oldString, newString);
    await fs.writeFile(target, updated, 'utf-8');
    return { success: true, output: `Edited ${filePath}` };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function runCommand(projectPath: string, command: string): Promise<ToolResult> {
  const check = sanitizeCommand(command);
  if (!check.ok) {
    return { success: false, output: check.reason };
  }

  const args = splitCommand(command.trim());
  if (args.length === 0) {
    return { success: false, output: 'Empty command' };
  }
  const [cmd, ...cmdArgs] = args;

  try {
    const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
      cwd: projectPath,
      timeout: 120_000,
      shell: false,
    });
    return { success: true, output: stdout + stderr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: message };
  }
}

export function think(_projectPath: string, thought: string): ToolResult {
  return { success: true, output: thought };
}

export async function lspDiagnostics(projectPath: string, filePath: string): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!target.startsWith(path.resolve(projectPath))) {
    return { success: false, output: 'Path traversal blocked' };
  }
  const client = lspClients ? clientForPath(lspClients, target) : undefined;
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
  if (!target.startsWith(path.resolve(projectPath))) {
    return { success: false, output: 'Path traversal blocked' };
  }
  const client = lspClients ? clientForPath(lspClients, target) : undefined;
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

export async function lspSymbol(_projectPath: string, query: string): Promise<ToolResult> {
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

function argString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  return JSON.stringify(value);
}

export async function executeTool(
  projectPath: string,
  name: string,
  arguments_: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'read_file':
      return readFile(projectPath, argString(arguments_.path));
    case 'write_file':
      return writeFile(projectPath, argString(arguments_.path), argString(arguments_.content));
    case 'edit_file':
      return editFile(
        projectPath,
        argString(arguments_.path),
        argString(arguments_.old_string),
        argString(arguments_.new_string)
      );
    case 'run_command':
      return runCommand(projectPath, argString(arguments_.command));
    case 'think':
      return think(projectPath, argString(arguments_.thought));
    case 'lsp_diagnostics':
      return lspDiagnostics(projectPath, argString(arguments_.path));
    case 'lsp_hover':
      return lspHover(
        projectPath,
        argString(arguments_.path),
        Number(arguments_.line),
        Number(arguments_.character)
      );
    case 'lsp_symbol':
      return lspSymbol(projectPath, argString(arguments_.query));
    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}
