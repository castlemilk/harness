import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectLedgerWorkspace } from './ledger-inspect.js';

let storageRoot = '';
let previousRoot: string | undefined;

beforeAll(async () => {
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omega-ledger-inspect-'));
  previousRoot = process.env.OMEGA_STORAGE_ROOT;
  process.env.OMEGA_STORAGE_ROOT = storageRoot;
});

afterAll(async () => {
  if (previousRoot === undefined) delete process.env.OMEGA_STORAGE_ROOT;
  else process.env.OMEGA_STORAGE_ROOT = previousRoot;
  await fs.rm(storageRoot, { recursive: true, force: true });
});

async function seedWorkspace(taskId: string): Promise<string> {
  const ws = path.join(storageRoot, 'work', 'orchestrations', taskId);
  await fs.mkdir(ws, { recursive: true });
  const calls = [
    { _meta: true, model: 'test', problem: taskId },
    {
      role: 'manager_plan',
      request: { role: 'manager_plan', temperature: 0.3 },
      response: 'PLAN...',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      costUsd: 0.001,
      truncated: false,
      startedAt: 1000,
      durationMs: 500,
    },
    {
      role: 'worker',
      request: { role: 'worker', temperature: 0.2 },
      response: 'CODE...',
      finishReason: 'length',
      usage: { promptTokens: 30, completionTokens: 40, totalTokens: 70 },
      truncated: true,
      startedAt: 2000,
      durationMs: 1500,
    },
  ];
  await fs.writeFile(
    path.join(ws, 'transcript.jsonl'),
    `${calls.map((call) => JSON.stringify(call)).join('\n')}\n`,
    'utf-8'
  );
  await fs.writeFile(path.join(ws, 'plan.md'), 'the plan', 'utf-8');
  await fs.writeFile(path.join(ws, 'solution.py'), 'print(1)\n', 'utf-8');
  await fs.writeFile(path.join(ws, 'tasks.json'), '[]', 'utf-8');
  return ws;
}

describe('inspectLedgerWorkspace', () => {
  it('summarizes calls, roles and files', async () => {
    await seedWorkspace('task-1');
    const result = await inspectLedgerWorkspace('task-1');
    expect(result.exists).toBe(true);
    expect(result.totals).toMatchObject({ calls: 2, truncated: 1, promptTokens: 40, completionTokens: 60 });
    expect(result.totals.costUsd).toBeCloseTo(0.001);
    expect(result.calls[0]).toMatchObject({ role: 'manager_plan', finishReason: 'stop', durationMs: 500 });
    expect(result.calls[1]).toMatchObject({ role: 'worker', truncated: true, completionTokens: 40 });

    const manager = result.roles.find((role) => role.role === 'manager_plan');
    const worker = result.roles.find((role) => role.role === 'worker');
    expect(manager).toMatchObject({ calls: 1, truncated: 0, completionTokens: 20, avgDurationMs: 500 });
    expect(worker).toMatchObject({ calls: 1, truncated: 1, completionTokens: 40, avgDurationMs: 1500 });

    expect(result.files['plan.md'].content).toBe('the plan');
    expect(result.files['solution.py'].bytes).toBeGreaterThan(0);
    expect(result.files['notes.md']).toMatchObject({ bytes: 0 });
  });

  it('reports a missing workspace', async () => {
    const result = await inspectLedgerWorkspace('missing-task');
    expect(result.exists).toBe(false);
    expect(result.calls).toEqual([]);
  });
});
