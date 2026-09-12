import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLedgerEvalSummary, runLedgerEval, type LedgerEvalProblem } from './ledger-eval.js';
import type { LedgerSend } from '@omega/agent';

const hasPython = spawnSync('python3', ['--version']).status === 0;
const tmpDirs: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-eval-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const problems: LedgerEvalProblem[] = [
  {
    id: 'p-a',
    statement: 'Print A.',
    tests: [{ input: '', output: 'A' }],
  },
  {
    id: 'p-b',
    statement: 'Print B.',
    tests: [{ input: '', output: 'B' }],
  },
];

/**
 * Fake sender: single answers correctly only for p-a; the ledger worker answers
 * correctly for both, so the paired comparison has one ledger-only win.
 */
function fakeSend(): LedgerSend {
  let singleIndex = -1;
  let ledgerIndex = -1;
  let manageCalls = 0;
  let currentProblem = '';
  return async (request) => {
    if (request.role === 'single') {
      singleIndex += 1;
      currentProblem = problems[singleIndex]?.id ?? 'p-a';
    } else if (request.role === 'manager_plan') {
      ledgerIndex += 1;
      manageCalls = 0;
      currentProblem = problems[ledgerIndex]?.id ?? 'p-a';
    }
    const correctOutput = currentProblem === 'p-b' ? 'B' : 'A';
    if (request.role === 'single') {
      const output = currentProblem === 'p-a' ? 'A' : 'WRONG';
      return { text: `\`\`\`python\nprint("${output}")\n\`\`\``, finishReason: 'stop', usage: { completionTokens: 5 } };
    }
    if (request.role === 'manager_plan') {
      return { text: '### PLAN\nPlan.\n### TASKS\n- [todo] do it\n', finishReason: 'stop', usage: { completionTokens: 5 } };
    }
    if (request.role === 'ideation') {
      return { text: '### NOTES\n- idea\n### NEXT\n- approach\n', finishReason: 'stop', usage: { completionTokens: 5 } };
    }
    if (request.role === 'manager') {
      manageCalls += 1;
      return manageCalls === 1
        ? { text: '### STATUS\ncontinue\n### NEXT\nDo it\n### TASKS\n- [todo] Do it\n', finishReason: 'stop', usage: { completionTokens: 5 } }
        : { text: '### STATUS\ndone\n### TASKS\n- [done] Do it\n', finishReason: 'stop', usage: { completionTokens: 5 } };
    }
    return { text: `\`\`\`python\nprint("${correctOutput}")\n\`\`\``, finishReason: 'stop', usage: { completionTokens: 5 } };
  };
}

describe('runLedgerEval', () => {
  it.skipIf(!hasPython)('grades both arms and reports a paired comparison', async () => {
    const root = await makeRoot();
    const report = await runLedgerEval({
      problems,
      provider: { kind: 'ollama', model: 'fake-model' },
      modes: ['single', 'ledger'],
      maxOutputTokens: 128,
      maxIters: 1,
      workspaceRoot: root,
      createSend: () => fakeSend(),
    });

    expect(report.results).toHaveLength(4);
    expect(report.summary.single).toMatchObject({ problems: 2, correct: 1, calls: 2 });
    expect(report.summary.ledger).toMatchObject({ problems: 2, correct: 2, calls: 10 });
    expect(report.paired).toMatchObject({ problems: 2, meanDelta: 0.5 });
    expect(report.paired?.discordant).toEqual({ a: 0, b: 1, both: 1, neither: 0 });
    expect(report.paired?.signFlipP).toBe(1);

    const summary = formatLedgerEvalSummary(report);
    expect(summary).toContain('paired comparison');
    expect(summary).toContain('ledger by role');
    expect(summary).toContain('manager_plan');
  });

  it('records per-call hooks and writes a JSON report', async () => {
    const root = await makeRoot();
    const calls: string[] = [];
    const report = await runLedgerEval({
      problems: [problems[0]],
      provider: { kind: 'ollama', model: 'fake-model' },
      modes: ['ledger'],
      maxIters: 1,
      workspaceRoot: root,
      createSend: (_provider, onCall) => {
        const inner = fakeSend();
        return async (request) => {
          const result = await inner(request);
          onCall?.({ index: calls.length + 1, role: request.role, durationMs: 1, finishReason: result.finishReason });
          calls.push(request.role);
          return result;
        };
      },
    });

    expect(calls).toContain('manager_plan');
    expect(calls).toContain('worker');
    expect(report.results[0].roles?.manager_plan.calls).toBe(1);
    expect(report.grading).toBe('public');
  });
});
