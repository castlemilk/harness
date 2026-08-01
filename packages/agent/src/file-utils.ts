import fs from 'node:fs/promises';
import path from 'node:path';
import { isInsideProject, isForbiddenWritePath } from './project-utils.js';
import type { ToolResult } from './tool-types.js';

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
      start += contentLines[k].length + 1;
    }
    let end = start;
    for (let k = i; k < i + oldLines.length; k++) {
      end += contentLines[k].length + 1;
    }
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

export function think(_projectPath: string, thought: string): ToolResult {
  return { success: true, output: thought };
}
