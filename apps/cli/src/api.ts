import { program } from 'commander';

export function getApiUrl(): string {
  const opts = program.opts<{ api?: string }>();
  return opts.api ?? 'http://localhost:4000';
}

export async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${getApiUrl()}${path}`;
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as unknown;
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
  return data;
}

export async function retryTask(id: string, strategy?: string): Promise<Record<string, unknown>> {
  return apiFetch(`/tasks/${id}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(strategy ? { strategy } : {}),
  }) as Promise<Record<string, unknown>>;
}
