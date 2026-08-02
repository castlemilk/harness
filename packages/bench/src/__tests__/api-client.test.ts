import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitForTask, withRetry, ApiError } from '../api-client.js';

describe('waitForTask transient-failure resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('survives a single transient fetch failure and returns the task status', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return { ok: true, status: 200, json: async () => ({ id: 't1', status: 'done' }) };
    }));
    const result = await waitForTask('http://x', 't1', 5000);
    expect(result.status).toBe('done');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('returns failed with a clear error after 3 consecutive failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      throw new TypeError('fetch failed');
    }));
    const result = await waitForTask('http://x', 't1', 5000, 3);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Server unreachable/);
  }, 20000);

  it('returns timeout when the task never finishes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
      ok: true, status: 200, json: async () => ({ id: 't1', status: 'in_progress' }),
    })));
    const result = await waitForTask('http://x', 't1', 1000);
    expect(result.status).toBe('timeout');
  });
});

describe('withRetry retry policy', () => {
  it('does not retry non-retryable 4xx errors (throws immediately, 1 call)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      throw new ApiError(400, 'GET http://x -> 400');
    }));
    await expect(withRetry(() => fetch('http://x'))).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('retries retryable 429 errors up to attempts', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new ApiError(429, 'GET http://x -> 429');
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    const result = await withRetry(() => fetch('http://x'), { attempts: 3, baseDelayMs: 1 });
    expect(calls).toBe(3);
    expect(result).toBeDefined();
  });
});
