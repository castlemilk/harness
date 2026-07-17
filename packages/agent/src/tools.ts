import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clientForPath, type LspClient } from './lsp/index.js';
import { runTypeCheck, runTypeScriptScript } from './ts-runner.js';

const execFileAsync = promisify(execFile);

function isInsideProject(projectPath: string, target: string): boolean {
  const root = path.resolve(projectPath);
  return target === root || target.startsWith(root + path.sep);
}

// LSP clients are keyed by project path: each agent task runs in its own
// worktree, so concurrent tasks never share or clobber each other's clients.
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

export interface ToolResult {
  success: boolean;
  output: string;
}

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.omega']);
const FORBIDDEN_PATTERNS = [
  'rm -rf',
  'rm -fr',
  'rm -r -f',
  'git reset --hard',
  'git clean',
  'git push --force',
  'git push -f',
  '> /',
];

const FORBIDDEN_COMMANDS = new Set(['sh', 'bash', 'zsh', 'fish', 'env', 'xargs', 'find']);

const SHELL_METACHARACTERS = /[|&;<>$`*?]/;

function hasUnquotedShellMetacharacter(command: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote === null) {
      i++;
      continue;
    }
    if (quote === null && (char === "'" || char === '"')) {
      quote = char;
      continue;
    }
    if (quote !== null && char === quote) {
      quote = null;
      continue;
    }
    if (quote === null && SHELL_METACHARACTERS.test(char)) {
      return true;
    }
  }
  return false;
}

function sanitizeCommand(command: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Empty command' };
  }
  const normalized = trimmed.replace(/\s+/g, ' ');
  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (normalized.toLowerCase().includes(forbidden.toLowerCase())) {
      return { ok: false, reason: `Forbidden command pattern detected: ${forbidden}` };
    }
  }
  const firstToken = normalized.split(' ')[0]?.toLowerCase() ?? '';
  if (FORBIDDEN_COMMANDS.has(firstToken)) {
    return { ok: false, reason: `Forbidden command: ${firstToken}` };
  }
  // Polling with sleep wastes agent steps: every command runs in the
  // foreground and returns its output directly.
  if (/(^|&&|\|\||[;|])\s*sleep\s/.test(normalized)) {
    return {
      ok: false,
      reason:
        'Rejected: `sleep` wastes a step. Commands run in the foreground and return their output directly — run the command you were waiting on instead of polling for it.',
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

export async function readFile(
  projectPath: string,
  filePath: string,
  lineNumbers = false,
  lineOffset?: number,
  lineCount?: number
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  try {
    const content = await fs.readFile(target, 'utf-8');
    const lines = content.split('\n');
    const total = lines.length;
    const offset = Math.max(0, (lineOffset ?? 1) - 1);
    const count = lineCount === undefined ? total : Math.max(1, lineCount);
    const slice = lines.slice(offset, offset + count);
    const end = Math.min(offset + count, total);
    let output: string;
    if (lineNumbers) {
      output = slice.map((line, idx) => `${String(offset + idx + 1).padStart(6, ' ')} | ${line}`).join('\n');
    } else {
      output = slice.join('\n');
    }
    const header = offset === 0 && end >= total ? '' : `[lines ${String(offset + 1)}-${String(end)} of ${String(total)}]\n`;
    return { success: true, output: `${header}${output}` };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

const FORBIDDEN_WRITE_PATTERNS = [
  /\/(test|tests)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /^(test|tests)\//,
  /[/](test|tests)$/i,
];

function isForbiddenWritePath(filePath: string): boolean {
  return FORBIDDEN_WRITE_PATTERNS.some((pattern) => pattern.test(filePath));
}

export async function writeFile(
  projectPath: string,
  filePath: string,
  content: string
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  if (isForbiddenWritePath(filePath)) {
    return {
      success: false,
      output: `Writing to test/spec paths is not allowed: ${filePath}. Use edit_file on source files only.`,
    };
  }
  try {
    const existing = await fs.stat(target).then((s) => s.size, () => 0);
    if (existing > 0) {
      return {
        success: false,
        output: `File already exists: ${filePath}. Use edit_file to modify an existing file, or choose a new file path.`,
      };
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf-8');
    return { success: true, output: `Wrote ${filePath}` };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

function findFuzzyBlock(content: string, oldString: string): { start: number; end: number } | undefined {
  const oldLines = oldString.split('\n');
  const contentLines = content.split('\n');
  if (oldLines.length === 0 || contentLines.length === 0) return undefined;
  const firstTrim = oldLines[0].trim();
  const lastTrim = oldLines[oldLines.length - 1].trim();
  const maxStart = contentLines.length - oldLines.length;
  for (let i = 0; i <= maxStart; i++) {
    if (contentLines[i].trim() !== firstTrim) continue;
    if (contentLines[i + oldLines.length - 1].trim() !== lastTrim) continue;
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j].trim() !== oldLines[j].trim()) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    let start = 0;
    for (let k = 0; k < i; k++) {
      start += contentLines[k].length + 1; // +1 for the newline separator
    }
    let end = start;
    for (let k = i; k < i + oldLines.length; k++) {
      end += contentLines[k].length + 1;
    }
    // Remove the trailing newline we added for the last line if the original block
    // did not end with one, so replacement length matches the consumed block.
    if (oldString.endsWith('\n')) {
      return { start, end };
    }
    return { start, end: end - 1 };
  }
  return undefined;
}

export async function editFile(
  projectPath: string,
  filePath: string,
  oldString: string,
  newString: string
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  try {
    const content = await fs.readFile(target, 'utf-8');
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 1) {
      const updated = content.replace(oldString, newString);
      await fs.writeFile(target, updated, 'utf-8');
      return { success: true, output: `Edited ${filePath}` };
    }
    if (occurrences > 1) {
      return {
        success: false,
        output: `old_string appears ${String(occurrences)} times in ${filePath}. Provide a larger, unique block of code (including surrounding lines) so the edit targets exactly one location, or use edit_lines instead.`,
      };
    }
    const fuzzy = findFuzzyBlock(content, oldString);
    if (fuzzy) {
      const updated = content.slice(0, fuzzy.start) + newString + content.slice(fuzzy.end);
      await fs.writeFile(target, updated, 'utf-8');
      return { success: true, output: `Edited ${filePath} (fuzzy match)` };
    }
    const context = content.slice(0, 500).replace(/\n/g, '\\n').slice(0, 200);
    return {
      success: false,
      output: `old_string not found in ${filePath}. The file may have changed or the string may be slightly different. First 200 chars: ${context}. Try edit_lines with line numbers if you keep hitting this.`,
    };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function editLines(
  projectPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  newString: string
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  try {
    const content = await fs.readFile(target, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(1, Math.min(startLine, lines.length));
    const end = Math.max(start, Math.min(endLine, lines.length));
    const before = lines.slice(0, start - 1);
    const after = lines.slice(end);
    const updated = [...before, newString, ...after].join('\n');
    await fs.writeFile(target, updated, 'utf-8');
    return {
      success: true,
      output: `Edited ${filePath} lines ${String(start)}-${String(end)}`,
    };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

interface PatchFile {
  oldPath: string | null;
  newPath: string;
  hunks: PatchHunk[];
  isNew: boolean;
}

function stripPatchPrefix(filePath: string): string {
  // Strip leading a/ or b/ prefixes used by git diffs.
  return filePath.replace(/^(a\/|b\/)/, '');
}

function parsePatch(patch: string): PatchFile[] {
  const lines = patch.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  let currentHunk: PatchHunk | undefined;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      currentHunk = undefined;
      current = undefined;
      continue;
    }
    if (line.startsWith('--- ')) {
      const raw = line.slice(4).trim();
      const oldPath = raw === '/dev/null' ? null : stripPatchPrefix(raw);
      current = { oldPath, newPath: oldPath ?? '', hunks: [], isNew: oldPath === null };
      files.push(current);
      currentHunk = undefined;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const raw = line.slice(4).trim();
      const newPath = raw === '/dev/null' ? '' : stripPatchPrefix(raw);
      if (!current) {
        current = { oldPath: null, newPath, hunks: [], isNew: true };
        files.push(current);
      } else {
        current.newPath = newPath;
      }
      continue;
    }
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (match && current) {
        currentHunk = {
          oldStart: Number(match[1]),
          oldCount: Number(match[2] || '1'),
          newStart: Number(match[3]),
          newCount: Number(match[4] || '1'),
          lines: [],
        };
        current.hunks.push(currentHunk);
      }
      continue;
    }
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" - ignore.
      continue;
    }
    if (currentHunk) {
      // Context, add, or remove line.
      currentHunk.lines.push(line);
    }
  }
  return files;
}

function classifyHunkLine(line: string): { kind: 'context' | 'add' | 'remove'; content: string } {
  if (line.startsWith('+')) {
    return { kind: 'add', content: line.slice(1) };
  }
  if (line.startsWith('-')) {
    return { kind: 'remove', content: line.slice(1) };
  }
  // Context lines are prefixed with a space; empty context lines may appear
  // as empty strings if the patch was stripped. Keep the content after the
  // leading space when present.
  return { kind: 'context', content: line.startsWith(' ') ? line.slice(1) : line };
}

function hunkToBlocks(hunk: PatchHunk): { oldLines: string[]; newLines: string[] } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of hunk.lines) {
    const { kind, content } = classifyHunkLine(line);
    if (kind !== 'add') {
      oldLines.push(content);
    }
    if (kind !== 'remove') {
      newLines.push(content);
    }
  }
  return { oldLines, newLines };
}

function linesMatch(a: string, b: string, fuzzy: boolean): boolean {
  if (a === b) return true;
  if (!fuzzy) return false;
  return a.trim() === b.trim();
}

function findBlockIndex(
  contentLines: string[],
  block: string[],
  startIndex: number,
  fuzzy: boolean
): number {
  if (block.length === 0) return startIndex;
  for (let i = startIndex; i <= contentLines.length - block.length; i++) {
    let ok = true;
    for (let j = 0; j < block.length; j++) {
      if (!linesMatch(contentLines[i + j], block[j], fuzzy)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function applyHunk(
  contentLines: string[],
  hunk: PatchHunk,
  expectedStartIndex: number
): { lines: string[]; offsetDelta: number; appliedAt: number } {
  const { oldLines, newLines } = hunkToBlocks(hunk);

  // Try exact match at the expected location first.
  let index = findBlockIndex(contentLines, oldLines, expectedStartIndex, false);
  if (index === -1) {
    // Fall back to fuzzy trim matching anywhere after the expected start.
    index = findBlockIndex(contentLines, oldLines, expectedStartIndex, true);
  }
  if (index === -1 && expectedStartIndex > 0) {
    // As a last resort, search from the beginning of the file.
    index = findBlockIndex(contentLines, oldLines, 0, true);
  }
  if (index === -1) {
    const snippet = oldLines.slice(0, 5).join('\n');
    throw new Error(
      `Hunk block not found starting around line ${String(hunk.newStart)}. ` +
        `Expected block:\n${snippet}`
    );
  }

  const before = contentLines.slice(0, index);
  const after = contentLines.slice(index + oldLines.length);
  return {
    lines: [...before, ...newLines, ...after],
    offsetDelta: newLines.length - oldLines.length,
    appliedAt: index,
  };
}

export async function applyPatch(projectPath: string, patch: string): Promise<ToolResult> {
  const targetRoot = path.resolve(projectPath);
  const files = parsePatch(patch);
  if (files.length === 0) {
    return { success: false, output: 'No valid diff hunks found in patch.' };
  }

  const results: string[] = [];
  const failures: string[] = [];

  for (const file of files) {
    if (!file.newPath) {
      failures.push('Patch file missing new path');
      continue;
    }
    const target = path.resolve(targetRoot, file.newPath);
    if (!isInsideProject(targetRoot, target)) {
      failures.push(`${file.newPath}: path traversal blocked`);
      continue;
    }

    try {
      let contentLines: string[];
      let offset = 0;
      if (file.isNew) {
        contentLines = [];
      } else {
        const content = await fs.readFile(target, 'utf-8');
        contentLines = content.split('\n');
      }

      for (const hunk of file.hunks) {
        const expectedStart = Math.max(0, hunk.newStart - 1 + offset);
        const result = applyHunk(contentLines, hunk, expectedStart);
        contentLines = result.lines;
        offset += result.offsetDelta;
      }

      // Normalize trailing newline: preserve original style when possible.
      const endsWithNewline =
        file.isNew || (await fs.readFile(target, 'utf-8')).endsWith('\n');
      let output = contentLines.join('\n');
      if (endsWithNewline && !output.endsWith('\n')) {
        output += '\n';
      }

      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, output, 'utf-8');
      results.push(`${file.newPath}: applied ${String(file.hunks.length)} hunk(s)`);
    } catch (err) {
      failures.push(`${file.newPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    return {
      success: false,
      output: `apply_patch failed for ${String(failures.length)} file(s):\n${failures.join('\n')}\nSuccessful:\n${results.join('\n')}`,
    };
  }
  return {
    success: true,
    output: `Applied patch to ${String(results.length)} file(s):\n${results.join('\n')}`,
  };
}

const LIST_FILES_OUTPUT_LIMIT = 8_000;

export async function listFiles(
  projectPath: string,
  filePath: string,
  recursive = false
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  try {
    const maxDepth = recursive ? 2 : 1;
    const lines: string[] = [];
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth) return;
      if (SKIPPED_DIRS.has(path.basename(dir))) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        if (SKIPPED_DIRS.has(entry.name)) continue;
        const rel = path.relative(projectPath, path.join(dir, entry.name));
        const prefix = entry.isDirectory() ? '[d]' : '[f]';
        lines.push(`${prefix} ${rel}`);
        if (lines.length > LIST_FILES_OUTPUT_LIMIT) {
          return;
        }
        if (entry.isDirectory() && depth < maxDepth) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      }
    }
    await walk(target, 1);
    let output = lines.slice(0, LIST_FILES_OUTPUT_LIMIT).join('\n') || 'empty directory';
    if (lines.length > LIST_FILES_OUTPUT_LIMIT) {
      output += '\n... [output truncated; narrow your path or use read_file on specific files]';
    }
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

const SEARCH_OUTPUT_LIMIT = 8_000;
const SEARCH_MAX_MATCHES = 200;

function rgLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as {
      type: string;
      data?: {
        path?: { text?: string };
        line_number?: number;
        lines?: { text?: string };
      };
    };
    if (parsed.type === 'match' && parsed.data) {
      const p = parsed.data.path?.text ?? '';
      const n = parsed.data.line_number ?? 0;
      const text = (parsed.data.lines?.text ?? '').trim();
      return `${p}:${String(n)}: ${text}`;
    }
  } catch {
    // ignore malformed JSON
  }
  return line;
}

async function grepFallback(
  projectPath: string,
  pattern: string,
  target: string
): Promise<ToolResult> {
  try {
    const { stdout } = await execFileAsync(
      'grep',
      ['-RIn', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=build', '-m', '3', '-e', pattern, target],
      { timeout: 30000 }
    );
    return { success: true, output: stdout.slice(0, SEARCH_OUTPUT_LIMIT) || 'No matches' };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    if (e.stderr) return { success: false, output: e.stderr };
    return { success: true, output: 'No matches' };
  }
}

export async function searchFiles(
  projectPath: string,
  pattern: string,
  dirPath = '.'
): Promise<ToolResult> {
  const target = path.resolve(projectPath, dirPath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return { success: false, output: 'Empty pattern' };

  const args = [
    '--json',
    '-n',
    '--max-count',
    '3',
    '--glob',
    '!node_modules',
    '--glob',
    '!.git',
    '--glob',
    '!dist',
    '--glob',
    '!build',
    '--glob',
    '!coverage',
    '--glob',
    '!.omega',
    '-e',
    trimmed,
    target,
  ];

  try {
    const { stdout } = await execFileAsync('rg', args, { timeout: 30000 });
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map(rgLine)
      .filter((l) => l.length > 0);
    let output = lines.slice(0, SEARCH_MAX_MATCHES).join('\n');
    if (output.length > SEARCH_OUTPUT_LIMIT) {
      output = `${output.slice(0, SEARCH_OUTPUT_LIMIT)}\n... [truncated]`;
    }
    return { success: true, output: output || 'No matches' };
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: number };
    if (e.code === 1) return { success: true, output: 'No matches' };
    if ((e.message ?? '').includes('ENOENT')) {
      return grepFallback(projectPath, trimmed, target);
    }
    const errorText = e.stderr ?? e.message ?? String(err);
    // If the model supplied an invalid regex (common with literal newlines or
    // unescaped punctuation), retry as a fixed-string search before failing.
    if (/regex parse error|literal "\\n" is not allowed|unclosed|invalid regex/i.test(errorText)) {
      const literalArgs = args.map((a) => (a === trimmed ? `-F` : a === '-e' ? '-e' : a)).filter((a) => a !== '--json');
      // Replace -e with -F -e so ripgrep treats the pattern as literal.
      const fixedArgs: string[] = [];
      for (let i = 0; i < literalArgs.length; i++) {
        if (literalArgs[i] === '-e' && literalArgs[i + 1] === '-F') {
          fixedArgs.push('-F', '-e');
          i++;
        } else if (literalArgs[i] === '-e') {
          fixedArgs.push('-F', '-e');
        } else {
          fixedArgs.push(literalArgs[i]);
        }
      }
      try {
        const { stdout } = await execFileAsync('rg', fixedArgs, { timeout: 30000 });
        const lines = stdout
          .split('\n')
          .filter(Boolean)
          .map(rgLine)
          .filter((l) => l.length > 0);
        let output = lines.slice(0, SEARCH_MAX_MATCHES).join('\n');
        if (output.length > SEARCH_OUTPUT_LIMIT) {
          output = `${output.slice(0, SEARCH_OUTPUT_LIMIT)}\n... [truncated]`;
        }
        return { success: true, output: output || 'No matches' };
      } catch (literalErr) {
        const le = literalErr as { stderr?: string; message?: string; code?: number };
        if (le.code === 1) return { success: true, output: 'No matches' };
        return { success: false, output: le.stderr ?? le.message ?? String(literalErr) };
      }
    }
    return { success: false, output: errorText };
  }
}

const OVERVIEW_OUTPUT_LIMIT = 8_000;

export async function codeOverview(projectPath: string, dirPath = '.'): Promise<ToolResult> {
  const target = path.resolve(projectPath, dirPath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }

  const lines: string[] = [];

  // Package metadata
  try {
    const pkgRaw = await fs.readFile(path.join(target, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as {
      name?: string;
      main?: string;
      module?: string;
      types?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    lines.push(`package: ${pkg.name ?? 'unknown'}`);
    lines.push(`entry: ${pkg.main ?? pkg.module ?? pkg.types ?? 'src/index.ts (guessed)'}`);
    const testScripts = Object.entries(pkg.scripts ?? {}).filter(([k]) => /test|spec|lint|build/.test(k));
    if (testScripts.length > 0) {
      lines.push('scripts:');
      for (const [k, v] of testScripts.slice(0, 10)) {
        lines.push(`  ${k}: ${v}`);
      }
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const frameworks: string[] = [];
    if (deps.react || deps['react-dom']) frameworks.push('react');
    if (deps.next) frameworks.push('nextjs');
    if (deps.vue) frameworks.push('vue');
    if (deps.express) frameworks.push('express');
    if (deps.fastify) frameworks.push('fastify');
    if (deps['@nestjs/core']) frameworks.push('nestjs');
    if (deps.typescript || (await exists(path.join(target, 'tsconfig.json')))) frameworks.push('typescript');
    if (frameworks.length > 0) lines.push(`frameworks: ${frameworks.join(', ')}`);
  } catch {
    // ignore missing package.json
  }

  // Source directories
  const sourceRoots = ['src', 'lib', 'app', 'apps', 'packages', 'test', 'tests'];
  const foundRoots: string[] = [];
  for (const root of sourceRoots) {
    if (await exists(path.join(target, root))) foundRoots.push(root);
  }
  if (foundRoots.length > 0) lines.push(`source roots: ${foundRoots.join(', ')}`);

  // Test files
  const testFiles: string[] = [];
  async function findTests(dir: string, depth: number): Promise<void> {
    if (depth > 2) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(projectPath, full);
      if (entry.isDirectory()) {
        if (/test|spec|__tests__/.test(entry.name)) {
          testFiles.push(`[d] ${rel}`);
        }
        await findTests(full, depth + 1);
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        testFiles.push(`[f] ${rel}`);
      }
    }
  }
  await findTests(target, 1);
  if (testFiles.length > 0) {
    lines.push('test files:');
    lines.push(...testFiles.slice(0, 20));
  }

  // Entry-point exports (best-effort for TS/JS)
  const entryCandidates = ['src/index.ts', 'src/index.js', 'index.ts', 'index.js', 'lib/index.js'];
  for (const candidate of entryCandidates) {
    const full = path.join(target, candidate);
    if (!(await exists(full))) continue;
    try {
      const content = await fs.readFile(full, 'utf-8');
      const exports: string[] = [];
      const exportRe = /export\s+(?:(?:const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)|(?:\*\s+from\s+['"]([^'"]+)['"])|(\{[^}]*\})\s+from)/g;
      let m: RegExpExecArray | null;
      while ((m = exportRe.exec(content)) !== null) {
        if (m[1]) exports.push(m[1]);
        else if (m[2]) exports.push(`* from ${m[2]}`);
        else if (m[3]) exports.push(m[3].replace(/\s+/g, ' ').trim());
      }
      if (exports.length > 0) {
        lines.push(`exports from ${candidate}:`);
        lines.push(...exports.slice(0, 20));
      }
    } catch {
      // ignore
    }
    break;
  }

  let output = lines.join('\n');
  if (output.length > OVERVIEW_OUTPUT_LIMIT) {
    output = `${output.slice(0, OVERVIEW_OUTPUT_LIMIT)}\n... [truncated]`;
  }
  return { success: true, output: output || 'No overview information available.' };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect full-suite test invocations (no path filter). During iteration these
 * burn minutes per run; the agent should target affected test files and run
 * the full suite once before finishing.
 */
function isFullSuiteTestCommand(cmd: string, args: string[]): boolean {
  const joined = [cmd, ...args].join(' ');
  if (/^(npm|pnpm|yarn) test$/.test(joined)) return true;
  if (cmd === 'npx' && (args[0] === 'vitest' || args[0] === 'jest')) {
    const hasPathArg = args.some((a) => !a.startsWith('-') && /\.[cm]?[jt]sx?$/.test(a));
    return !hasPathArg;
  }
  return (
    /^(python3? -m )?pytest( -q)?$/.test(joined) ||
    joined === 'go test ./...' ||
    joined === 'cargo test'
  );
}

const FULL_SUITE_HINT =
  '\n[hint] Full-suite test run detected. During iteration, run only the test files affected by your change (e.g. `npx vitest run <file>`, `python3 -m pytest <file> -q`) to save steps; the full suite is required once as final verification before finish.';

export async function runCommand(projectPath: string, command: string): Promise<ToolResult> {
  const check = sanitizeCommand(command);
  if (!check.ok) {
    return { success: false, output: check.reason };
  }

  // Compound commands (pipes, &&, redirects) run through sh -c; simple
  // commands go direct via execFile to avoid shell quoting surprises.
  const useShell = hasUnquotedShellMetacharacter(command);
  const args = useShell ? ['-c', command] : splitCommand(command.trim());
  if (args.length === 0) {
    return { success: false, output: 'Empty command' };
  }
  const cmd = useShell ? 'sh' : args[0];
  const cmdArgs = useShell ? args : args.slice(1);

  const advisory = !useShell && isFullSuiteTestCommand(cmd, cmdArgs) ? FULL_SUITE_HINT : '';

  const env: NodeJS.ProcessEnv = { ...process.env };
  const venvBin = path.join(projectPath, '.venv', 'bin');
  if (await exists(venvBin)) {
    env.PATH = `${venvBin}${path.delimiter}${env.PATH ?? ''}`;
  }

  try {
    const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
      cwd: projectPath,
      // Generous enough for a one-off full-suite final verification on large
      // repos; iteration should use targeted test runs well under this.
      timeout: 300_000,
      shell: false,
      env,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { success: true, output: stdout + stderr + advisory };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    // grep/rg exit 1 means "no matches" — that is a normal exploration
    // result, not a command failure.
    if (!useShell && (cmd === 'grep' || cmd === 'rg') && execErr.code === 1 && !execErr.stderr) {
      return { success: true, output: (execErr.stdout ?? '') || 'No matches.' };
    }
    const output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
    const exitCode = execErr.code !== undefined ? ` (exit code ${String(execErr.code)})` : '';
    return { success: false, output: `Command failed${exitCode}: ${cmd} ${cmdArgs.join(' ')}\n${output}${advisory}` };
  }
}

export function think(_projectPath: string, thought: string): ToolResult {
  return { success: true, output: thought };
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

async function findPackageEntry(projectPath: string): Promise<string | undefined> {
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as {
      main?: string;
      module?: string;
      exports?: unknown;
    };
    if (pkg.main) return pkg.main;
    if (pkg.module) return pkg.module;
    if (typeof pkg.exports === 'string') return pkg.exports;
    if (typeof pkg.exports === 'object' && pkg.exports !== null) {
      const exportsRecord = pkg.exports as Record<string, unknown>;
      if ('.' in exportsRecord) {
        const defaultExport = exportsRecord['.'];
        if (typeof defaultExport === 'string') return defaultExport;
        if (typeof defaultExport === 'object' && defaultExport !== null) {
          const defaultExportRecord = defaultExport as Record<string, unknown>;
          if (typeof defaultExportRecord.import === 'string') return defaultExportRecord.import;
          if (typeof defaultExportRecord.require === 'string') return defaultExportRecord.require;
        }
      }
    }
  } catch {
    // ignore
  }
  for (const candidate of ['src/index.ts', 'src/index.js', 'index.ts', 'index.js', 'lib/index.js']) {
    try {
      await fs.access(path.join(projectPath, candidate));
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

export async function validatePatch(projectPath: string, baseCommit?: string): Promise<ToolResult> {
  // Capture the current index so the staged/unstaged split can be restored
  // after the patch is generated — the `git add -A` below must not leak
  // into the user's repo state.
  let priorIndexTree: string | undefined;
  try {
    try {
      const { stdout } = await execFileAsync('git', ['write-tree'], { cwd: projectPath, timeout: 30_000 });
      priorIndexTree = stdout.trim();
    } catch {
      // Index not recordable (e.g. unmerged entries); proceed without restore.
    }

    // Stage all changes (including new files) so the patch includes them.
    await execFileAsync('git', ['add', '-A'], { cwd: projectPath, timeout: 30_000 });

    let base = baseCommit;
    if (!base) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectPath, timeout: 30_000 });
        base = stdout.trim();
      } catch {
        // Repository has no commits yet; fall through with base undefined.
      }
    }

    const diffArgs = base
      ? ['diff', '--cached', base, '--', '.', ':!pnpm-lock.yaml', ':!yarn.lock', ':!package-lock.json', ':!node_modules', ':!.omega']
      : ['diff', '--cached', '--', '.', ':!pnpm-lock.yaml', ':!yarn.lock', ':!package-lock.json', ':!node_modules', ':!.omega'];
    const { stdout: patch } = await execFileAsync('git', diffArgs, { cwd: projectPath, timeout: 30_000 });
    if (!patch || patch.trim().length === 0) {
      return { success: true, output: 'No changes to validate.' };
    }

    const patchFile = path.join(projectPath, '.omega', 'validate.patch');
    await fs.mkdir(path.dirname(patchFile), { recursive: true });
    await fs.writeFile(patchFile, patch, 'utf-8');

    try {
      if (!base) {
        // No base commit to spawn a worktree from; simply verify the patch applies to an empty directory.
        const emptyDir = path.join('/tmp', `omega-patch-check-empty-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`);
        await fs.mkdir(emptyDir, { recursive: true });
        try {
          await execFileAsync('git', ['apply', '--check', patchFile], { cwd: emptyDir, timeout: 30_000 });
          return { success: true, output: `Patch is valid and applies cleanly (${String(patch.length)} bytes).` };
        } finally {
          await fs.rm(emptyDir, { recursive: true, force: true }).catch(() => {
            // ignore cleanup errors
          });
        }
      }

      // Apply-check the patch in a fresh worktree from the base commit. This avoids
      // false positives where files already present in the current worktree cause
      // `git apply --check` to report "already exists" for creation patches.
      const tempWorktree = path.join('/tmp', `omega-patch-check-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`);
      await execFileAsync('git', ['worktree', 'add', '--detach', tempWorktree, base], {
        cwd: projectPath,
        timeout: 60_000,
      });
      try {
        await execFileAsync('git', ['apply', '--check', patchFile], { cwd: tempWorktree, timeout: 30_000 });
        return { success: true, output: `Patch is valid and applies cleanly (${String(patch.length)} bytes).` };
      } finally {
        await execFileAsync('git', ['worktree', 'remove', '--force', tempWorktree], { cwd: projectPath, timeout: 30_000 }).catch(() => {
          // ignore cleanup errors
        });
        await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath, timeout: 30_000 }).catch(() => {
          // ignore cleanup errors
        });
        await fs.rm(tempWorktree, { recursive: true, force: true }).catch(() => {
          // ignore cleanup errors
        });
      }
    } finally {
      await fs.unlink(patchFile).catch(() => {
        // ignore cleanup errors
      });
    }
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    const output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
    return { success: false, output: `Patch validation failed:\n${output}` };
  } finally {
    if (priorIndexTree) {
      // Restore the user's original index (staged/unstaged split).
      await execFileAsync('git', ['read-tree', priorIndexTree], { cwd: projectPath, timeout: 30_000 }).catch(() => {
        // ignore restore errors — the validation result stands
      });
    }
  }
}

async function getModifiedFiles(projectPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: projectPath });
    const files = new Set<string>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const file = trimmed.slice(2).trim();
      if (file) {
        files.add(path.resolve(projectPath, file));
      }
    }
    return files;
  } catch {
    return new Set();
  }
}

function parseTscErrorFiles(output: string, projectPath: string): string[] {
  const files = new Set<string>();
  const regex = /^\s*([^\s(]+)\(\d+,\d+\):\s*error\s+TS\d+/gm;
  let match;
  while ((match = regex.exec(output)) !== null) {
    const filePath = path.resolve(projectPath, match[1]);
    files.add(filePath);
  }
  return Array.from(files);
}

export async function verifyApiSurface(
  projectPath: string,
  entryArg?: string,
  checks?: string[]
): Promise<ToolResult> {
  let entry = entryArg && entryArg.length > 0 ? entryArg : (await findPackageEntry(projectPath));
  if (!entry) {
    return { success: false, output: 'Could not determine package entry point.' };
  }
  let entryPath = path.resolve(projectPath, entry);
  if (!isInsideProject(projectPath, entryPath)) {
    return { success: false, output: 'Path traversal blocked' };
  }

  let isTypeScript = /\.(ts|tsx|mts|cts)$/.test(entry);

  // For TypeScript/source-only packages, run a typecheck first so missing
  // imports and signature mismatches are caught before runtime checks.
  // Ignore errors in files the agent did not touch (e.g. pre-existing playground
  // errors) so the check only validates the current change.
  if (isTypeScript) {
    const typeCheck = await runTypeCheck(projectPath);
    if (!typeCheck.success) {
      const modifiedFiles = await getModifiedFiles(projectPath);
      const errorFiles = parseTscErrorFiles(typeCheck.output, projectPath);
      const relevantErrors = errorFiles.filter((f) => modifiedFiles.has(f));
      if (relevantErrors.length > 0) {
        return {
          success: false,
          output: `TypeScript typecheck failed before API surface check (${String(relevantErrors.length)} error(s) in modified files):\n${typeCheck.output}`,
        };
      }
      // Pre-existing errors only; continue but record them for visibility.
      isTypeScript = true;
    }
  }

  // If the entry file does not exist (e.g. source-only TS that has not been
  // built), try a build so a JS entry is available for non-TS runners.
  try {
    await fs.access(entryPath);
  } catch {
    const buildResult = await runCommand(projectPath, 'pnpm build');
    if (!buildResult.success) {
      // Build failed. Fall back to src/index.ts if it exists.
      const fallback = 'src/index.ts';
      try {
        await fs.access(path.resolve(projectPath, fallback));
        entry = fallback;
        entryPath = path.resolve(projectPath, entry);
        isTypeScript = true;
      } catch {
        return {
          success: false,
          output: `Build failed before API surface check:\n${buildResult.output}`,
        };
      }
    } else {
      entry = entryArg && entryArg.length > 0 ? entryArg : ((await findPackageEntry(projectPath)) ?? entry);
      entryPath = path.resolve(projectPath, entry);
      isTypeScript = /\.(ts|tsx|mts|cts)$/.test(entry);
    }
  }

  let isEsm = false;
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { type?: string };
    isEsm = pkg.type === 'module' || entryPath.endsWith('.mjs');
  } catch {
    isEsm = entryPath.endsWith('.mjs');
  }

  const checkList = checks && checks.length > 0 ? checks : [`typeof api === 'object'`];
  const results: string[] = [];
  let allPassed = true;

  for (const check of checkList) {
    let checkOutput: { success: boolean; output: string };
    if (isTypeScript) {
      const script = `
        import * as api from '${entryPath}';
        const result = (function() { return (${check}); })();
        console.log(JSON.stringify({ check: ${JSON.stringify(check)}, result }));
      `;
      checkOutput = await runTypeScriptScript(projectPath, script);
    } else if (isEsm) {
      const script = `
        const api = await import('file://${entryPath}');
        Object.assign(globalThis, api);
        const result = (function() { return (${check}); })();
        console.log(JSON.stringify({ check: ${JSON.stringify(check)}, result }));
      `;
      try {
        const { stdout } = await execFileAsync('node', ['--input-type=module', '-e', script], { cwd: projectPath, timeout: 30000 });
        checkOutput = { success: true, output: stdout };
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        checkOutput = {
          success: false,
          output: (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err)),
        };
      }
    } else {
      const script = `
        const api = require('${entryPath}');
        Object.assign(globalThis, api);
        const result = (function() { return (${check}); })();
        console.log(JSON.stringify({ check: ${JSON.stringify(check)}, result }));
      `;
      try {
        const { stdout } = await execFileAsync('node', ['-e', script], { cwd: projectPath, timeout: 30000 });
        checkOutput = { success: true, output: stdout };
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        checkOutput = {
          success: false,
          output: (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err)),
        };
      }
    }

    if (!checkOutput.success) {
      allPassed = false;
      results.push(`✗ ${check} → ${checkOutput.output}`);
      continue;
    }

    const stdout = checkOutput.output;
    const execResult = /\{.*\}$/.exec(stdout.trim());
    const parsed = execResult
      ? (JSON.parse(execResult[0]) as { check: string; result: unknown })
      : { check, result: stdout.trim() };
    const passed = Boolean(parsed.result);
    if (!passed) allPassed = false;
    results.push(`${passed ? '✓' : '✗'} ${parsed.check} → ${JSON.stringify(parsed.result)}`);
  }

  return {
    success: allPassed,
    output: `Entry: ${entry}\n${results.join('\n')}`,
  };
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
      return readFile(
        projectPath,
        argString(arguments_.path),
        Boolean(arguments_.line_numbers),
        arguments_.line_offset === undefined ? undefined : Number(arguments_.line_offset),
        arguments_.line_count === undefined ? undefined : Number(arguments_.line_count)
      );
    case 'write_file':
      return writeFile(projectPath, argString(arguments_.path), argString(arguments_.content));
    case 'edit_file':
      return editFile(
        projectPath,
        argString(arguments_.path),
        argString(arguments_.old_string),
        argString(arguments_.new_string)
      );
    case 'edit_lines':
      return editLines(
        projectPath,
        argString(arguments_.path),
        Number(arguments_.start_line),
        Number(arguments_.end_line),
        argString(arguments_.new_string)
      );
    case 'apply_patch':
      return applyPatch(projectPath, argString(arguments_.patch));
    case 'run_command':
      return runCommand(projectPath, argString(arguments_.command));
    case 'list_files':
      return listFiles(projectPath, argString(arguments_.path), Boolean(arguments_.recursive));
    case 'search':
      return searchFiles(projectPath, argString(arguments_.pattern), argString(arguments_.path) || '.');
    case 'think':
      return think(projectPath, argString(arguments_.thought));
    case 'code_overview':
      return codeOverview(projectPath, argString(arguments_.path) || '.');
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
    case 'verify_api_surface':
      return verifyApiSurface(
        projectPath,
        argString(arguments_.entry),
        Array.isArray(arguments_.checks) ? arguments_.checks.map((c) => argString(c)) : undefined
      );
    case 'validate_patch':
      return validatePatch(projectPath);
    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}
