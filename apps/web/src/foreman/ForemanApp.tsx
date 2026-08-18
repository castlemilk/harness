import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { foremanApi, type ResolveAction, type SpawnHarnessInput } from './data/api.js';
import { useForeman } from './data/useForeman.js';
import type {
  Harness,
  Intervention,
  Playbook,
  Tool,
  TranscriptEntry,
  UsageSummary,
} from './types.js';
import { AppChrome } from './ui/AppChrome.js';
import { SpawnHarness } from './surfaces/SpawnHarness.js';
import { Interventions } from './surfaces/Interventions.js';
import { Transcript } from './surfaces/Transcript.js';
import { Toolkit } from './surfaces/Toolkit.js';
import { CommandPalette, type PaletteVerb } from './surfaces/CommandPalette.js';
import { EmptyState } from './surfaces/EmptyState.js';
// Importing the roster is what registers the use-case shells.
import './usecases/index.js';
import {
  CORE_VIEWS,
  DEFAULT_VIEW,
  findCoreView,
  type CoreViewContext,
} from './usecases/core.js';
import {
  findUseCaseView,
  getUseCase,
  resolveViewId,
  viewTabs,
} from './usecases/registry.js';
import { SourceHealthDots } from './usecases/health.js';

/**
 * The Foreman application shell: it owns which surface is showing, which
 * harness holds focus, and every mutation. The shells and surfaces stay
 * presentational so all three can be swapped without touching data flow.
 */
export function ForemanApp({
  projectId,
  projectName,
  onOpenLegacy,
}: {
  projectId?: string;
  projectName: string | null;
  onOpenLegacy: () => void;
}) {
  const {
    objectives,
    objectiveId,
    setObjectiveId,
    state,
    loading,
    error,
    live,
    refresh,
    reloadObjectives,
  } = useForeman(projectId);

  const [view, setView] = useState<string>(DEFAULT_VIEW);
  const [focusId, setFocusId] = useState<string | null>(null);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [interventionsOpen, setInterventionsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [toolkitOpen, setToolkitOpen] = useState(false);
  const [spawnParent, setSpawnParent] = useState<{ parent: Harness | null } | null>(null);

  const [tools, setTools] = useState<Tool[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [playbookId, setPlaybookId] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageDays, setUsageDays] = useState(7);
  const [actionError, setActionError] = useState<string | null>(null);

  const harnesses = useMemo(() => state?.harnesses ?? [], [state]);
  const focus = harnesses.find((h) => h.id === focusId) ?? null;

  // Seed focus once per objective. Clearing focus afterwards (closing the graph
  // inspector) must stick, so this deliberately does not re-select.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!objectiveId || harnesses.length === 0) return;
    if (seeded.current === objectiveId) return;
    seeded.current = objectiveId;
    setFocusId(harnesses.find((h) => !h.parentId)?.id ?? harnesses[0].id);
  }, [harnesses, objectiveId]);

  // Drop focus only when the harness it points at is actually gone.
  useEffect(() => {
    if (focusId && !harnesses.some((h) => h.id === focusId)) setFocusId(null);
  }, [harnesses, focusId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Don't hijack ⌘K out of an open dialog's text field.
        if (document.querySelector('[role="dialog"]') && !paletteOpen) return;
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [paletteOpen]);

  useEffect(() => {
    void foremanApi
      .listPlaybooks()
      .then((list) => {
        setPlaybooks(list);
        setPlaybookId((current) => current ?? list.at(0)?.id ?? null);
      })
      .catch(() => { setPlaybooks([]); });
  }, []);

  useEffect(() => {
    void foremanApi
      .listModels()
      .then(setModels)
      .catch(() => { setModels([]); });
  }, []);

  // Tools belong to the focused harness, so they reload as focus moves.
  useEffect(() => {
    if (!focusId) {
      setTools([]);
      return;
    }
    let cancelled = false;
    void foremanApi
      .getTools(focusId)
      .then((list) => {
        if (!cancelled) setTools(list);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [focusId]);

  useEffect(() => {
    if (view !== 'usage' || !objectiveId) return;
    let cancelled = false;
    void foremanApi
      .getUsage(objectiveId, usageDays)
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [view, objectiveId, usageDays]);

  const loadTranscript = useCallback((harnessId: string) => {
    setTranscriptLoading(true);
    void foremanApi
      .getTranscript(harnessId)
      .then(setTranscript)
      .catch(() => { setTranscript([]); })
      .finally(() => { setTranscriptLoading(false); });
  }, []);

  /** Every mutation funnels through here so failures surface consistently. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const openTranscript = useCallback(
    (harnessId: string) => {
      setFocusId(harnessId);
      loadTranscript(harnessId);
      setTranscriptOpen(true);
    },
    [loadTranscript],
  );

  const handleResolve = useCallback(
    async (item: Intervention, action: ResolveAction, payload?: { response?: string; value?: number }) => {
      await mutate(() =>
        foremanApi.resolveIntervention(item.id, {
          action,
          response: payload?.response,
          value: payload?.value ?? item.budget?.suggestedCap,
        }),
      );
    },
    [mutate],
  );

  const handleSpawn = useCallback(
    async (input: SpawnHarnessInput) => {
      await foremanApi.spawnHarness(input);
      await refresh();
    },
    [refresh],
  );

  const handleVerb = useCallback(
    (verb: PaletteVerb, harness: Harness, subtree: boolean) => {
      switch (verb) {
        case 'pause':
          void mutate(() => foremanApi.pauseHarness(harness.id, subtree));
          break;
        case 'resume':
          void mutate(() => foremanApi.resumeHarness(harness.id, subtree));
          break;
        case 'retire':
          void mutate(() => foremanApi.retireHarness(harness.id));
          break;
        case 'spawn':
          setSpawnParent({ parent: harness });
          break;
        case 'open':
          setFocusId(harness.id);
          break;
      }
    },
    [mutate],
  );

  if (loading && !state) {
    return <Centered>Loading fleet…</Centered>;
  }

  if (!state || objectives.length === 0) {
    return (
      <EmptyState
        hasProject={Boolean(projectId)}
        projectName={projectName}
        onConnectRepo={onOpenLegacy}
        onCreate={async ({ name, description }) => {
          if (!projectId) throw new Error('Connect a project first.');
          const created = await foremanApi.createObjective({ projectId, name, description });
          await reloadObjectives();
          setObjectiveId(created.id);
        }}
      />
    );
  }

  const objective = state.objective;
  const shell = getUseCase(objective.useCase);
  const tabs = viewTabs(CORE_VIEWS, objective.useCase);
  // The active view outlives objective switches, so it can point at a tab the
  // current objective doesn't have. Resolve rather than render nothing.
  const activeView = resolveViewId(tabs, view);
  const coreView = findCoreView(activeView);
  const useCaseView = coreView ? null : findUseCaseView(objective.useCase, activeView);
  const CoreSurface = coreView?.component;
  const UseCaseSurface = useCaseView?.component;

  /** Everything a core view is allowed to reach. See `usecases/core.tsx`. */
  const coreContext: CoreViewContext = {
    state,
    harnesses,
    focusId,
    onFocus: setFocusId,
    onOpenView: setView,
    mutate,
    onResolve: (item, action) => void handleResolve(item, action),
    onOpenTranscript: openTranscript,
    onOpenToolkit: () => { setToolkitOpen(true); },
    onSpawnUnder: (parent) => { setSpawnParent({ parent }); },
    onError: setActionError,
    tools,
    usage,
    usageDays,
    onUsageDaysChange: setUsageDays,
    playbooks,
    playbookId,
    onSelectPlaybook: setPlaybookId,
    onSavePlaybook: async (id, body) => {
      const next = await foremanApi.savePlaybookVersion(id, body);
      setPlaybooks((prev) => prev.map((p) => (p.id === id ? next : p)));
      await refresh();
    },
  };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink"
      // The skin seam: one variable the chrome and any use-case view can tint
      // from. Without a shell it resolves to the stock accent, so nothing moves.
      // '#e8963c' is tailwind.config.js's `accent.DEFAULT`.
      style={{ '--uc-accent': shell?.accent ?? '#e8963c' } as React.CSSProperties}
      data-usecase={shell?.id ?? undefined}
    >
      <AppChrome
        view={activeView}
        tabs={tabs}
        onViewChange={setView}
        objective={objective}
        objectives={objectives}
        onObjectiveChange={setObjectiveId}
        pendingInterventions={state.interventions.length}
        onOpenPalette={() => { setPaletteOpen(true); }}
        onOpenInterventions={() => { setInterventionsOpen(true); }}
        onOpenLegacy={onOpenLegacy}
        right={
          <>
            {/* Domain backends first, then Foreman's own stream: both answer
                "is what I'm looking at actually live?". */}
            <SourceHealthDots shell={shell} />
            {!live && (
              <span
                title="The live stream is unavailable; polling instead."
                className="font-mono text-[10px] text-warn"
              >
                ◌ polling
              </span>
            )}
          </>
        }
      />

      {(error ?? actionError) && (
        <div className="flex-none border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-[11px] text-danger-tint">
          {actionError ?? error}
        </div>
      )}

      {CoreSurface ? (
        <CoreSurface {...coreContext} />
      ) : UseCaseSurface ? (
        <UseCaseSurface
          objectiveId={objective.id}
          state={state}
          focusId={focusId}
          onFocus={setFocusId}
          onOpenView={setView}
          mutate={mutate}
        />
      ) : null}

      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false); }}
        harnesses={harnesses}
        tickets={state.tickets}
        onOpenHarness={(id) => {
          setFocusId(id);
          setView('console');
        }}
        onOpenTicket={() => { setView('work'); }}
        onRunVerb={handleVerb}
      />

      <Interventions
        open={interventionsOpen}
        onClose={() => { setInterventionsOpen(false); }}
        interventions={state.interventions}
        onResolve={handleResolve}
        onOpenSession={(harnessId) => {
          setInterventionsOpen(false);
          openTranscript(harnessId);
        }}
      />

      <Transcript
        open={transcriptOpen}
        onClose={() => { setTranscriptOpen(false); }}
        harness={focus}
        parentName={harnesses.find((h) => h.id === focus?.parentId)?.name ?? null}
        entries={transcript}
        loading={transcriptLoading}
        onInterject={async (text) => {
          if (!focus) return;
          await foremanApi.interject(focus.id, text);
          loadTranscript(focus.id);
        }}
        onInterrupt={() => {
          if (focus) void mutate(() => foremanApi.pauseHarness(focus.id, false));
        }}
      />

      <Toolkit
        open={toolkitOpen}
        onClose={() => { setToolkitOpen(false); }}
        harnessName={focus?.name ?? ''}
        tools={tools}
        onRun={async (tool) => {
          if (!focus) return;
          const updated = await foremanApi.runTool(focus.id, tool.id);
          setTools((prev) => prev.map((t) => (t.id === tool.id ? updated : t)));
        }}
      />

      <SpawnHarness
        open={spawnParent !== null}
        onClose={() => { setSpawnParent(null); }}
        objectiveId={objective.id}
        objectiveName={objective.name}
        parent={spawnParent?.parent ?? null}
        playbooks={playbooks}
        models={models}
        onSpawn={handleSpawn}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas text-[12px] text-muted">
      {children}
    </div>
  );
}
