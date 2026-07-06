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

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.omega']);
const FORBIDDEN_PATTERNS = [
  'rm -rf',
  'git reset --hard',
  'git clean',
  'git push --force',
  'git push -f',
  '> /',
];

const SHELL_METACHARACTERS = /[|&;<>$`{}()[\]*?]/;

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
  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (trimmed.toLowerCase().includes(forbidden.toLowerCase())) {
      return { ok: false, reason: `Forbidden command pattern detected: ${forbidden}` };
    }
  }
  if (hasUnquotedShellMetacharacter(trimmed)) {
    return {
      ok: false,
      reason:
        'Command contains unquoted shell metacharacters (|, &&, ;, redirects, unquoted globs, $(), etc.). run_command only supports simple commands without pipes or shell operators. Quote literal globs in arguments, e.g., find . -name "*.ts".',
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
      const context = content.slice(0, 500).replace(/\n/g, '\\n').slice(0, 200);
      return {
        success: false,
        output: `old_string not found in ${filePath}. The file may have changed or the string may be slightly different. First 200 chars: ${context}`,
      };
    }
    const updated = content.replace(oldString, newString);
    await fs.writeFile(target, updated, 'utf-8');
    return { success: true, output: `Edited ${filePath}` };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

const LIST_FILES_OUTPUT_LIMIT = 8_000;

export async function listFiles(
  projectPath: string,
  filePath: string,
  recursive = false
): Promise<ToolResult> {
  const target = path.resolve(projectPath, filePath);
  if (!target.startsWith(path.resolve(projectPath))) {
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
  if (!target.startsWith(path.resolve(projectPath))) {
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
    if (e.stderr) return { success: false, output: e.stderr };
    if (e.code === 1) return { success: true, output: 'No matches' };
    if ((e.message ?? '').includes('ENOENT')) {
      return grepFallback(projectPath, trimmed, target);
    }
    return { success: false, output: e.message ?? String(err) };
  }
}

const OVERVIEW_OUTPUT_LIMIT = 8_000;

export async function codeOverview(projectPath: string, dirPath = '.'): Promise<ToolResult> {
  const target = path.resolve(projectPath, dirPath);
  if (!target.startsWith(path.resolve(projectPath))) {
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
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    const output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
    const exitCode = execErr.code !== undefined ? ` (exit code ${String(execErr.code)})` : '';
    return { success: false, output: `Command failed${exitCode}: ${cmd} ${cmdArgs.join(' ')}\n${output}` };
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

export async function verifyApiSurface(
  projectPath: string,
  entryArg?: string,
  checks?: string[]
): Promise<ToolResult> {
  let entry = entryArg ?? (await findPackageEntry(projectPath));
  if (!entry) {
    return { success: false, output: 'Could not determine package entry point.' };
  }
  let entryPath = path.resolve(projectPath, entry);
  if (!entryPath.startsWith(path.resolve(projectPath))) {
    return { success: false, output: 'Path traversal blocked' };
  }

  // For TypeScript/source-only packages, build first so the entry file exists.
  try {
    await fs.access(entryPath);
  } catch {
    const buildResult = await runCommand(projectPath, 'pnpm build');
    if (!buildResult.success) {
      return {
        success: false,
        output: `Build failed before API surface check:\n${buildResult.output}`,
      };
    }
    // Re-resolve entry after build in case the compiled output changed.
    entry = entryArg ?? (await findPackageEntry(projectPath)) ?? entry;
    entryPath = path.resolve(projectPath, entry);
  }

  const checkList = checks && checks.length > 0 ? checks : [`typeof require('${entryPath}')`];
  const results: string[] = [];
  let allPassed = true;

  for (const check of checkList) {
    const script = `
      const api = require('${entryPath}');
      const result = (function() { return (${check}); })();
      console.log(JSON.stringify({ check: ${JSON.stringify(check)}, result }));
    `;
    try {
      const { stdout } = await execFileAsync('node', ['-e', script], { cwd: projectPath, timeout: 30000 });
      const execResult = /\{.*\}$/.exec(stdout.trim());
      const parsed = execResult
        ? (JSON.parse(execResult[0]) as { check: string; result: unknown })
        : { check, result: stdout.trim() };
      const passed = Boolean(parsed.result);
      if (!passed) allPassed = false;
      results.push(`${passed ? '✓' : '✗'} ${parsed.check} → ${JSON.stringify(parsed.result)}`);
    } catch (err) {
      allPassed = false;
      results.push(`✗ ${check} → ${err instanceof Error ? err.message : String(err)}`);
    }
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
    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}
