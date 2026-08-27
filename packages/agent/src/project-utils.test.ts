import { describe, expect, it, vi } from 'vitest';
import { createDeadlineGuard, deadlineAtForTask } from './project-utils.js';

describe('deadlineAtForTask', () => {
  it('uses the run timeout when supplied', () => {
    expect(deadlineAtForTask('medium', 1_200_000, 100)).toBe(1_200_100);
  });

  it('falls back to the complexity deadline when no valid run timeout exists', () => {
    expect(deadlineAtForTask('medium', undefined, 100)).toBe(15 * 60_000 + 100);
    expect(deadlineAtForTask('simple', Number.NaN, 100)).toBe(5 * 60_000 + 100);
  });
});

describe('createDeadlineGuard', () => {
  it('aborts in-flight work when the absolute deadline arrives', async () => {
    vi.useFakeTimers();
    try {
      const guard = createDeadlineGuard(Date.now() + 1_000);
      expect(guard.signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(guard.signal.aborted).toBe(true);
      expect(guard.signal.reason).toBeInstanceOf(DOMException);
      guard.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards an external cancellation and removes its listener on dispose', () => {
    const external = new AbortController();
    const guard = createDeadlineGuard(Date.now() + 60_000, external.signal);

    external.abort(new DOMException('cancelled', 'AbortError'));

    expect(guard.signal.aborted).toBe(true);
    expect((guard.signal.reason as DOMException).name).toBe('AbortError');
    guard.dispose();
  });
});
