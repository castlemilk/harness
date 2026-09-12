import { context, propagation } from '@opentelemetry/api';
import type {
  CuttlefishArtifact,
  CuttlefishAttempt,
  CuttlefishRun,
  CuttlefishRunEvent,
  CuttlefishRunner,
  CuttlefishValidationIssue,
  CuttlefishWorkflow,
  CuttlefishWorkflowSummary,
  CuttlefishWorkflowVersion,
  ListRunsParams,
  RunDetail,
  StartRunRequest,
  StartRunResponse,
} from './types.js';

export class CuttlefishApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'CuttlefishApiError';
    this.status = status;
    this.body = body;
  }
}

export interface CuttlefishClientOptions {
  baseUrl: string;
  token?: string;
  projectId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CuttlefishClient {
  readonly baseUrl: string;
  readonly projectId?: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CuttlefishClientOptions) {
    if (!options.baseUrl) throw new Error('CuttlefishClient requires a baseUrl');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.projectId = options.projectId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(new Error('cuttlefish request timed out')); }, options.timeoutMs ?? this.timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.projectId) headers['x-cuttle-project'] = this.projectId;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    // Propagate W3C trace context so cuttlefish control-plane spans join the
    // harness trace. No-op when no tracer provider is registered.
    propagation.inject(context.active(), headers);

    try {
      const res = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = undefined;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) {
        const detail =
          parsed !== null && typeof parsed === 'object' && 'error' in parsed
            ? String((parsed).error)
            : text.slice(0, 300);
        throw new CuttlefishApiError(
          `cuttlefish ${options.method} ${options.path} failed (${String(res.status)})${detail ? `: ${detail}` : ''}`,
          res.status,
          parsed
        );
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof CuttlefishApiError) throw err;
      if (controller.signal.aborted) {
        throw new CuttlefishApiError(
          `cuttlefish ${options.method} ${options.path} timed out after ${String(options.timeoutMs ?? this.timeoutMs)}ms`,
          0
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.request<{ ok?: boolean }>({ method: 'GET', path: '/healthz', timeoutMs: 5_000 });
      return res.ok !== false;
    } catch {
      return false;
    }
  }

  async listWorkflows(): Promise<CuttlefishWorkflowSummary[]> {
    const res = await this.request<{ workflows?: CuttlefishWorkflowSummary[] }>({
      method: 'GET',
      path: '/api/workflows',
    });
    return res.workflows ?? [];
  }

  async getWorkflow(id: string): Promise<CuttlefishWorkflow | null> {
    const res = await this.request<{ workflow?: CuttlefishWorkflow }>({
      method: 'GET',
      path: `/api/workflows/${encodeURIComponent(id)}`,
    });
    return res.workflow ?? null;
  }

  async listWorkflowVersions(workflowId: string): Promise<CuttlefishWorkflowVersion[]> {
    const res = await this.request<{ versions?: CuttlefishWorkflowVersion[] }>({
      method: 'GET',
      path: `/api/workflows/${encodeURIComponent(workflowId)}/versions`,
    });
    return res.versions ?? [];
  }

  async validateWorkflow(workflowYAML: string): Promise<CuttlefishValidationIssue[]> {
    const res = await this.request<{ issues?: CuttlefishValidationIssue[] }>({
      method: 'POST',
      path: '/api/workflows/validate',
      body: { workflowYAML },
    });
    return res.issues ?? [];
  }

  async createWorkflow(input: {
    name: string;
    description?: string;
    draftYAML: string;
  }): Promise<CuttlefishWorkflow> {
    const res = await this.request<{ workflow?: CuttlefishWorkflow }>({
      method: 'POST',
      path: '/api/workflows',
      body: input,
    });
    if (!res.workflow) throw new CuttlefishApiError('cuttlefish createWorkflow returned no workflow', 0, res);
    return res.workflow;
  }

  async updateWorkflowDraft(workflowId: string, draftYAML: string): Promise<CuttlefishWorkflow | null> {
    const res = await this.request<{ workflow?: CuttlefishWorkflow }>({
      method: 'PUT',
      path: `/api/workflows/${encodeURIComponent(workflowId)}/draft`,
      body: { draftYAML },
    });
    return res.workflow ?? null;
  }

  async publishWorkflow(workflowId: string): Promise<CuttlefishWorkflowVersion> {
    const res = await this.request<{ workflowVersion?: CuttlefishWorkflowVersion }>({
      method: 'POST',
      path: `/api/workflows/${encodeURIComponent(workflowId)}/publish`,
      body: {},
    });
    if (!res.workflowVersion) {
      throw new CuttlefishApiError('cuttlefish publishWorkflow returned no workflowVersion', 0, res);
    }
    return res.workflowVersion;
  }

  async startRun(req: StartRunRequest): Promise<StartRunResponse> {
    return this.request<StartRunResponse>({ method: 'POST', path: '/api/runs/start', body: req });
  }

  async getRun(runId: string): Promise<RunDetail | null> {
    try {
      return await this.request<RunDetail>({
        method: 'GET',
        path: `/api/runs/${encodeURIComponent(runId)}`,
      });
    } catch (err) {
      if (err instanceof CuttlefishApiError && err.status === 404) return null;
      throw err;
    }
  }

  async listRuns(params: ListRunsParams = {}): Promise<CuttlefishRun[]> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.runnerId) query.set('runnerId', params.runnerId);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    const res = await this.request<{ runs?: CuttlefishRun[] }>({
      method: 'GET',
      path: `/api/runs${qs ? `?${qs}` : ''}`,
    });
    return res.runs ?? [];
  }

  async cancelRun(runId: string): Promise<CuttlefishRun | null> {
    const res = await this.request<{ run?: CuttlefishRun }>({
      method: 'POST',
      path: `/api/runs/${encodeURIComponent(runId)}/cancel`,
      body: {},
    });
    return res.run ?? null;
  }

  async listRunEvents(runId: string): Promise<CuttlefishRunEvent[]> {
    const res = await this.request<{ events?: CuttlefishRunEvent[] }>({
      method: 'GET',
      path: `/api/runs/${encodeURIComponent(runId)}/events/list`,
    });
    return res.events ?? [];
  }

  async listRunAttempts(runId: string): Promise<CuttlefishAttempt[]> {
    const res = await this.request<{ attempts?: CuttlefishAttempt[] }>({
      method: 'GET',
      path: `/api/runs/${encodeURIComponent(runId)}/attempts`,
    });
    return res.attempts ?? [];
  }

  async getRunLogs(runId: string): Promise<string> {
    const res = await this.request<
      | string
      | {
          logs?: unknown;
          attempts?: { nodeId?: string; logText?: string }[];
        }
    >({
      method: 'GET',
      path: `/api/runs/${encodeURIComponent(runId)}/logs`,
    });
    if (typeof res === 'string') return res;
    if (typeof res.logs === 'string') return res.logs;
    if (Array.isArray(res.attempts)) {
      return res.attempts
        .map((attempt) => {
          const text = typeof attempt.logText === 'string' ? attempt.logText : '';
          const body = text.replace(/\n+$/, '');
          if (!body) return '';
          return attempt.nodeId ? `[${attempt.nodeId}]\n${body}` : body;
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  async listRunArtifacts(runId: string): Promise<CuttlefishArtifact[]> {
    const res = await this.request<{ artifacts?: CuttlefishArtifact[] }>({
      method: 'GET',
      path: `/api/runs/${encodeURIComponent(runId)}/artifacts`,
    });
    return res.artifacts ?? [];
  }

  async listRunners(): Promise<CuttlefishRunner[]> {
    const res = await this.request<{ runners?: CuttlefishRunner[] }>({
      method: 'GET',
      path: '/api/runners',
    });
    return res.runners ?? [];
  }

  /**
   * Control-plane-side run history/trace (job + attempt tree). Used to enrich
   * distributed traces when the runner tier is not OTel-instrumented.
   */
  async getWorkflowRunTrace(runId: string): Promise<unknown> {
    try {
      return await this.request<unknown>({
        method: 'GET',
        path: `/api/workflow-runs/${encodeURIComponent(runId)}/trace`,
      });
    } catch (err) {
      if (err instanceof CuttlefishApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Accepts either a workflow UUID or a workflow name. Used for task tags like
   * `flow:sleepy` and runtime defaults, so humans can reference human names.
   */
  async resolveWorkflow(nameOrId: string): Promise<CuttlefishWorkflow | null> {
    if (UUID_RE.test(nameOrId)) return this.getWorkflow(nameOrId);
    const workflows = await this.listWorkflows();
    return workflows.find((w) => w.name === nameOrId) ?? null;
  }

  /**
   * Resolves a workflow identifier to a published version id. A UUID is
   * assumed to already be a version id; a name resolves to its latest
   * published version.
   */
  async resolveWorkflowVersionId(nameOrId: string): Promise<string | null> {
    if (UUID_RE.test(nameOrId)) return nameOrId;
    const workflow = await this.resolveWorkflow(nameOrId);
    if (!workflow) return null;
    const versions = await this.listWorkflowVersions(workflow.id);
    if (versions.length === 0) return null;
    const latest = [...versions].sort((a, b) => (b.versionNum ?? 0) - (a.versionNum ?? 0))[0];
    return latest.id;
  }
}
