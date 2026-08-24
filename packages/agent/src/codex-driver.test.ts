import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getCodexAvailability, runCodexTurn } from './codex-driver.js';

const FAKE_BIN_DIR = path.join(import.meta.dirname, 'test-fixtures', 'bin');

const originalPath = process.env.PATH;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeAll(() => {
  fs.mkdirSync(FAKE_BIN_DIR, { recursive: true });
  fs.symlinkSync(path.join(import.meta.dirname, 'test-fixtures', 'fake-codex.mjs'), path.join(FAKE_BIN_DIR, 'codex'));
});

afterAll(() => {
  fs.rmSync(path.join(FAKE_BIN_DIR, 'codex'), { force: true });
});

beforeEach(() => {
  process.env.PATH = `${FAKE_BIN_DIR}:${originalPath ?? ''}`;
  delete process.env.FAKE_CODEX_MODE;
});

afterEach(() => {
  process.env.PATH = originalPath ?? '';
  delete process.env.FAKE_CODEX_MODE;
});

describe('getCodexAvailability', () => {
  it('detects the codex binary and app-server support', async () => {
    const availability = await getCodexAvailability();
    expect(availability.available).toBe(true);
  });
});

describe('runCodexTurn', () => {
  it('runs a thread/turn against the app-server and captures the completed turn', async () => {
    const progress: { message: string; phase: string | null }[] = [];
    const sessions: string[] = [];
    const result = await runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), 'Implement the feature.', {
      // Threads are ephemeral by default (a persisted rollout per task is
      // litter unless a retry will resume it); this case covers the opt-in
      // persisted path, which is the one that yields a resumable id.
      persistThread: true,
      timeoutMs: 10_000,
      threadName: 'task:abc123 Implement the feature',
      onSession: (threadId) => { sessions.push(threadId); },
      onProgress: (message, phase) => {
        progress.push({ message, phase: phase ?? null });
      },
    });

    expect(result.status).toBe('completed');
    expect(result.threadId).toBe('thread-test-1');
    expect(result.turnId).toBe('turn-test-1');
    expect(result.turn?.status).toBe('completed');
    expect(result.finalMessage).toBe('Done implementing the task.');
    expect(result.touchedFiles).toEqual(expect.arrayContaining(['src/foo.ts', 'src/bar.ts']));
    expect(result.commandExecutions).toHaveLength(1);
    expect(result.commandExecutions[0].command).toBe('pnpm test');
    expect(result.reasoningSummary).toEqual(['Analyzed the code']);
    expect(result.timedOut).toBe(false);
    expect(sessions).toEqual(['thread-test-1']);
    expect(progress.some((p) => p.phase === 'finalizing')).toBe(true);
  });

  it('resumes the exact persistent thread instead of starting a new one', async () => {
    const sessions: string[] = [];
    const result = await runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), 'Continue the same task.', {
      timeoutMs: 2_000,
      resumeThreadId: 'thread-resume-7',
      onSession: (threadId) => { sessions.push(threadId); },
    });

    expect(result.status).toBe('completed');
    expect(result.threadId).toBe('thread-resume-7');
    expect(sessions).toEqual(['thread-resume-7']);
  });

  it('waits for a subagent turn to drain before completing a final answer', async () => {
    process.env.FAKE_CODEX_MODE = 'collaboration';
    const result = await runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), 'Implement the feature.', {
      timeoutMs: 2_000,
    });

    expect(result.status).toBe('completed');
    expect(result.fileChanges).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'subagent-file' })]));
  });

  it('does not finish while a subagent is still draining after the top-level final answer', async () => {
    process.env.FAKE_CODEX_MODE = 'collaboration-final-answer-first';
    const resultPromise = runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), 'Implement the feature.', {
      timeoutMs: 2_000,
    });

    const completionState = await Promise.race([
      resultPromise.then(() => 'completed' as const),
      wait(300).then(() => 'pending' as const),
    ]);
    expect(completionState).toBe('pending');

    const result = await resultPromise;
    expect(result.status).toBe('completed');
    expect(result.fileChanges).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'subagent-file' })]));
  });

  it('interrupts and reports timed-out when the turn never completes', async () => {
    process.env.FAKE_CODEX_MODE = 'hang';
    const result = await runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), 'Implement the feature.', {
      timeoutMs: 200,
    });

    expect(result.status).toBe('timed-out');
    expect(result.timedOut).toBe(true);
    expect(result.turnId).toBe('turn-test-1');
  });

  it('interrupts an active turn promptly when the caller aborts', async () => {
    process.env.FAKE_CODEX_MODE = 'hang';
    const controller = new AbortController();
    const startedAt = Date.now();
    const resultPromise = runCodexTurn(
      fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')),
      'Implement the feature.',
      {
        timeoutMs: 5_000,
        signal: controller.signal,
        onProgress: (_message, phase) => {
          if (phase === 'starting') {
            controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));
          }
        },
      },
    );

    const result = await resultPromise;
    expect(result.status).toBe('interrupted');
    expect(result.timedOut).toBe(false);
    expect(result.error).toEqual(expect.objectContaining({ message: 'Benchmark cancelled' }));
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it('rejects empty prompts', async () => {
    await expect(runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), '   ', { timeoutMs: 1000 })).rejects.toThrow(
      'A prompt is required',
    );
  });
});
