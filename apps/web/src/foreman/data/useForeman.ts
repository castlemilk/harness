import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { foremanApi, type ObjectiveState } from './api.js';
import type { Harness, Intervention, Objective, Pulse, Workstream } from '../types.js';

/**
 * Live objective state.
 *
 * The SSE stream is the primary transport: an `init` snapshot followed by
 * per-entity patches. If the stream can't be established we fall back to
 * polling, so the shells never sit on stale data without saying so.
 */
export interface ForemanConnection {
  objectives: Objective[];
  objectiveId: string | null;
  setObjectiveId: (id: string) => void;
  state: ObjectiveState | null;
  loading: boolean;
  error: string | null;
  /** True while the SSE stream is attached; false means we're polling. */
  live: boolean;
  refresh: () => Promise<void>;
  /** Refetch the objective list — needed after creating the first one. */
  reloadObjectives: () => Promise<void>;
}

const POLL_MS = 5000;

export function useForeman(projectId?: string): ForemanConnection {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [objectiveId, setObjectiveId] = useState<string | null>(null);
  const [state, setState] = useState<ObjectiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Guards a race: a slow fetch for objective A must not overwrite state for B.
  const activeObjective = useRef<string | null>(null);
  activeObjective.current = objectiveId;

  const loadObjectives = useCallback(async () => {
    try {
      const list = await foremanApi.listObjectives(projectId);
      setObjectives(list);
      setError(null);
      // Landing on an objective with no fleet reads as a broken dashboard.
      // Prefer one that has something running before falling back to the first.
      const populated =
        list.find((o) => o.stats.running + o.stats.blocked > 0) ??
        list.find((o) => o.ticketsTotal > 0) ??
        list.at(0);
      setObjectiveId((current) => current ?? populated?.id ?? null);
      if (list.length === 0) setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [projectId]);

  const refresh = useCallback(async () => {
    const id = activeObjective.current;
    if (!id) return;
    try {
      const next = await foremanApi.getState(id);
      if (activeObjective.current !== id) return;
      setState(next);
      setError(null);
    } catch (err) {
      if (activeObjective.current !== id) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeObjective.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadObjectives();
  }, [loadObjectives]);

  // Switching objectives clears the previous one's data rather than showing it
  // under the new heading.
  useEffect(() => {
    if (!objectiveId) return;
    setState(null);
    setLoading(true);
    void refresh();
  }, [objectiveId, refresh]);

  // Live patches.
  useEffect(() => {
    if (!objectiveId) return;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => {
        void refresh();
      }, POLL_MS);
    };

    const source = new EventSource(foremanApi.streamUrl(objectiveId));

    const stopPolling = () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    source.onopen = () => {
      if (cancelled) return;
      setLive(true);
      stopPolling();
    };

    source.addEventListener('init', (ev) => {
      if (cancelled) return;
      try {
        setState(JSON.parse((ev as MessageEvent<string>).data) as ObjectiveState);
        setLive(true);
        setError(null);
        stopPolling();
      } catch {
        // A bad snapshot means we can't trust the stream; fall back rather than
        // sitting on the loading state forever.
        startPolling();
        void refresh();
      } finally {
        setLoading(false);
      }
    });

    source.addEventListener('harness', (ev) => {
      if (cancelled) return;
      try {
        const patch = JSON.parse((ev as MessageEvent<string>).data) as Harness;
        setState((prev) =>
          prev
            ? {
                ...prev,
                harnesses: prev.harnesses.some((h) => h.id === patch.id)
                  ? prev.harnesses.map((h) => (h.id === patch.id ? { ...h, ...patch } : h))
                  : [...prev.harnesses, patch],
              }
            : prev,
        );
      } catch {
        /* a malformed frame shouldn't tear down the stream */
      }
    });

    source.addEventListener('pulse', (ev) => {
      if (cancelled) return;
      try {
        const { harnessId, pulse } = JSON.parse((ev as MessageEvent<string>).data) as {
          harnessId: string;
          pulse: Pulse;
        };
        setState((prev) =>
          prev
            ? {
                ...prev,
                harnesses: prev.harnesses.map((h) =>
                  h.id === harnessId
                    ? {
                        ...h,
                        latestPulseSeq: pulse.seq,
                        recentPulses: [pulse, ...h.recentPulses.filter((p) => p.id !== pulse.id)]
                          .slice(0, 12),
                      }
                    : h,
                ),
              }
            : prev,
        );
      } catch {
        /* ignore */
      }
    });

    source.addEventListener('intervention', (ev) => {
      if (cancelled) return;
      try {
        const item = JSON.parse((ev as MessageEvent<string>).data) as Intervention & {
          status?: string;
        };
        setState((prev) => {
          if (!prev) return prev;
          const resolved = item.status && item.status !== 'pending';
          const without = prev.interventions.filter((i) => i.id !== item.id);
          return {
            ...prev,
            interventions: resolved ? without : [...without, item],
          };
        });
      } catch {
        /* ignore */
      }
    });

    source.onerror = () => {
      // EventSource retries on its own; polling covers the window in between
      // and the case where the endpoint isn't reachable at all.
      setLive(false);
      startPolling();
    };

    return () => {
      cancelled = true;
      source.close();
      if (poll) clearInterval(poll);
    };
  }, [objectiveId, refresh]);

  return useMemo(
    () => ({
      objectives,
      objectiveId,
      setObjectiveId,
      state,
      loading,
      error,
      live,
      refresh,
      reloadObjectives: loadObjectives,
    }),
    [objectives, objectiveId, state, loading, error, live, refresh, loadObjectives],
  );
}

/** A harness plus its resolved children, for the tree and graph shells. */
export interface HarnessNode {
  harness: Harness;
  children: HarnessNode[];
  depth: number;
}

/**
 * Rebuild the hierarchy from the flat list. Harnesses whose parent isn't in the
 * payload are surfaced as roots rather than dropped, so a partial fetch never
 * silently hides part of the fleet. Cycles are broken by visit-tracking.
 */
export function buildTree(harnesses: Harness[]): HarnessNode[] {
  const byId = new Map(harnesses.map((h) => [h.id, h]));
  const childrenOf = new Map<string | null, Harness[]>();
  for (const h of harnesses) {
    const key = h.parentId && byId.has(h.parentId) ? h.parentId : null;
    const list = childrenOf.get(key);
    if (list) list.push(h);
    else childrenOf.set(key, [h]);
  }

  const seen = new Set<string>();
  const build = (harness: Harness, depth: number): HarnessNode => {
    seen.add(harness.id);
    const kids = (childrenOf.get(harness.id) ?? []).filter((c) => !seen.has(c.id));
    return { harness, depth, children: kids.map((c) => build(c, depth + 1)) };
  };

  const roots = (childrenOf.get(null) ?? []).map((h) => build(h, 0));

  // A parent/child cycle leaves every node with a present parent, so the null
  // bucket is empty and nothing would render. Promote the unreached to roots.
  for (const h of harnesses) {
    if (!seen.has(h.id)) roots.push(build(h, 0));
  }

  return roots;
}

/** Flatten a tree honouring which nodes are expanded, for virtualised rows. */
export function flattenTree(
  nodes: HarnessNode[],
  expanded: Set<string>,
): { node: HarnessNode; hasChildren: boolean }[] {
  const out: { node: HarnessNode; hasChildren: boolean }[] = [];
  const walk = (list: HarnessNode[]) => {
    for (const n of list) {
      out.push({ node: n, hasChildren: n.children.length > 0 });
      if (n.children.length > 0 && expanded.has(n.harness.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export interface FleetGroup {
  id: string;
  name: string;
  /** Null for the synthetic bucket holding harnesses with no workstream. */
  workstream: Workstream | null;
  harnesses: Harness[];
}

export const UNASSIGNED_GROUP = '__unassigned';

/**
 * Group the fleet for the tree, roster and lanes.
 *
 * Rendering by iterating workstreams alone drops any harness whose
 * `workstreamId` is null or dangling — which is exactly what a freshly spawned
 * top-level harness looks like. Those land in an "Unassigned" bucket instead of
 * vanishing while still being counted. Retired harnesses are excluded outright.
 */
export function groupByWorkstream(
  harnesses: Harness[],
  workstreams: Workstream[],
): FleetGroup[] {
  const live = harnesses.filter((h) => h.status !== 'retired');
  const known = new Set(workstreams.map((w) => w.id));

  const groups: FleetGroup[] = workstreams.map((ws) => ({
    id: ws.id,
    name: ws.name,
    workstream: ws,
    harnesses: live.filter((h) => h.workstreamId === ws.id),
  }));

  const orphans = live.filter((h) => h.workstreamId == null || !known.has(h.workstreamId));
  if (orphans.length > 0) {
    groups.push({
      id: UNASSIGNED_GROUP,
      name: 'Unassigned',
      workstream: null,
      harnesses: orphans,
    });
  }

  return groups;
}

/** The fleet as the shells count it: everything except retired harnesses. */
export function liveHarnesses(harnesses: Harness[]): Harness[] {
  return harnesses.filter((h) => h.status !== 'retired');
}
