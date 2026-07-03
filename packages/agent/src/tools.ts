import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ToolResult {
  success: boolean;
  output: string;
}

const FORBIDDEN_COMMANDS = [
  'rm -rf',
  'git reset --hard',
  'git clean',
  'git push --force',
  'git push -f',
  '> /',
];

function sanitizeCommand(command: string): string {
  const trimmed = command.trim();
  for (const forbidden of FORBIDDEN_COMMANDS) {
    if (trimmed.toLowerCase().includes(forbidden.toLowerCase())) {
      throw new Error(`Forbidden command pattern detected: ${forbidden}`);
    }
  }
  return trimmed;
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
  try {
    sanitizeCommand(command);
    const [cmd, ...args] = command.split(' ');
    const { stdout, stderr } = await execFileAsync(cmd, args, {
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
    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}
