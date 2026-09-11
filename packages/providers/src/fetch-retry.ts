const DEFAULT_MAX_RETRIES = 8;
const REQUEST_TIMEOUT_MS = 120_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Operation aborted', 'AbortError');
}

function backoffMs(attempt: number): number {
  const base = Math.min(2000 * 2 ** attempt, 60_000);
  return Math.floor(Math.random() * base);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 60_000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  return undefined;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface FetchRetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onRetry?: (event: { attempt: number; status?: number; waitMs: number; error?: string }) => void;
}

/**
 * Fetch with a per-request timeout and exponential-backoff retries on
 * network errors and transient statuses (429 / 5xx). Honours `Retry-After`.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  label: string,
  options?: FetchRetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    const controller = new AbortController();
    const externalSignal: AbortSignal | undefined = options?.signal ?? init?.signal ?? undefined;
    const abortFromCaller = (): void => {
      controller.abort(externalSignal?.reason);
    };
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException(`${label} request timed out`, 'TimeoutError'));
    }, timeoutMs);
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromCaller);
      if (externalSignal?.aborted) throw err;
      // Retrying the same request after its transport budget is exhausted can
      // multiply a single slow provider turn into several minutes. Callers
      // may retry the next turn with a fresh prompt/deadline if appropriate.
      if (controller.signal.aborted) throw new DOMException(`${label} request timed out`, 'TimeoutError');
      if (attempt >= maxRetries) throw err;
      const wait = backoffMs(attempt);
      options?.onRetry?.({
        attempt: attempt + 1,
        waitMs: wait,
        error: err instanceof Error ? err.message : String(err),
      });
      console.warn(
        `${label}: network error, retry ${String(attempt + 1)}/${String(maxRetries)} in ${String(wait)}ms`,
      );
      await sleep(wait, externalSignal);
      continue;
    }
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromCaller);
    if (isTransientStatus(res.status) && attempt < maxRetries) {
      await res.text().catch(() => undefined);
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      const wait = retryAfter ?? backoffMs(attempt);
      options?.onRetry?.({ attempt: attempt + 1, status: res.status, waitMs: wait });
      console.warn(
        `${label}: ${String(res.status)} transient, retry ${String(attempt + 1)}/${String(maxRetries)} in ${String(wait)}ms`,
      );
      await sleep(wait, externalSignal);
      continue;
    }
    return res;
  }
}
