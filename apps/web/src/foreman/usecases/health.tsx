import { useEffect, useMemo, useState } from 'react';
import { statusColor } from '../ui/primitives.js';
import {
  createDataSource,
  type UseCaseDataSource,
  type UseCaseDataSourceConfig,
  type UseCaseShell,
} from '@omega-harness/usecase-kit';

/**
 * Backend health for the active use-case shell.
 *
 * A domain tab that renders nothing has two very different causes: the shell
 * has nothing to show, or the backend it reads is unreachable. Without a signal
 * in the chrome those look identical, and the operator's next move is devtools.
 * So while a shell with declared sources is active, Foreman probes each one and
 * shows a dot next to the stream indicator.
 *
 * The scheduling is a plain function rather than a hook so it can be tested
 * with fake timers and no renderer; `useSourceHealth` is a thin wrapper. The
 * gating matters as much as the probing: no active shell, or a shell with no
 * declared sources, means no timer and no requests at all — Foreman must not
 * generate background traffic for objectives that never asked for it.
 */

export interface SourceHealth {
  status: 'probing' | 'ok' | 'down';
  latencyMs?: number;
  error?: string;
}

export const PROBE_INTERVAL_MS = 30_000;

export type HealthMap = Record<string, SourceHealth>;

/**
 * Probe every source now and on an interval. Returns a stop function; calling
 * it clears the timer and suppresses any in-flight probe's update, so a shell
 * switch can't write health for the shell you just left.
 */
export function startHealthProbes(
  sources: readonly UseCaseDataSource[],
  onUpdate: (health: HealthMap) => void,
  opts: { intervalMs?: number } = {},
): () => void {
  if (sources.length === 0) return () => undefined;

  let stopped = false;
  let health: HealthMap = Object.fromEntries(
    sources.map((s) => [s.config.id, { status: 'probing' as const }]),
  );
  onUpdate(health);

  const round = async () => {
    const results = await Promise.all(
      sources.map(async (s) => [s.config.id, await s.probe()] as const),
    );
    if (stopped) return;
    health = { ...health };
    for (const [id, result] of results) {
      health[id] = result.ok
        ? { status: 'ok', latencyMs: result.latencyMs }
        : { status: 'down', latencyMs: result.latencyMs, error: result.error };
    }
    onUpdate(health);
  };

  void round();
  const timer = setInterval(() => { void round(); }, opts.intervalMs ?? PROBE_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** What the operator reads on hover: which backend, where, and how it is. */
export function healthTooltip(config: UseCaseDataSourceConfig, health: SourceHealth): string {
  const where = `${config.label} · ${config.baseUrl}`;
  switch (health.status) {
    case 'probing':
      return `${where} — checking…`;
    case 'ok':
      return `${where} — reachable${health.latencyMs == null ? '' : ` in ${String(health.latencyMs)}ms`}`;
    case 'down':
      return `${where} — unreachable${health.error == null ? '' : `: ${health.error}`}`;
  }
}

/** The sources a shell declares, or none. `null` shell means no probing. */
export function shellSources(shell: UseCaseShell | null): UseCaseDataSourceConfig[] {
  return shell?.dataSources ?? [];
}

export function useSourceHealth(shell: UseCaseShell | null): {
  source: UseCaseDataSource;
  health: SourceHealth;
}[] {
  // `getUseCase` hands back the registered object itself, so the shell is
  // referentially stable across renders — rebuilding the clients would restart
  // probing on every render.
  const sources = useMemo(() => shellSources(shell).map(createDataSource), [shell]);
  const [health, setHealth] = useState<HealthMap>({});

  useEffect(() => startHealthProbes(sources, setHealth), [sources]);

  return sources.map((source) => ({
    source,
    health: health[source.config.id] ?? { status: 'probing' },
  }));
}

// Health states borrow the fleet's status palette so a red dot means the same
// thing in the chrome as it does on a harness. The aria-label is written out
// rather than reusing `StatusDot` because "working" is the wrong word for a
// backend, and the tooltip is what an operator actually reads.
const HEALTH_COLOR: Record<SourceHealth['status'], string> = {
  probing: statusColor('ready'),
  ok: statusColor('working'),
  down: statusColor('failed'),
};

/**
 * The colour for a health state. Exported so the Plugins surface's per-source
 * rows draw the same dot as the chrome does — two palettes for one meaning is
 * how a red dot stops meaning anything.
 */
export function healthColor(status: SourceHealth['status']): string {
  return HEALTH_COLOR[status];
}

/**
 * The health dots, for the chrome's right-hand slot. Renders nothing when the
 * active objective's shell declares no sources — which is every objective today
 * except a use case that opted in.
 */
export function SourceHealthDots({ shell }: { shell: UseCaseShell | null }) {
  const entries = useSourceHealth(shell);
  if (entries.length === 0) return null;

  return (
    <span className="flex items-center gap-1.5">
      {entries.map(({ source, health }) => (
        <span
          key={source.config.id}
          title={healthTooltip(source.config, health)}
          role="img"
          aria-label={`${source.config.label}: ${health.status}`}
          className={`h-[6px] w-[6px] flex-none rounded-full ${
            health.status === 'probing' ? 'animate-bp' : ''
          }`}
          style={{ background: HEALTH_COLOR[health.status] }}
        />
      ))}
    </span>
  );
}
