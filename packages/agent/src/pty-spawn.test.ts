import { describe, expect, it } from 'vitest';
import { spawnWithPty } from './pty-spawn.js';

describe('spawnWithPty cancellation', () => {
  it('terminates the PTY process promptly and reports caller cancellation', async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const resultPromise = spawnWithPty(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      {
        cwd: import.meta.dirname,
        timeoutMs: 5_000,
        signal: controller.signal,
      },
    );

    setTimeout(() => {
      controller.abort(new DOMException('Benchmark cancelled', 'AbortError'));
    }, 100);

    const result = await resultPromise;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
