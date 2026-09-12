import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runLedgerLoop } from './loop.js';
import { bullets, classifyStatus, extractPython, parseTasks, sections, stripThink } from './parse.js';
import { FINALIZE_GOAL } from './prompts.js';
import { runSingleCall } from './single.js';
import type {
  LedgerCallRequest,
  LedgerCallResult,
  LedgerProblem,
  LedgerSend,
  LedgerSpec,
} from './types.js';

const tmpDirs: string[] = [];

const USAGE = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };

const spec: LedgerSpec = { kind: 'code', solverSystem: 'You are a test solver.' };

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function scripted(responses: LedgerCallResult[]): {
  send: LedgerSend;
  requests: LedgerCallRequest[];
} {
  const requests: LedgerCallRequest[] = [];
  let index = 0;
  const send: LedgerSend = async (request) => {
    requests.push(request);
    const response = responses[index];
    index += 1;
    if (!response) throw new Error(`unexpected send call #${index} (${request.role})`);
    return response;
  };
  return { send, requests };
}

function reply(text: string, extra: Partial<LedgerCallResult> = {}): LedgerCallResult {
  return { text, finishReason: 'stop', usage: { ...USAGE }, ...extra };
}

function transcriptPath(dir: string): string {
  return path.join(dir, 'transcript.jsonl');
}

describe('runLedgerLoop', () => {
  it('runs the full happy path and maintains the workspace protocol', async () => {
    const dir = await makeWorkspace();
    const problem: LedgerProblem = { id: 'p-happy', statement: 'Print the answer.' };
    const { send, requests } = scripted([
      reply('### PLAN\nUse dynamic programming.\n### TASKS\n- [todo] Implement DP\n'),
      reply('### NOTES\n- **Idea:** brute force then DP\n### NEXT\n- try DP over suffixes\n'),
      reply('### STATUS\ncontinue\n### NEXT\nImplement DP over suffixes\n### TASKS\n- [todo] Implement DP over suffixes\n'),
      reply('### CODE\n```python\nprint("v1")\n```\n### NOTES\n- **Idea:** first notes\n### NEXT\n- polish\n### STATUS\ncontinue\n'),
      reply('### STATUS\ncontinue\n### NEXT\nPolish edge cases\n### TASKS\n- [done] Implement DP over suffixes\n- [todo] Polish edge cases\n'),
      reply('### CODE\n```python\nprint("v2")\n```\n### NOTES\n- **Idea:** second notes\n### NEXT\n- none\n### STATUS\nsolved\n'),
      reply('### STATUS\ndone\n### TASKS\n- [done] Implement DP over suffixes\n- [done] Polish edge cases\n'),
    ]);

    const result = await runLedgerLoop(send, problem, spec, { workspaceDir: dir, maxOutputTokens: 123 });

    expect(result.status).toBe('done');
    expect(result.solution).toContain('print("v2")');
    expect(result.truncatedCalls).toBe(0);
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 14, totalTokens: 21 });
    expect(result.ws).toBe(dir);
    expect(requests).toHaveLength(7);
    expect(requests.every((request) => request.maxOutputTokens === 123)).toBe(true);
    expect(result.calls.map((call) => call.role)).toEqual([
      'manager_plan',
      'ideation',
      'manager',
      'worker',
      'manager',
      'worker',
      'manager',
    ]);

    expect(await fs.readFile(path.join(dir, 'task.md'), 'utf8')).toBe(problem.statement);
    expect(await fs.readFile(path.join(dir, 'plan.md'), 'utf8')).toContain('Use dynamic programming.');

    const notes = await fs.readFile(path.join(dir, 'notes.md'), 'utf8');
    expect(notes.trim()).toBe('- **Idea:** second notes');
    expect(notes).not.toContain('## ideation');
    expect(notes).not.toContain('first notes');

    const tasks = JSON.parse(await fs.readFile(path.join(dir, 'tasks.json'), 'utf8')) as {
      id: number;
      desc: string;
      status: string;
    }[];
    expect(tasks.map((task) => task.status)).toEqual(['done', 'done']);

    const lines = (await fs.readFile(transcriptPath(dir), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(result.calls.length + 1);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    const meta = JSON.parse(lines[0]) as { _meta: boolean; model?: string; problem: string };
    expect(meta._meta).toBe(true);
    expect(meta.problem).toBe('p-happy');
    expect(meta.model).toBeUndefined();
    const firstCall = JSON.parse(lines[1]) as { role: string; truncated: boolean };
    expect(firstCall.role).toBe('manager_plan');
    expect(firstCall.truncated).toBe(false);
  });

  it('stops with no_progress when the manager reissues the same task', async () => {
    const dir = await makeWorkspace();
    const problem: LedgerProblem = { id: 'p-stuck', statement: 'Print the answer.' };
    const { send, requests } = scripted([
      reply('### PLAN\nPlan.\n### TASKS\n- [todo] Same task\n'),
      reply('### NOTES\n- **Idea:** one approach\n### NEXT\n- one approach\n'),
      reply('### STATUS\ncontinue\n### NEXT\nSame task\n### TASKS\n- [todo] Same task\n'),
      reply('### CODE\n```python\nprint("wip")\n```\n### NOTES\n- **Idea:** wip\n### NEXT\n- Same task\n### STATUS\ncontinue\n'),
      reply('### STATUS\ncontinue\n### NEXT\nsame task \n### TASKS\n- [todo] Same task\n'),
      reply('### CODE\n```python\nprint("final")\n```\n'),
    ]);

    const result = await runLedgerLoop(send, problem, spec, { workspaceDir: dir });

    expect(result.status).toBe('no_progress');
    expect(requests).toHaveLength(6);
    expect(requests[2].role).toBe('manager');
    expect(requests[5].user).toContain(FINALIZE_GOAL);
    expect(result.solution).toContain('print("final")');
  });

  const pythonAvailable = ((): boolean => {
    try {
      return spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
      return false;
    }
  })();

  it.skipIf(!pythonAvailable)('sample test failure overrides manager done and forces a fix round', async () => {
    const dir = await makeWorkspace();
    const problem: LedgerProblem = {
      id: 'p-tests',
      statement: 'Print right.',
      tests: [{ input: '', output: 'right' }],
    };
    const { send, requests } = scripted([
      reply('### PLAN\nPlan.\n### TASKS\n- [todo] Write the program\n'),
      reply('### NOTES\n- **Idea:** print\n### NEXT\n- print\n'),
      reply('### STATUS\ncontinue\n### NEXT\nWrite the program\n### TASKS\n- [todo] Write the program\n'),
      reply('### CODE\n```python\nprint("wrong")\n```\n### NOTES\n- **Idea:** wrong output\n### NEXT\n- fix\n### STATUS\ncontinue\n'),
      reply('### STATUS\ndone\n### TASKS\n- [done] Write the program\n'),
      reply('### CODE\n```python\nprint("right")\n```\n### NOTES\n- **Idea:** fixed output\n### NEXT\n- none\n### STATUS\nsolved\n'),
      reply('### STATUS\ndone\n### TASKS\n- [done] Write the program\n'),
    ]);

    const result = await runLedgerLoop(send, problem, spec, { workspaceDir: dir });

    expect(result.status).toBe('done');
    expect(result.solution).toContain('print("right")');
    expect(requests).toHaveLength(7);
    expect(requests[5].user).toContain('Fix the failing sample test');
    expect(requests[6].user).toContain('[SAMPLE TESTS: PASSED all 1 public samples');
  });

  it('runs a cutoff summary on truncation and preserves notes', async () => {
    const dir = await makeWorkspace();
    const problem: LedgerProblem = { id: 'p-cutoff', statement: 'Print the answer.' };
    const { send, requests } = scripted([
      reply('### PLAN\nPlan.\n### TASKS\n- [todo] Task X\n'),
      reply('### NOTES\n- **Idea:** keep me\n### NEXT\n- Task X\n'),
      reply('### STATUS\ncontinue\n### NEXT\nTask X\n### TASKS\n- [todo] Task X\n'),
      {
        text: '### CODE\n```python\nprint("partial")\n```\n### NOTES\n- **Idea:** should not land\n',
        finishReason: 'length',
        usage: { ...USAGE },
      },
      reply('It was pursuing brute force and got halfway.'),
      reply('### STATUS\ndone\n### TASKS\n- [done] Task X\n'),
    ]);

    const result = await runLedgerLoop(send, problem, spec, { workspaceDir: dir });

    expect(result.status).toBe('done');
    expect(result.truncatedCalls).toBe(1);
    expect(requests).toHaveLength(6);
    expect(requests[4].role).toBe('cutoff_summary');
    expect(requests[4].user).toContain('Task X');
    expect(requests[4].user).toContain('print("partial")');
    expect(requests[5].user).toContain('EXCEEDED THE TOKEN LIMIT');

    const notes = await fs.readFile(path.join(dir, 'notes.md'), 'utf8');
    expect(notes).toContain('## ideation');
    expect(notes).not.toContain('should not land');
    expect(result.solution).toContain('print("partial")');
  });

  it('returns failed when no artifact is ever produced', async () => {
    const dir = await makeWorkspace();
    const problem: LedgerProblem = { id: 'p-fail', statement: 'Print the answer.' };
    const { send } = scripted([
      reply('### PLAN\nPlan.\n### TASKS\n- [todo] Something\n'),
      reply('### NOTES\n- **Idea:** nothing\n### NEXT\n- nothing\n'),
      reply('### STATUS\ncontinue\n### NEXT\nDo something\n### TASKS\n- [todo] Do something\n'),
      reply('### NOTES\n- **Idea:** still nothing\n### NEXT\n- none\n### STATUS\ncontinue\n'),
      reply('### STATUS\ndone\n### TASKS\n- [done] Do something\n'),
      reply('No code here.'),
    ]);

    const result = await runLedgerLoop(send, problem, spec, { workspaceDir: dir, maxIters: 1 });
    expect(result.status).toBe('failed');
    expect(result.solution.trim()).toBe('');
  });
});

describe('parse helpers', () => {
  it('strips think blocks', () => {
    expect(stripThink('a\n<thinking>hidden</thinking>\nb')).toBe('a\n\nb');
    expect(stripThink('a\n<think>hidden</think>\nb')).toBe('a\n\nb');
  });

  it('parses sections in all three header forms', () => {
    const text = [
      'noise before',
      '### PLAN',
      'plan body',
      'STATUS: continue',
      '**TASKS**',
      '- [todo] one',
    ].join('\n');
    const parsed = sections(text, ['PLAN', 'TASKS', 'STATUS']);
    expect(parsed.PLAN).toBe('plan body');
    expect(parsed.STATUS).toBe('continue');
    expect(parsed.TASKS).toBe('- [todo] one');
  });

  it('handles inline heading bodies and unknown headings as boundaries', () => {
    const text = '### STATUS done\n### NOTES\nkept\n### OTHER\nlost\n### NEXT\n- go\n';
    const parsed = sections(text, ['STATUS', 'NOTES', 'NEXT']);
    expect(parsed.STATUS).toBe('done');
    expect(parsed.NOTES).toBe('kept');
    expect(parsed.NEXT).toBe('- go');
  });

  it('extracts bullets', () => {
    expect(bullets('- a\n* b\n  - c\nplain\n\n')).toEqual(['a', 'b', 'c']);
  });

  it('extracts python fences with fallback', () => {
    expect(extractPython('```\nplain\n```\n```python\ncode\n```')).toBe('code\n');
    expect(extractPython('```sh\necho hi\n```')).toBe('echo hi\n');
    expect(extractPython('no fence')).toBe('');
  });

  it('parses and renumbers tasks', () => {
    const text = '### TASKS\n- [todo] first\n- [done] second\n- [in progress] third\n- [todo] fourth\n';
    expect(parseTasks(text)).toEqual([
      { id: 1, desc: 'first', status: 'pending' },
      { id: 2, desc: 'second', status: 'done' },
      { id: 3, desc: 'third', status: 'in_progress' },
      { id: 4, desc: 'fourth', status: 'pending' },
    ]);
    expect(parseTasks(text, 2).map((task) => task.desc)).toEqual(['first', 'second']);
    expect(parseTasks(text, 2).map((task) => task.id)).toEqual([1, 2]);
  });

  it('classifies call status with the specified precedence', () => {
    expect(classifyStatus('length', true)).toBe('ok');
    expect(classifyStatus('stop', false, true)).toBe('infra');
    expect(classifyStatus('error', false)).toBe('error');
    expect(classifyStatus('length', false)).toBe('truncated');
    expect(classifyStatus('stop', false)).toBe('empty_stop');
    expect(classifyStatus(undefined, false)).toBe('empty_stop');
  });
});

describe('runSingleCall', () => {
  it('sends one solver request and extracts the code', async () => {
    const { send, requests } = scripted([reply('intro\n```python\nprint(1)\n```\n')]);
    const result = await runSingleCall(
      send,
      { id: 'p-single', statement: 'Say 1.' },
      { kind: 'code', solverSystem: 'SYS' },
      { maxOutputTokens: 55 },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      role: 'single',
      system: 'SYS',
      user: 'Say 1.',
      temperature: 0.2,
      maxOutputTokens: 55,
    });
    expect(result.code).toBe('print(1)\n');
    expect(result.text).toContain('intro');
  });
});