const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  getProjects: () => request('/projects'),
  createProject: (body: { name: string; path: string; repoUrl?: string; description?: string }) =>
    request('/projects', { method: 'POST', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),

  getTasks: (projectId?: string) =>
    request(`/tasks${projectId ? `?projectId=${projectId}` : ''}`),
  createTask: (body: {
    projectId: string;
    title: string;
    description?: string;
    complexity?: string;
    tags?: string[];
  }) => request('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  runTask: (id: string) => request(`/tasks/${id}/run`, { method: 'POST' }),
  updateTask: (id: string, body: any) => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getProviders: () => request('/providers'),
  createProvider: (body: any) => request('/providers', { method: 'POST', body: JSON.stringify(body) }),
  toggleProvider: (id: string) => request(`/providers/${id}/toggle`, { method: 'PATCH' }),
  deleteProvider: (id: string) => request(`/providers/${id}`, { method: 'DELETE' }),

  selectProvider: (body: { title: string; complexity: string; tags: string[] }) =>
    request('/router/select', { method: 'POST', body: JSON.stringify(body) }),
};
