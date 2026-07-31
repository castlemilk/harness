import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getCodexAvailability, runCodexTurn } from './codex-driver.js';

const FAKE_BIN_DIR = path.join(import.meta.dirname, 'test-fixtures', 'bin');

const originalPath = process.env.PATH;

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
    const result = await runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), 'Implement the feature.', {
      timeoutMs: 10_000,
      threadName: 'task:abc123 Implement the feature',
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
    expect(progress.some((p) => p.phase === 'finalizing')).toBe(true);
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

  it('rejects empty prompts', async () => {
    await expect(runCodexTurn(fs.mkdtempSync(path.join(import.meta.dirname, 'tmp-')), '   ', { timeoutMs: 1000 })).rejects.toThrow(
      'A prompt is required',
    );
  });
});
