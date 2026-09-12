import { readText } from './workspace.js';

export type LedgerTaskStatus = 'pending' | 'in_progress' | 'done';

export interface ParsedTask {
  id: number;
  desc: string;
  status: LedgerTaskStatus;
}

export type LedgerCallStatus = 'ok' | 'infra' | 'error' | 'truncated' | 'empty_stop';

export function stripThink(text: string): string {
  return text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
}

function exactName(raw: string): string {
  return raw.replace(/[:#*]+$/, '').trim();
}

function matchHeader(
  line: string,
  canonical: Map<string, string>,
): { name: string | null; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
  if (heading) {
    const body = heading[1].trim();
    const direct = canonical.get(exactName(body).toLowerCase());
    if (direct) return { name: direct, rest: '' };
    const colon = /^([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.*)$/.exec(body);
    if (colon) {
      const name = canonical.get(colon[1].trim().toLowerCase());
      if (name) return { name, rest: colon[2].trim() };
    }
    const spaced = /^([A-Za-z][A-Za-z0-9 _-]*?)\s+(.*)$/.exec(body);
    if (spaced) {
      const name = canonical.get(spaced[1].trim().toLowerCase());
      if (name) return { name, rest: spaced[2].trim() };
    }
    return { name: null, rest: '' };
  }

  const bold = /^\*\*([^*]+)\*\*\s*:?\s*(.*)$/.exec(trimmed);
  if (bold) {
    const name = canonical.get(exactName(bold[1]).toLowerCase());
    return { name: name ?? null, rest: name ? bold[2].trim() : '' };
  }

  const plain = /^([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.*)$/.exec(trimmed);
  if (plain) {
    const name = canonical.get(plain[1].trim().toLowerCase());
    if (name) return { name, rest: plain[2].trim() };
  }
  return null;
}

export function sections(text: string, names: string[]): Partial<Record<string, string>> {
  const canonical = new Map<string, string>();
  for (const raw of names) {
    const trimmed = raw.trim();
    if (trimmed) canonical.set(trimmed.toLowerCase(), trimmed);
  }
  const out: Partial<Record<string, string>> = {};
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (current !== null && !(current in out)) out[current] = buffer.join('\n').trim();
  };
  for (const line of lines) {
    const header = matchHeader(line, canonical);
    if (header) {
      flush();
      current = header.name;
      buffer = header.rest ? [header.rest] : [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

export function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^[-*]\s*(.*)$/.exec(line.trim());
    const bullet = match?.[1].trim();
    if (bullet) out.push(bullet);
  }
  return out;
}

export function extractPython(text: string): string {
  const python = /```[ \t]*python[^\n]*\n([\s\S]*?)```/i.exec(text);
  if (python) return python[1].replace(/\r\n/g, '\n');
  const any = /```[^\n]*\n([\s\S]*?)```/.exec(text);
  if (any) return any[1].replace(/\r\n/g, '\n');
  return '';
}

export function parseTasks(text: string, maxTasks?: number): ParsedTask[] {
  const body = sections(text, ['TASKS']).TASKS ?? '';
  const tasks: ParsedTask[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*[-*]\s*\[([^\]]+)\]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const marker = match[1].trim().toLowerCase().replace(/[\s-]+/g, '_');
    const status: LedgerTaskStatus =
      marker === 'done' || marker === 'complete' || marker === 'completed'
        ? 'done'
        : marker === 'in_progress' || marker === 'doing' || marker === 'active'
          ? 'in_progress'
          : 'pending';
    const desc = match[2].trim();
    if (desc) tasks.push({ id: tasks.length + 1, desc, status });
  }
  const limited = maxTasks === undefined ? tasks : tasks.slice(0, maxTasks);
  return limited.map((task, index) => ({ ...task, id: index + 1 }));
}

export async function hasAnswer(dir: string, _kind: 'code'): Promise<boolean> {
  const solution = await readText(dir, 'solution.py');
  return solution.trim().length > 0;
}

export function classifyStatus(
  finishReason: string | undefined,
  hasArtifact: boolean,
  infraExhausted = false,
): LedgerCallStatus {
  if (hasArtifact) return 'ok';
  if (infraExhausted) return 'infra';
  if (finishReason === 'error') return 'error';
  if (finishReason === 'length') return 'truncated';
  return 'empty_stop';
}