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
