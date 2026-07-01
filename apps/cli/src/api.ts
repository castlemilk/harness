import { program } from 'commander';

export function getApiUrl(): string {
  const opts = program.opts<{ api?: string }>();
  return opts.api || 'http://localhost:4000';
}

export async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${getApiUrl()}${path}`;
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any).error || `HTTP ${res.status}`);
  }
  return data;
}
