/**
 * Minimal client for the harness HTTP API. The MCP server talks to the API
 * rather than the database directly so the same binary works next to the
 * server (HTTP mount) and remotely (stdio via `harness mcp`).
 */

export interface HarnessApiClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HarnessApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'HarnessApiError';
    this.status = status;
    this.body = body;
  }
}

export class HarnessApiClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HarnessApiClientOptions) {
    if (!options.baseUrl) throw new Error('HarnessApiClient requires a baseUrl');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(new Error('harness request timed out')); }, timeoutMs ?? this.timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) {
        const detail = parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed).error)
          : text.slice(0, 300);
        throw new HarnessApiError(
          `harness ${method} ${path} failed (${String(res.status)})${detail ? `: ${detail}` : ''}`,
          res.status,
          parsed
        );
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof HarnessApiError) throw err;
      if (controller.signal.aborted) {
        throw new HarnessApiError(`harness ${method} ${path} timed out`, 0);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Meta ────────────────────────────────────────────────────────────────
  health(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/health', undefined, 5_000);
  }

  capabilities(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1');
  }

  // ── Projects ────────────────────────────────────────────────────────────
  listProjects(): Promise<unknown> {
    return this.request('GET', '/v1/projects');
  }

  createProject(input: { name: string; path: string; repoUrl?: string; description?: string }): Promise<unknown> {
    return this.request('POST', '/v1/projects', input);
  }

  getProject(id: string): Promise<unknown> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(id)}`);
  }

  // ── Tasks ───────────────────────────────────────────────────────────────
  listTasks(params: { projectId?: string; limit?: number } = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request('GET', `/v1/tasks${qs ? `?${qs}` : ''}`);
  }

  createTask(input: {
    projectId: string;
    title: string;
    description?: string;
    complexity?: 'simple' | 'medium' | 'complex';
    tags?: string[];
  }): Promise<unknown> {
    return this.request('POST', '/v1/tasks', input);
  }

  getTask(id: string): Promise<unknown> {
    return this.request('GET', `/v1/tasks/${encodeURIComponent(id)}`);
  }

  runTask(id: string, options: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('POST', `/v1/tasks/${encodeURIComponent(id)}/run`, options);
  }

  cancelTask(id: string): Promise<unknown> {
    return this.request('POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`, {});
  }

  retryTask(id: string): Promise<unknown> {
    return this.request('POST', `/v1/tasks/${encodeURIComponent(id)}/retry`, {});
  }

  taskTraces(id: string): Promise<unknown> {
    return this.request('GET', `/v1/tasks/${encodeURIComponent(id)}/traces`);
  }

  taskTraceFlow(id: string): Promise<unknown> {
    return this.request('GET', `/v1/tasks/${encodeURIComponent(id)}/trace-flow`);
  }

  taskSteps(id: string): Promise<unknown> {
    return this.request('GET', `/v1/tasks/${encodeURIComponent(id)}/steps`);
  }

  taskAgentRun(id: string): Promise<unknown> {
    return this.request('GET', `/v1/tasks/${encodeURIComponent(id)}/agent-run`);
  }

  // ── Runs / providers / router ───────────────────────────────────────────
  listRuns(params: { limit?: number } = {}): Promise<unknown> {
    const qs = params.limit !== undefined ? `?limit=${String(params.limit)}` : '';
    return this.request('GET', `/v1/runs${qs}`);
  }

  getRun(id: string): Promise<unknown> {
    return this.request('GET', `/v1/runs/${encodeURIComponent(id)}`);
  }

  listProviders(): Promise<unknown> {
    return this.request('GET', '/v1/providers');
  }

  routerSelect(input: { title: string; complexity?: string; tags?: string[] }): Promise<unknown> {
    return this.request('POST', '/v1/router/select', input);
  }

  // ── Runtimes ────────────────────────────────────────────────────────────
  listRuntimes(): Promise<unknown> {
    return this.request('GET', '/v1/runtimes');
  }

  createRuntime(input: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/v1/runtimes', input);
  }

  runtimeHealth(id: string): Promise<unknown> {
    return this.request('POST', `/v1/runtimes/${encodeURIComponent(id)}/health`, {}, 10_000);
  }

  runtimeWorkflows(id: string): Promise<unknown> {
    return this.request('GET', `/v1/runtimes/${encodeURIComponent(id)}/workflows`);
  }

  publishWorkflow(
    runtimeId: string,
    input: {
      name: string;
      workflowYAML: string;
      description?: string;
      updateExisting?: boolean;
      publish?: boolean;
    }
  ): Promise<unknown> {
    return this.request('POST', `/v1/runtimes/${encodeURIComponent(runtimeId)}/workflows`, input, 60_000);
  }

  runtimeRunners(id: string): Promise<unknown> {
    return this.request('GET', `/v1/runtimes/${encodeURIComponent(id)}/runners`);
  }

  startFlow(runtimeId: string, input: { taskId: string; workflow?: string; workflowVersionId?: string }): Promise<unknown> {
    return this.request('POST', `/v1/runtimes/${encodeURIComponent(runtimeId)}/runs`, input);
  }

  // ── Flows ───────────────────────────────────────────────────────────────
  listFlows(params: { taskId?: string; status?: string; limit?: number } = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.taskId) query.set('taskId', params.taskId);
    if (params.status) query.set('status', params.status);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request('GET', `/v1/flows${qs ? `?${qs}` : ''}`);
  }

  getFlow(id: string): Promise<unknown> {
    return this.request('GET', `/v1/flows/${encodeURIComponent(id)}`);
  }

  cancelFlow(id: string): Promise<unknown> {
    return this.request('POST', `/v1/flows/${encodeURIComponent(id)}/cancel`, {});
  }

  flowEvents(id: string): Promise<unknown> {
    return this.request('GET', `/v1/flows/${encodeURIComponent(id)}/events`, undefined, 20_000);
  }

  flowArtifacts(id: string): Promise<unknown> {
    return this.request('GET', `/v1/flows/${encodeURIComponent(id)}/artifacts`, undefined, 20_000);
  }

  flowLogs(id: string): Promise<unknown> {
    return this.request('GET', `/v1/flows/${encodeURIComponent(id)}/logs`, undefined, 20_000);
  }

  flowExternalRun(id: string): Promise<unknown> {
    return this.request('GET', `/v1/flows/${encodeURIComponent(id)}/run`, undefined, 20_000);
  }

  flowTrace(id: string): Promise<unknown> {
    return this.request('GET', `/v1/flows/${encodeURIComponent(id)}/trace`, undefined, 30_000);
  }

  // ── Observability ───────────────────────────────────────────────────────
  observabilityStatus(): Promise<unknown> {
    return this.request('GET', '/v1/observability/status', undefined, 10_000);
  }

  observabilityHotspots(params: { window?: string; limit?: number } = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.window) query.set('window', params.window);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request('GET', `/v1/observability/hotspots${qs ? `?${qs}` : ''}`, undefined, 20_000);
  }

  observabilityTrace(traceId: string): Promise<unknown> {
    return this.request('GET', `/v1/observability/traces/${encodeURIComponent(traceId)}`, undefined, 30_000);
  }
}
