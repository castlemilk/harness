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

/**
 * The server's `FOREMAN_TOOLS_SECRET`, if this build was given it, sent on the
 * routes that can cause a shell command to run — and on every READ that carries
 * a command or a captured output: the tool list, the harness detail, the
 * objective state, the interventions queue and the stream. Without it those
 * reads still answer, with the command and output replaced by
 * `«secret required»`.
 *
 * This is DEV CONVENIENCE, not a security boundary: a secret compiled into a
 * served SPA is readable by anyone who can load the page, so all it really buys
 * is that a cross-origin page cannot forge the request without it — CSRF-grade.
 * The posture that actually holds is the loopback bind.
 */
const TOOLS_SECRET = String(import.meta.env.VITE_FOREMAN_TOOLS_SECRET ?? '');

function toolsHeaders(): Record<string, string> {
  return TOOLS_SECRET.length > 0 ? { 'x-foreman-tools-secret': TOOLS_SECRET } : {};
}

async function request<T>(
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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
  /** SkillArtifact names granted to this harness; injected into its pulses. */
  skills?: string[];
  dryRun?: boolean;
  taskId?: string | null;
}

export interface SkillListing {
  name: string;
  description: string;
  sourcePath: string;
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
    /** A registered shell id. The server validates the slug shape, not the id. */
    useCase?: string;
    targetDate?: string;
    spendCapUsd?: number;
  }) => request<Objective>('/foreman/objectives', { method: 'POST', body: JSON.stringify(body) }),

  updateObjective: (
    id: string,
    body: {
      name?: string;
      description?: string | null;
      instructions?: string | null;
      useCase?: string | null;
      targetDate?: string | null;
      spendCapUsd?: number | null;
      status?: 'active' | 'complete' | 'archived';
    },
  ) => request<Objective>(`/foreman/objectives/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  createWorkstream: (body: { objectiveId: string; name: string; orderIdx?: number }) =>
    request<Workstream>('/foreman/workstreams', { method: 'POST', body: JSON.stringify(body) }),

  updateWorkstream: (id: string, body: { name?: string; orderIdx?: number; leadHarnessId?: string | null }) =>
    request<Workstream>(`/foreman/workstreams/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  listSkills: () => request<SkillListing[]>('/foreman/skills'),

  // Carries every pending intervention, and a tool approval's whole basis for
  // the decision is the command it wants to run.
  getState: (objectiveId: string) =>
    request<ObjectiveState>(`/foreman/objectives/${objectiveId}/state`, {
      headers: toolsHeaders(),
    }),

  // Carries the whole toolkit, so it wants the header for the same reason
  // `getTools` does.
  getHarness: (id: string) => request<Harness>(`/foreman/harnesses/${id}`, { headers: toolsHeaders() }),

  getPulses: (id: string, limit = 12) =>
    request<Pulse[]>(`/foreman/harnesses/${id}/pulses?limit=${String(limit)}`),

  getTranscript: (id: string) =>
    request<TranscriptEntry[]>(`/foreman/harnesses/${id}/transcript`),

  getTools: (id: string) =>
    request<Tool[]>(`/foreman/harnesses/${id}/tools`, { headers: toolsHeaders() }),

  runTool: (harnessId: string, toolId: string) =>
    request<Tool>(`/foreman/harnesses/${harnessId}/tools/${toolId}/run`, {
      method: 'POST',
      headers: toolsHeaders(),
    }),

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
      { headers: toolsHeaders() },
    ),

  resolveIntervention: (
    id: string,
    body: { action: ResolveAction; response?: string; value?: number },
  ) =>
    request<Intervention>(`/foreman/interventions/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
      // Sent unconditionally: the client does not know the intervention's kind
      // here, and the server ignores the header for every kind but `approval`.
      headers: toolsHeaders(),
    }),

  // The objective scopes `usedByCount`, which the editor renders as "used by N
  // live harnesses" and repeats in the save banner. Without it the number
  // counted harnesses on objectives this view cannot even show.
  listPlaybooks: (objectiveId?: string) =>
    request<Playbook[]>(
      objectiveId ? `/foreman/playbooks?objectiveId=${objectiveId}` : '/foreman/playbooks',
    ),

  getPlaybook: (id: string, objectiveId?: string) =>
    request<Playbook>(
      objectiveId
        ? `/foreman/playbooks/${id}?objectiveId=${objectiveId}`
        : `/foreman/playbooks/${id}`,
    ),

  createPlaybook: (body: {
    projectId?: string | null;
    name: string;
    steps?: { index: number; text: string; condition: string | null }[];
    variables?: string[];
    cadence?: string;
    retireWhen?: string | null;
  }) => request<Playbook>('/foreman/playbooks', { method: 'POST', body: JSON.stringify(body) }),

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

  /**
   * The one place the secret rides the query string: `EventSource` cannot set a
   * header, and the stream's snapshot carries the same tool approvals the
   * fetched state does. Without it the stream still opens, with the commands
   * redacted — which would otherwise overwrite the readable ones the fetch just
   * put on screen.
   */
  streamUrl: (objectiveId: string) =>
    sseUrl(
      `/foreman/stream?objectiveId=${objectiveId}`
      + (TOOLS_SECRET.length > 0 ? `&toolsSecret=${encodeURIComponent(TOOLS_SECRET)}` : ''),
    ),
};
