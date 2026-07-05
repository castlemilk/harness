import type { AgentRunInfo, DiffInfo, TraceFlowInfo } from './types.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${url} -> ${String(res.status)}`);
  }
  return res.json() as Promise<T>;
}

export async function ensureProject(
  apiUrl: string,
  name: string,
  path: string
): Promise<{ id: string }> {
  const res = await fetch(`${apiUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path }),
  });
  if (res.status === 409) {
    // Project path already exists; fetch by path.
    const projects = (await fetch(`${apiUrl}/projects?path=${encodeURIComponent(path)}`).then((r) =>
      r.json()
    )) as { id: string; path: string }[];
    const existing = projects.find((p) => p.path === path);
    if (existing) return existing;
  }
  if (!res.ok) throw new ApiError(res.status, `create project failed: ${String(res.status)}`);
  return res.json() as Promise<{ id: string }>;
}

export async function createTask(
  apiUrl: string,
  projectId: string,
  title: string,
  options: { description?: string; complexity?: string; tags?: string[] } = {}
): Promise<{ id: string; status: string }> {
  return apiFetch(`${apiUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      title,
      description: options.description,
      complexity: options.complexity ?? 'simple',
      tags: options.tags ?? ['benchmark'],
    }),
  });
}

export async function runTask(apiUrl: string, taskId: string): Promise<void> {
  await apiFetch(`${apiUrl}/tasks/${taskId}/run`, { method: 'POST' });
}

export async function getTask(apiUrl: string, taskId: string): Promise<{ status: string; result?: string; error?: string }> {
  return apiFetch(`${apiUrl}/tasks/${taskId}`);
}

export async function waitForTask(
  apiUrl: string,
  taskId: string,
  timeoutMs = 120000
): Promise<{ status: string; result?: string; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getTask(apiUrl, taskId);
    if (task.status === 'done' || task.status === 'failed') return task;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { status: 'timeout', error: 'Task did not finish in time' };
}

export async function getAgentRun(apiUrl: string, taskId: string): Promise<AgentRunInfo | undefined> {
  try {
    return await apiFetch<AgentRunInfo>(`${apiUrl}/tasks/${taskId}/agent-run`);
  } catch {
    return undefined;
  }
}

export async function getDiffs(apiUrl: string, taskId: string): Promise<DiffInfo[]> {
  try {
    return await apiFetch<DiffInfo[]>(`${apiUrl}/tasks/${taskId}/diffs`);
  } catch {
    return [];
  }
}

export async function getTraceFlow(apiUrl: string, taskId: string): Promise<TraceFlowInfo | undefined> {
  try {
    return await apiFetch<TraceFlowInfo>(`${apiUrl}/tasks/${taskId}/trace-flow`);
  } catch {
    return undefined;
  }
}

export async function getPromptVersion(
  apiUrl: string,
  id: string
): Promise<{ id: string; hash: string; name: string } | undefined> {
  try {
    return await apiFetch<{ id: string; hash: string; name: string }>(`${apiUrl}/prompt-versions/${id}`);
  } catch {
    return undefined;
  }
}

export function countSpans(node: { children?: unknown[] }): number {
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countSpans(child as { children?: unknown[] });
    }
  }
  return count;
}
