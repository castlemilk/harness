export interface RetryLogger {
  warn: (msg: string, data?: Record<string, unknown>) => void;
}

function errorFromUnknown(value: unknown, fallbackName: string = 'Error'): Error {
  if (value instanceof Error) return value;
  const message = typeof value === 'string' && value.trim().length > 0 ? value : fallbackName;
  return new DOMException(message, fallbackName);
}

function signalError(signal: AbortSignal): Error {
  return errorFromUnknown(signal.reason as unknown, 'AbortError');
}

/** Reject when cancellation wins, while still observing the underlying promise. */
export function abortableOperation<T>(
  operation: Promise<T> | (() => Promise<T>),
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(signalError(signal));
  }

  let pending: Promise<T>;
  try {
    pending = typeof operation === 'function' ? operation() : operation;
  } catch (error) {
    return Promise.reject(errorFromUnknown(error));
  }
  if (!signal) return pending;

  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(signalError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(errorFromUnknown(error));
      },
    );
  });
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
