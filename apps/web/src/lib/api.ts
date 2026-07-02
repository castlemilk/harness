import type { Project } from '../components/ProjectSidebar.js';
import type { Provider } from '../components/ProviderSettings.js';
import type { Task } from '../components/TaskBoard.js';

const API = String(import.meta.env.VITE_API_URL ?? 'http://localhost:4000');

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

export const api = {
  getProjects: () => request<Project[]>('/projects'),
  createProject: (body: { name: string; path: string; repoUrl?: string; description?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),

  getTasks: (projectId?: string) =>
    request<Task[]>(`/tasks${projectId ? `?projectId=${projectId}` : ''}`),
  createTask: (body: {
    projectId: string;
    title: string;
    description?: string;
    complexity?: string;
    tags?: string[];
  }) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  runTask: (id: string) => request<Task>(`/tasks/${id}/run`, { method: 'POST' }),
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
};
