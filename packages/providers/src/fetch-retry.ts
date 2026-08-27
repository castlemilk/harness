const DEFAULT_MAX_RETRIES = 8;
const REQUEST_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
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
      await sleep(wait);
      continue;
    }
    clearTimeout(timeoutId);
    if (isTransientStatus(res.status) && attempt < maxRetries) {
      await res.text().catch(() => undefined);
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      const wait = retryAfter ?? backoffMs(attempt);
      options?.onRetry?.({ attempt: attempt + 1, status: res.status, waitMs: wait });
      console.warn(
        `${label}: ${String(res.status)} transient, retry ${String(attempt + 1)}/${String(maxRetries)} in ${String(wait)}ms`,
      );
      await sleep(wait);
      continue;
    }
    return res;
  }
}
