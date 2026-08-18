import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  healthTooltip,
  PROBE_INTERVAL_MS,
  shellSources,
  startHealthProbes,
  type HealthMap,
} from './health.js';
import type { ProbeResult, UseCaseDataSource, UseCaseDataSourceConfig } from './data-source.js';

/**
 * The probe scheduler, which is the part with teeth: it decides whether Foreman
 * makes background requests at all. No active shell must mean no traffic.
 */

const config: UseCaseDataSourceConfig = {
  id: 'omega-api',
  label: 'Omega API',
  baseUrl: 'http://localhost:8080',
};

function fakeSource(
  id: string,
  results: ProbeResult[],
): UseCaseDataSource & { probes: number } {
  let n = 0;
  const source = {
    probes: 0,
    config: { ...config, id },
    getJson: () => Promise.reject(new Error('unused')),
    postConnect: () => Promise.reject(new Error('unused')),
    sse: () => () => undefined,
    probe: () => {
      source.probes++;
      return Promise.resolve(results[Math.min(n++, results.length - 1)]);
    },
  } as UseCaseDataSource & { probes: number };
  return source;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('shellSources', () => {
  it('is empty with no active shell, and for a shell that declares none', () => {
    expect(shellSources(null)).toEqual([]);
    expect(shellSources({ id: 'plain', name: 'Plain', views: [] })).toEqual([]);
    expect(
      shellSources({ id: 'victoria', name: 'V', views: [], dataSources: [config] }),
    ).toEqual([config]);
  });
});

describe('startHealthProbes', () => {
  it('does nothing at all when there are no sources', () => {
    vi.useFakeTimers();
    const updates: HealthMap[] = [];
    const stop = startHealthProbes([], (h) => updates.push(h));
    vi.advanceTimersByTime(PROBE_INTERVAL_MS * 4);
    expect(updates).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it('reports probing first, then the result of the immediate round', async () => {
    const source = fakeSource('omega-api', [{ ok: true, latencyMs: 12 }]);
    const updates: HealthMap[] = [];
    const stop = startHealthProbes([source], (h) => updates.push(h));

    expect(updates[0]).toEqual({ 'omega-api': { status: 'probing' } });
    await vi.waitFor(() => { expect(updates).toHaveLength(2); });
    expect(updates[1]).toEqual({ 'omega-api': { status: 'ok', latencyMs: 12 } });
    expect(source.probes).toBe(1);
    stop();
  });

  it('re-probes on the interval and flips a source to down', async () => {
    vi.useFakeTimers();
    const source = fakeSource('omega-api', [
      { ok: true, latencyMs: 8 },
      { ok: false, error: 'Failed to fetch' },
    ]);
    let health: HealthMap = {};
    const stop = startHealthProbes([source], (h) => { health = h; }, { intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(health).toEqual({ 'omega-api': { status: 'ok', latencyMs: 8 } });

    await vi.advanceTimersByTimeAsync(1000);
    expect(source.probes).toBe(2);
    expect(health).toEqual({
      'omega-api': { status: 'down', latencyMs: undefined, error: 'Failed to fetch' },
    });

    // Stopping must end the traffic, not just the updates.
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(source.probes).toBe(2);
  });

  it('tracks every declared source independently', async () => {
    const up = fakeSource('up', [{ ok: true, latencyMs: 3 }]);
    const down = fakeSource('down', [{ ok: false, error: 'HTTP 502' }]);
    let health: HealthMap = {};
    const stop = startHealthProbes([up, down], (h) => { health = h; });

    await vi.waitFor(() => { expect(health.up.status).toBe('ok'); });
    expect(health.down).toEqual({ status: 'down', latencyMs: undefined, error: 'HTTP 502' });
    stop();
  });

  it('defaults to a 30s cadence', () => {
    expect(PROBE_INTERVAL_MS).toBe(30_000);
  });
});

describe('healthTooltip', () => {
  it('names the backend, where it lives, and how it is', () => {
    expect(healthTooltip(config, { status: 'probing' })).toBe(
      'Omega API · http://localhost:8080 — checking…',
    );
    expect(healthTooltip(config, { status: 'ok', latencyMs: 42 })).toBe(
      'Omega API · http://localhost:8080 — reachable in 42ms',
    );
    expect(healthTooltip(config, { status: 'down', error: 'HTTP 502' })).toBe(
      'Omega API · http://localhost:8080 — unreachable: HTTP 502',
    );
  });
});
