import fs from 'node:fs/promises';
import path from 'node:path';
import { omegaWorkDir } from '@omega/core';

export interface LedgerCallSummary {
  index: number;
  role: string;
  startedAt: number | null;
  durationMs: number | null;
  finishReason: string | null;
  truncated: boolean;
  temperature: number | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  responseChars: number;
  responseExcerpt: string;
}

export interface LedgerRoleStats {
  role: string;
  calls: number;
  truncated: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

export interface LedgerInspect {
  taskId: string;
  workspace: string;
  exists: boolean;
  files: Record<string, { path: string; bytes: number; content?: string }>;
  calls: LedgerCallSummary[];
  roles: LedgerRoleStats[];
  totals: { calls: number; truncated: number; promptTokens: number; completionTokens: number; costUsd: number };
}

const FILE_CAP_BYTES = 40_000;
const EXCERPT_CHARS = 400;

function workspaceFor(taskId: string): string {
  return path.join(omegaWorkDir(), 'orchestrations', taskId);
}

async function readCapped(filePath: string): Promise<{ bytes: number; content: string | undefined }> {
  try {
    const stat = await fs.stat(filePath);
    const content = stat.size <= FILE_CAP_BYTES ? await fs.readFile(filePath, 'utf-8') : undefined;
    return { bytes: stat.size, content };
  } catch {
    return { bytes: 0, content: undefined };
  }
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads a ledger workspace into a debuggable summary (files, per-call rows, per-role stats). */
export async function inspectLedgerWorkspace(taskId: string): Promise<LedgerInspect> {
  const workspace = workspaceFor(taskId);
  const files: LedgerInspect['files'] = {};
  for (const name of ['task.md', 'plan.md', 'tasks.json', 'notes.md', 'solution.py', 'answer.md']) {
    const filePath = path.join(workspace, name);
    const { bytes, content } = await readCapped(filePath);
    files[name] = { path: filePath, bytes, content };
  }

  let exists = false;
  try {
    await fs.access(workspace);
    exists = true;
  } catch {
    exists = false;
  }

  const calls: LedgerCallSummary[] = [];
  try {
    const raw = await fs.readFile(path.join(workspace, 'transcript.jsonl'), 'utf-8');
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (record._meta === true) continue;
      const usage = (record.usage ?? {}) as Record<string, unknown>;
      const response = typeof record.response === 'string' ? record.response : '';
      calls.push({
        index: calls.length + 1,
        role: typeof record.role === 'string' ? record.role : 'unknown',
        startedAt: asNullableNumber(record.startedAt),
        durationMs: asNullableNumber(record.durationMs),
        finishReason: typeof record.finishReason === 'string' ? record.finishReason : null,
        truncated: record.truncated === true,
        temperature: asNullableNumber((record.request as Record<string, unknown> | undefined)?.temperature),
        promptTokens: asNumber(usage.promptTokens),
        completionTokens: asNumber(usage.completionTokens),
        costUsd: asNullableNumber(record.costUsd),
        responseChars: response.length,
        responseExcerpt: response.slice(0, EXCERPT_CHARS),
      });
    }
  } catch {
    // No transcript yet.
  }

  const roleMap = new Map<string, LedgerRoleStats>();
  for (const call of calls) {
    const entry = roleMap.get(call.role) ?? {
      role: call.role,
      calls: 0,
      truncated: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
    };
    entry.calls += 1;
    if (call.truncated) entry.truncated += 1;
    entry.promptTokens += call.promptTokens;
    entry.completionTokens += call.completionTokens;
    entry.costUsd += call.costUsd ?? 0;
    entry.avgDurationMs += call.durationMs ?? 0;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, call.durationMs ?? 0);
    roleMap.set(call.role, entry);
  }
  const roles = [...roleMap.values()].map((entry) => ({
    ...entry,
    avgDurationMs: entry.calls > 0 ? Math.round(entry.avgDurationMs / entry.calls) : 0,
  }));

  return {
    taskId,
    workspace,
    exists,
    files,
    calls,
    roles,
    totals: {
      calls: calls.length,
      truncated: calls.filter((call) => call.truncated).length,
      promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
      completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
      costUsd: calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
    },
  };
}
