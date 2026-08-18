import { sseUrl } from '../../lib/api.js';
import type { ObjectiveState } from '@omega-harness/usecase-kit';
import type {
  Harness,
  Intervention,
  Objective,
  Playbook,
  Pulse,
  Ticket,
  Tool,
  TranscriptEntry,
  UsageSummary,
  Workstream,
} from '../types.js';

const API = String(import.meta.env.VITE_API_URL ?? 'http://localhost:4000');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `HTTP ${res.status.toString()}`;
    throw new Error(message);
  }
  return data as T;
}

/**
 * The single payload every shell renders from.
 *
 * Defined in `@omega-harness/usecase-kit` — it is `UseCaseViewProps.state`, so
 * an out-of-tree shell has to be able to name it — and re-exported here because
 * this is where the app has always imported it from and this module is what
 * fetches it.
 */
export type { ObjectiveState };

export interface SpawnHarnessInput {
  objectiveId: string;
  parentId?: string | null;
  workstreamId?: string | null;
  playbookId?: string | null;
  name: string;
  mission: string;
  model: string;
  heartbeatMinutes: number;
  spendCapUsd?: number | null;
  maxChildren: number;
  permissions: { id: string; label: string; granted: boolean; needsApproval: boolean }[];
  dryRun?: boolean;
  taskId?: string | null;
}

export type ResolveAction =
  | 'approve'
  | 'approve-always'
  | 'deny'
  | 'answer'
  | 'raise-cap'
  | 'retire';

export const foremanApi = {
  listObjectives: (projectId?: string) =>
    request<Objective[]>(`/foreman/objectives${projectId ? `?projectId=${projectId}` : ''}`),

  createObjective: (body: {
    projectId: string;
    name: string;
    description?: string;
    targetDate?: string;
    spendCapUsd?: number;
  }) => request<Objective>('/foreman/objectives', { method: 'POST', body: JSON.stringify(body) }),

  getState: (objectiveId: string) =>
    request<ObjectiveState>(`/foreman/objectives/${objectiveId}/state`),

  getHarness: (id: string) => request<Harness>(`/foreman/harnesses/${id}`),

  getPulses: (id: string, limit = 12) =>
    request<Pulse[]>(`/foreman/harnesses/${id}/pulses?limit=${String(limit)}`),

  getTranscript: (id: string) =>
    request<TranscriptEntry[]>(`/foreman/harnesses/${id}/transcript`),

  getTools: (id: string) => request<Tool[]>(`/foreman/harnesses/${id}/tools`),

  runTool: (harnessId: string, toolId: string) =>
    request<Tool>(`/foreman/harnesses/${harnessId}/tools/${toolId}/run`, { method: 'POST' }),

  spawnHarness: (body: SpawnHarnessInput) =>
    request<Harness>('/foreman/harnesses', { method: 'POST', body: JSON.stringify(body) }),

  updateHarness: (id: string, body: Partial<SpawnHarnessInput> & { status?: string }) =>
    request<Harness>(`/foreman/harnesses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  pauseHarness: (id: string, subtree = false) =>
    request<{ updated: number }>(`/foreman/harnesses/${id}/pause`, {
      method: 'POST',
      body: JSON.stringify({ subtree }),
    }),

  resumeHarness: (id: string, subtree = false) =>
    request<{ updated: number }>(`/foreman/harnesses/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({ subtree }),
    }),

  retireHarness: (id: string) =>
    request<Harness>(`/foreman/harnesses/${id}/retire`, { method: 'POST' }),

  interject: (id: string, text: string) =>
    request<TranscriptEntry>(`/foreman/harnesses/${id}/interject`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  listInterventions: (objectiveId: string) =>
    request<Intervention[]>(
      `/foreman/interventions?objectiveId=${objectiveId}&status=pending`,
    ),

  resolveIntervention: (
    id: string,
    body: { action: ResolveAction; response?: string; value?: number },
  ) =>
    request<Intervention>(`/foreman/interventions/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listPlaybooks: () => request<Playbook[]>('/foreman/playbooks'),

  getPlaybook: (id: string) => request<Playbook>(`/foreman/playbooks/${id}`),

  savePlaybookVersion: (
    id: string,
    body: {
      steps: { index: number; text: string; condition: string | null }[];
      variables: string[];
      cadence: string;
      retireWhen: string;
    },
  ) =>
    request<Playbook>(`/foreman/playbooks/${id}/version`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getUsage: (objectiveId: string, days = 7) =>
    request<UsageSummary>(`/foreman/objectives/${objectiveId}/usage?days=${String(days)}`),

  getTickets: (objectiveId: string) =>
    request<Ticket[]>(`/foreman/objectives/${objectiveId}/tickets`),

  pauseWorkstream: (id: string) =>
    request<Workstream>(`/foreman/workstreams/${id}/pause`, { method: 'POST' }),

  resumeWorkstream: (id: string) =>
    request<Workstream>(`/foreman/workstreams/${id}/resume`, { method: 'POST' }),

  /**
   * Models the server can actually serve, from the configured providers.
   * Offering a hardcoded list lets you spawn a harness onto a model nothing
   * serves, which then silently runs on a substitute.
   */
  listModels: async (): Promise<string[]> => {
    const providers = await request<
      { defaultModel: string; enabled: boolean; capabilities?: unknown }[]
    >('/providers');
    const models = new Set<string>();
    for (const p of providers) {
      if (!p.enabled) continue;
      if (p.defaultModel) models.add(p.defaultModel);
      const caps = typeof p.capabilities === 'string'
        ? (JSON.parse(p.capabilities) as { name?: string }[])
        : (p.capabilities as { name?: string }[] | undefined);
      for (const c of caps ?? []) if (c.name) models.add(c.name);
    }
    return [...models];
  },

  streamUrl: (objectiveId: string) => sseUrl(`/foreman/stream?objectiveId=${objectiveId}`),
};
