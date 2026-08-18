/**
 * Use-case data sources.
 *
 * A use-case shell usually fronts a backend that is not Foreman's: Victoria's
 * numbers come from the omega Go API on :8080, a support shell would read a
 * ticketing system, and so on. This module is how a shell reaches one.
 *
 * The rule that shapes everything here: `UseCaseViewProps` does NOT widen. The
 * guest contract stays the same six fields (objectiveId, state, focusId,
 * onFocus, onOpenView, mutate) forever — a shell that needs domain data builds
 * its OWN typed client from `createDataSource` inside its own module and calls
 * it from its own views. Foreman never learns the shell's endpoints, its types,
 * or its auth; it only learns that a source exists (so the chrome can show
 * whether it is reachable) and where it lives.
 *
 * The transport deliberately mirrors `web/dashboard/src/lib/api.ts` in the
 * omega repo — Connect-JSON over plain `fetch` (`POST /<service>/<method>` with
 * `Connect-Protocol-Version: 1`), REST GET, and SSE — because that is what the
 * Go API actually serves and it costs zero client-codegen dependencies. A shell
 * that wants generated stubs can still bring them; nothing here forbids it.
 */

export interface UseCaseDataSourceConfig {
  /** Stable id, unique within the shell. Used as the health dot's key. */
  id: string;
  /** Human name for the health indicator's tooltip, e.g. "Omega API". */
  label: string;
  /** Where the backend lives when nothing overrides it. */
  baseUrl: string;
  /**
   * Vite env var that overrides `baseUrl` when set, by convention
   * `VITE_UC_<ID>_URL`. This is the only way an operator can repoint a shell at
   * a different backend, so it is part of the shell's public surface.
   */
  envVar?: string;
  /**
   * A GET that returns 2xx when the backend is healthy, e.g.
   * `/api/v1/dashboard/status`. Defaults to the base URL itself.
   */
  probePath?: string;
}

export interface ProbeResult {
  ok: boolean;
  /** Round-trip time of the probe request. Present on success. */
  latencyMs?: number;
  /** Why the probe failed — a status line or a transport error. */
  error?: string;
}

export interface SseOptions {
  onError?: (ev: Event) => void;
  /** Aborting the signal closes the stream, for callers already holding one. */
  signal?: AbortSignal;
}

export interface UseCaseDataSource {
  /** The config as resolved — `baseUrl` already reflects any env override. */
  config: UseCaseDataSourceConfig;
  getJson: <T>(path: string) => Promise<T>;
  /** Connect-RPC unary JSON: `POST /<service>/<method>`. */
  postConnect: <T>(service: string, method: string, body?: unknown) => Promise<T>;
  /**
   * Subscribe to an SSE endpoint. Returns the close function.
   *
   * `onMessage` receives unnamed frames only. A stream that uses named events
   * (Foreman's own `init`/`harness`/`pulse` shape) needs `addEventListener` per
   * name — deliberately not wrapped here, because guessing a shell's event
   * vocabulary is how you end up with a second, worse EventSource.
   */
  sse: (path: string, onMessage: (ev: MessageEvent) => void, opts?: SseOptions) => () => void;
  probe: () => Promise<ProbeResult>;
}

/**
 * A failed request against a use-case backend.
 *
 * Carries the status and a bounded excerpt of the body: a shell surfaces this
 * through `mutate` (so it lands in the same error rail as everything else) or
 * in its own UI, and an unbounded body would put a whole HTML error page in the
 * chrome. 400 characters is enough for a Connect error envelope.
 */
export class DataSourceError extends Error {
  readonly status: number;
  readonly bodyExcerpt: string;

  constructor(source: string, status: number, bodyExcerpt: string) {
    super(`${source} failed: ${String(status)}${bodyExcerpt ? ` ${bodyExcerpt}` : ''}`);
    this.name = 'DataSourceError';
    this.status = status;
    this.bodyExcerpt = bodyExcerpt;
  }
}

const BODY_EXCERPT_LIMIT = 400;

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > BODY_EXCERPT_LIMIT
    ? `${trimmed.slice(0, BODY_EXCERPT_LIMIT)}…`
    : trimmed;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * The base URL a source actually uses: the env override when it is set and
 * non-empty, otherwise the declared default. Exported because the health
 * indicator's tooltip and the tests both need it without building a client.
 */
export function resolveBaseUrl(config: UseCaseDataSourceConfig): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const override = config.envVar ? env[config.envVar] : undefined;
  const chosen = override && override.length > 0 ? override : config.baseUrl;
  return stripTrailingSlash(chosen);
}

export function createDataSource(config: UseCaseDataSourceConfig): UseCaseDataSource {
  const baseUrl = resolveBaseUrl(config);
  const resolved: UseCaseDataSourceConfig = { ...config, baseUrl };
  const url = (path: string) => `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  async function readError(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => '');
    throw new DataSourceError(`${config.label}: ${what}`, res.status, excerpt(text));
  }

  return {
    config: resolved,

    async getJson<T>(path: string): Promise<T> {
      const res = await fetch(url(path));
      if (!res.ok) await readError(res, `GET ${path}`);
      return (await res.json()) as T;
    },

    async postConnect<T>(service: string, method: string, body: unknown = {}): Promise<T> {
      const res = await fetch(url(`/${service}/${method}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) await readError(res, `${service}/${method}`);
      return (await res.json()) as T;
    },

    sse(path, onMessage, opts) {
      const source = new EventSource(url(path));
      source.onmessage = onMessage;
      if (opts?.onError) source.onerror = opts.onError;
      const close = () => { source.close(); };
      // `once` so an already-aborted signal still closes and the listener is
      // not left attached to a long-lived controller.
      opts?.signal?.addEventListener('abort', close, { once: true });
      return close;
    },

    async probe(): Promise<ProbeResult> {
      const started = Date.now();
      try {
        const res = await fetch(url(config.probePath ?? '/'), { method: 'GET' });
        const latencyMs = Date.now() - started;
        if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${String(res.status)}` };
        return { ok: true, latencyMs };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
