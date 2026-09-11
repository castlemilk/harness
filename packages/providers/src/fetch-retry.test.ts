import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from './fetch-retry.js';

describe('fetchWithRetry cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts a retry backoff immediately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = fetchWithRetry('http://provider.test', undefined, 'provider', {
      maxRetries: 2,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(new DOMException('cancelled', 'AbortError')), 10);

    await expect(pending).rejects.toThrow('cancelled');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('does not retry after the per-request timeout expires', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true });
      }));
      vi.stubGlobal('fetch', fetchSpy);

      const pending = fetchWithRetry('http://provider.test', undefined, 'provider', {
        maxRetries: 2,
        timeoutMs: 20,
      });
      const rejection = expect(pending).rejects.toThrow(/timed out/i);

      await vi.advanceTimersByTimeAsync(20);
      await rejection;
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
