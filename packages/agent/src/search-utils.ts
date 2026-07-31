import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isInsideProject } from './project-utils.js';
import type { ToolResult } from './tool-types.js';

const execFileAsync = promisify(execFile);

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.omega']);

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
    if (/regex parse error|literal "\\n" is not allowed|unclosed|invalid regex/i.test(errorText)) {
      const literalArgs = args.map((a) => (a === trimmed ? '-F' : a === '-e' ? '-e' : a)).filter((a) => a !== '--json');
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
        const lines2 = stdout
          .split('\n')
          .filter(Boolean)
          .map(rgLine)
          .filter((l) => l.length > 0);
        let output = lines2.slice(0, SEARCH_MAX_MATCHES).join('\n');
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function codeOverview(projectPath: string, dirPath = '.'): Promise<ToolResult> {
  const target = path.resolve(projectPath, dirPath);
  if (!isInsideProject(projectPath, target)) {
    return { success: false, output: 'Path traversal blocked' };
  }

  const lines: string[] = [];

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

  const sourceRoots = ['src', 'lib', 'app', 'apps', 'packages', 'test', 'tests'];
  const foundRoots: string[] = [];
  for (const root of sourceRoots) {
    if (await exists(path.join(target, root))) foundRoots.push(root);
  }
  if (foundRoots.length > 0) lines.push(`source roots: ${foundRoots.join(', ')}`);

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
