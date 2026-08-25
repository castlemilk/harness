import fs from 'node:fs/promises';
import path from 'node:path';
import {
  boundedExecutionTimeoutMs,
  execFileAsync,
  isInsideProject,
  type ExecutionDeadlineOptions,
} from './project-utils.js';
import type { ToolResult } from './tool-types.js';

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
      continue;
    }
    if (currentHunk) {
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

  let index = findBlockIndex(contentLines, oldLines, expectedStartIndex, false);
  if (index === -1) {
    index = findBlockIndex(contentLines, oldLines, expectedStartIndex, true);
  }
  if (index === -1 && expectedStartIndex > 0) {
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

export async function validatePatch(
  projectPath: string,
  baseCommit?: string,
  options: ExecutionDeadlineOptions = {},
): Promise<ToolResult> {
  const execOptions = (maximumMs: number): { cwd: string; timeout: number; signal?: AbortSignal } => ({
    cwd: projectPath,
    timeout: boundedExecutionTimeoutMs(maximumMs, options),
    signal: options.signal,
  });
  const indexOptions = { cwd: projectPath, timeout: 30_000 };
  let priorIndexTree: string | undefined;
  try {
    const { stdout } = await execFileAsync('git', ['write-tree'], indexOptions);
    priorIndexTree = stdout.trim();

    await execFileAsync('git', ['add', '-A'], indexOptions);

    let base = baseCommit;
    if (!base) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], execOptions(30_000));
        base = stdout.trim();
      } catch {
        // ignore
      }
    }

    const diffArgs = base
      ? ['diff', '--cached', base, '--', '.', ':!pnpm-lock.yaml', ':!yarn.lock', ':!package-lock.json', ':!node_modules', ':!.omega']
      : ['diff', '--cached', '--', '.', ':!pnpm-lock.yaml', ':!yarn.lock', ':!package-lock.json', ':!node_modules', ':!.omega'];
    const { stdout: patch } = await execFileAsync('git', diffArgs, execOptions(30_000));
    if (!patch || patch.trim().length === 0) {
      return { success: true, output: 'No changes to validate.' };
    }

    const patchFile = path.join(projectPath, '.omega', 'validate.patch');
    await fs.mkdir(path.dirname(patchFile), { recursive: true });
    await fs.writeFile(patchFile, patch, 'utf-8');

    try {
      if (!base) {
        const emptyDir = path.join(`/tmp`, `omega-patch-check-empty-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`);
        await fs.mkdir(emptyDir, { recursive: true });
        try {
          await execFileAsync('git', ['apply', '--check', patchFile], {
            cwd: emptyDir,
            timeout: boundedExecutionTimeoutMs(30_000, options),
            signal: options.signal,
          });
          return { success: true, output: `Patch is valid and applies cleanly (${String(patch.length)} bytes).` };
        } finally {
          await fs.rm(emptyDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }

      const tempWorktree = path.join(`/tmp`, `omega-patch-check-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`);
      await execFileAsync('git', ['worktree', 'add', '--detach', tempWorktree, base], {
        cwd: projectPath,
        timeout: boundedExecutionTimeoutMs(60_000, options),
        signal: options.signal,
      });
      try {
        await execFileAsync('git', ['apply', '--check', patchFile], {
          cwd: tempWorktree,
          timeout: boundedExecutionTimeoutMs(30_000, options),
          signal: options.signal,
        });
        return { success: true, output: `Patch is valid and applies cleanly (${String(patch.length)} bytes).` };
      } finally {
        await execFileAsync('git', ['worktree', 'remove', '--force', tempWorktree], { cwd: projectPath, timeout: 30_000 }).catch(() => undefined);
        await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath, timeout: 30_000 }).catch(() => undefined);
        await fs.rm(tempWorktree, { recursive: true, force: true }).catch(() => undefined);
      }
    } finally {
      await fs.unlink(patchFile).catch(() => undefined);
    }
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    const output = (execErr.stdout ?? '') + (execErr.stderr ?? '') || (execErr.message ?? String(err));
    return { success: false, output: `Patch validation failed:\n${output}` };
  } finally {
    if (priorIndexTree) {
      await execFileAsync('git', ['read-tree', priorIndexTree], indexOptions).catch(() => undefined);
    }
  }
}
