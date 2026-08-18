import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { foremanApi, type ObjectiveState } from './api.js';
import { projectObjectiveState } from './adapt.js';
import type { Harness, Intervention, Objective, Pulse } from '../types.js';

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
      const next = projectObjectiveState(await foremanApi.getState(id));
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
        // Same door as the fetched snapshot: a frame that fails the boundary
        // check throws here and drops us onto the polling path below.
        setState(projectObjectiveState(JSON.parse((ev as MessageEvent<string>).data)));
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

/**
 * The projections and the boundary check live in `./adapt.ts`, which is the
 * adapter seam this hook feeds. They are re-exported here because the shells
 * have always imported them from this module and moving the import sites adds
 * churn without adding meaning — new code should import from `./adapt.js`.
 */
export {
  buildTree,
  flattenTree,
  groupByWorkstream,
  liveHarnesses,
  projectObjectiveState,
  UNASSIGNED_GROUP,
  type FleetGroup,
  type HarnessNode,
} from './adapt.js';
