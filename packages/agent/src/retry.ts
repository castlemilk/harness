export interface RetryLogger {
  warn: (msg: string, data?: Record<string, unknown>) => void;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('AbortError', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('AbortError', 'AbortError'));
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withProviderRetry<T>(
  label: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
  logger: RetryLogger = console,
): Promise<T> {
  const backoffsMs = [30_000, 60_000, 90_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt >= backoffsMs.length) throw err;
      const waitMs = backoffsMs[attempt];
      logger.warn(`${label} call failed, retrying after backoff`, {
        attempt: attempt + 1,
        waitMs,
        error: err instanceof Error ? err.message : String(err),
      });
      await abortableSleep(waitMs, signal);
    }
  }
}
