import fs from 'node:fs/promises';
import path from 'node:path';
import type { LedgerProblem } from './types.js';

export const LEDGER_PLAN_CAP = 4000;
export const LEDGER_NOTES_CAP = 8000;

export const LEDGER_FILES = [
  'task.md',
  'plan.md',
  'tasks.json',
  'notes.md',
  'solution.py',
  'answer.md',
  'transcript.jsonl',
] as const;

export async function initWorkspace(dir: string, problem: LedgerProblem): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, 'task.md'), problem.statement, 'utf8'),
    fs.writeFile(path.join(dir, 'plan.md'), '', 'utf8'),
    fs.writeFile(path.join(dir, 'tasks.json'), '[]', 'utf8'),
    fs.writeFile(path.join(dir, 'notes.md'), '', 'utf8'),
    fs.writeFile(path.join(dir, 'solution.py'), '', 'utf8'),
    fs.writeFile(path.join(dir, 'answer.md'), '', 'utf8'),
    fs.writeFile(path.join(dir, 'transcript.jsonl'), '', 'utf8'),
  ]);
  await appendTranscript(dir, { _meta: true, model: undefined, problem: problem.id });
}

export async function readText(dir: string, name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, name), 'utf8');
  } catch {
    return '';
  }
}

export async function writeText(dir: string, name: string, content: string, cap?: number): Promise<void> {
  const value = cap === undefined ? content : content.slice(0, cap);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), value, 'utf8');
}

export async function appendTranscript(dir: string, record: unknown): Promise<void> {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ error: 'unserializable ledger record' });
  }
  if (!line.endsWith('\n')) line += '\n';
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, 'transcript.jsonl'), line, 'utf8');
}