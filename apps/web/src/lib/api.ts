import type { Project } from '../components/ProjectSidebar.js';
import type { Provider } from '../components/ProviderSettings.js';
import type { Task } from '../components/TaskBoard.js';

const API = String(import.meta.env.VITE_API_URL ?? 'http://localhost:4000');

export function sseUrl(path: string): string {
  return `${API}${path}`;
}

export const streamUrls = {
  tasks: () => sseUrl('/tasks/stream'),
  task: (id: string) => sseUrl(`/tasks/${id}/stream`),
};

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `HTTP ${res.status.toString()}`;
    throw new Error(message);
  }
  return data as T;
}

export interface BenchmarkBaselineComparison {
  baseline: { file: string; timestamp: string };
  candidate: { file: string; timestamp: string };
  summary: {
    passedDelta: number;
    failedDelta: number;
    passRateBaseline: number;
    passRateCandidate: number;
    regressions: string[];
    improvements: string[];
  };
  results: {
    taskId: string;
    taskName: string;
    baselinePassed: boolean;
    candidatePassed: boolean;
    baselineScore?: number;
    candidateScore?: number;
    durationDeltaMs?: number;
    tokenDelta?: number;
  }[];
}

export const api = {
  getProjects: () => request<Project[]>('/projects'),
  createProject: (body: { name: string; path: string; repoUrl?: string; description?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),

  getTasks: (projectId?: string, opts?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ tasks: Task[]; total: number; limit: number; offset: number }>(`/tasks${qs ? `?${qs}` : ''}`);
  },
  createTask: (body: {
    projectId: string;
    title: string;
    description?: string;
    complexity?: string;
    tags?: string[];
  }) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  runTask: (id: string) => request<Task>(`/tasks/${id}/run`, { method: 'POST' }),
  retryTask: (id: string, strategy?: string) =>
    request<{ status: string; strategy: string; retryCount: number }>(
      `/tasks/${id}/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(strategy ? { strategy } : {}),
      }
    ),
  updateTask: (id: string, body: Record<string, unknown>) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getProviders: () => request<Provider[]>('/providers'),
  createProvider: (body: Record<string, unknown>) =>
    request<Provider>('/providers', { method: 'POST', body: JSON.stringify(body) }),
  toggleProvider: (id: string) => request<Provider>(`/providers/${id}/toggle`, { method: 'PATCH' }),
  deleteProvider: (id: string) => request(`/providers/${id}`, { method: 'DELETE' }),

  selectProvider: (body: { title: string; complexity: string; tags: string[] }) =>
    request<{ provider: string; model: string }>('/router/select', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  selectProviderIntelligent: (body: {
    title: string;
    description?: string;
    complexity: string;
    tags: string[];
    strategy?: string;
    budgetUsd?: number;
  }) =>
    request<{
      decision: {
        primary: { provider: string; model: string; score: number; breakdown: Record<string, number> };
        fallbacks: { provider: string; model: string; score: number; breakdown: Record<string, number> }[];
        classification: { complexity: string; domain: string; requiredCapabilities: string[]; estimatedTokens: number };
        strategy: string;
        reasoning: string;
      };
      ranking: { provider: string; model: string; score: number; breakdown: Record<string, number> }[];
      health: Record<string, { latencyP50: number; latencyP95: number; errorRate: number; rateLimitRate: number; score: number }>;
    }>('/router/intelligent', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getMetrics: () => request('/metrics'),
  getTaskSteps: (id: string) => request(`/tasks/${id}/steps`),
  getTaskTraces: (id: string) => request(`/tasks/${id}/traces`),
  getTaskDiffs: (id: string) => request(`/tasks/${id}/diffs`),
  getTaskAgentRun: (id: string) => request(`/tasks/${id}/agent-run`),
  getTraceFlow: (id: string) => request(`/tasks/${id}/trace-flow`),
  getTraceAnalysis: (id: string) => request(`/tasks/${id}/trace-analysis`),

  getBenchmarkReports: () => request<{ benchmark: string[]; ab: string[] }>('/benchmarks/reports'),
  getBenchmarkReport: (file: string) => request<Record<string, unknown>>(`/benchmarks/reports/${encodeURIComponent(file)}`),
  getAbReport: (file: string) => request<Record<string, unknown>>(`/benchmarks/reports/${encodeURIComponent(file)}`),
  getBenchmarkRunStatus: () => request<{ running: boolean; pid?: number; output?: string }>('/benchmarks/run-status'),
  runBenchmark: (body: Record<string, unknown>) => request<{ pid: number; status: string }>('/benchmarks/run', { method: 'POST', body: JSON.stringify(body) }),

  getBenchmarkBaseline: () =>
    request<{ file: string | null; report?: Record<string, unknown> }>('/benchmarks/baseline'),
  setBenchmarkBaseline: (file?: string) =>
    request<{ file: string; report: Record<string, unknown> }>('/benchmarks/baseline', {
      method: 'POST',
      body: JSON.stringify(file ? { file } : {}),
    }),
  compareBenchmarkBaseline: (candidate: string) =>
    request<BenchmarkBaselineComparison>(
      `/benchmarks/baseline/compare?candidate=${encodeURIComponent(candidate)}`
    ),

  getPromptVersions: () =>
    request<
      {
        id: string;
        name: string;
        sourcePath: string;
        systemPrompt: string;
        textToolsPrompt: string;
        hash: string;
        metadata?: string | null;
        createdAt: string;
      }[]
    >('/prompt-versions'),

  getCostSummary: () =>
    request<{
      totalCostUsd: number;
      costByProvider: Record<string, number>;
      costByModel: Record<string, number>;
      costByDay: Record<string, number>;
      totalTokens: number;
      avgCostPerRun: number;
      avgTokensPerRun: number;
      runsWithCost: number;
    }>('/costs/summary'),

  getCostTimeseries: (bucket: 'hour' | 'day' | 'week' = 'day', days = 30) =>
    request<{
      bucket: string;
      costUsd: number;
      tokens: number;
      runs: number;
      avgDurationMs: number;
    }[]>(`/costs/timeseries?bucket=${bucket}&days=${String(days)}`),

  getTaskTimeseries: (bucket: 'hour' | 'day' | 'week' = 'day', days = 30) =>
    request<{
      created: { bucket: string; count: number }[];
      completed: { bucket: string; count: number }[];
      failed: { bucket: string; count: number }[];
      passRate: { bucket: string; rate: number }[];
    }>(`/timeseries/tasks?bucket=${bucket}&days=${String(days)}`),

  getProviderTimeseries: (bucket: 'hour' | 'day' | 'week' = 'day', days = 30) =>
    request<{
      bucket: string;
      provider: string;
      runs: number;
      avgDurationMs: number;
      totalTokens: number;
    }[]>(`/timeseries/providers?bucket=${bucket}&days=${String(days)}`),

  // Server-side benchmark runs
  startBenchRun: (body: {
    suite: string;
    models?: { provider: string; model: string }[];
    strategy?: 'single' | 'consensus' | 'variance';
    concurrency?: number;
    timeoutMs?: number;
    tokenBudget?: number;
    nTasks?: number;
    taskIds?: string[];
    varianceRuns?: number;
  }) => request<{ id: string; status: string; suite: string }>('/bench/run', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  listBenchRuns: (limit = 20) =>
    request<{
      id: string;
      suite: string;
      status: string;
      totalTasks: number;
      passed: number;
      failed: number;
      timeouts: number;
      totalDurationMs: number;
      totalCostUsd: number | null;
      error: string | null;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
    }[]>(`/bench/run?limit=${String(limit)}`),

  getBenchRun: (id: string) =>
    request<{
      id: string;
      suite: string;
      status: string;
      config: Record<string, unknown>;
      totalTasks: number;
      passed: number;
      failed: number;
      timeouts: number;
      totalDurationMs: number;
      totalCostUsd: number | null;
      totalTokens: number;
      results: {
        taskName: string;
        harnessTaskId: string;
        passed: boolean;
        durationMs: number;
        /** Absent on benchmark rows persisted before per-task evaluations landed. */
        evaluation?: {
          passed: boolean;
          score?: number;
          message?: string;
          metrics?: Record<string, number | string>;
        };
        /** Absent on benchmark run rows written before per-task usage landed. */
        costUsd?: number;
        totalTokens?: number;
        model?: string;
        winnerModel?: string;
        variancePassRate?: number;
        error?: string;
      }[] | null;
      error: string | null;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
    }>(`/bench/run/${id}`),

  cancelBenchRun: (id: string) =>
    request<{ cancelled: boolean }>(`/bench/run/${id}/cancel`, { method: 'POST' }),

  benchRunStreamUrl: (id: string) => sseUrl(`/bench/run/${id}/stream`),

  // ── Router ──────────────────────────────────────────────

  getStrategyLearning: () =>
    request<{
      domain: string;
      complexity: string;
      wins: number;
      total: number;
      passRate: number;
      avgScore: number;
    }[]>('/router/learning'),

  getProviderHealth: () =>
    request<{
      provider: string;
      latencyP50: number;
      latencyP95: number;
      errorRate: number;
      rateLimitRate: number;
      recentCalls: number;
      score: number;
    }[]>('/router/health'),

  // ── Costs per task ─────────────────────────────────────

  getCostsPerTask: (limit = 50) =>
    request<{
      taskId: string;
      title: string;
      status: string;
      complexity: string | null;
      provider: string;
      model: string;
      costUsd: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      createdAt: string;
    }[]>(`/costs/per-task?limit=${String(limit)}`),

  // ── Error analysis ──────────────────────────────────────

  getErrors: (limit = 100) =>
    request<{
      total: number;
      byCategory: Record<string, { count: number; providers: Record<string, number> }>;
      dailyTrend: Record<string, Record<string, number>>;
      topErrors: { pattern: string; count: number; category: string; sample: string }[];
      recent: { taskId: string; title: string; provider: string | null; model: string | null; error: string; category: string; timestamp: string }[];
    }>(`/errors?limit=${String(limit)}`),

  // ── Traces ──────────────────────────────────────────────

  getTraces: (limit = 30) =>
    request<{
      traceId: string;
      taskId: string;
      startedAt: number;
      events: { ts: number; phase: string; data?: Record<string, unknown> }[];
      completedAt?: number;
      outcome?: string;
      totalMs?: number;
      provider?: string;
      model?: string;
    }[]>(`/traces?limit=${String(limit)}`),

  getTraceStats: () =>
    request<{
      totalTraces: number;
      avgMs: number;
      byOutcome: Record<string, number>;
      byProvider: Record<string, { count: number; avgMs: number; errorRate: number }>;
    }>('/traces/stats'),

  // ── Provider comparison ─────────────────────────────────

  getProviderCompare: () =>
    request<{
      provider: string;
      model: string;
      total: number;
      passed: number;
      failed: number;
      avgDurationMs: number;
      passRate: number;
      topErrors: { error: string; count: number }[];
      byComplexity: Record<string, { total: number; passed: number }>;
    }[]>('/providers/compare'),

  // ── Task replay ─────────────────────────────────────────

  replayTask: (id: string, body: { provider?: string; model?: string; description?: string }) =>
    request<{
      original: { id: string; title: string; provider: string | null; model: string | null; status: string; result: string | null; error: string | null };
      replay: Record<string, unknown>;
      trace: Record<string, unknown> | null;
    }>(`/tasks/${id}/replay`, { method: 'POST', body: JSON.stringify(body) }),
};
