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
import { AppChrome, type ForemanView } from './ui/AppChrome.js';
import { ConsoleShell, type ConsoleAction } from './shells/ConsoleShell.js';
import { BoardShell } from './shells/BoardShell.js';
import { GraphShell } from './shells/GraphShell.js';
import { SpawnHarness } from './surfaces/SpawnHarness.js';
import { Interventions } from './surfaces/Interventions.js';
import { Transcript } from './surfaces/Transcript.js';
import { WorkBoard } from './surfaces/WorkBoard.js';
import { Usage } from './surfaces/Usage.js';
import { Toolkit } from './surfaces/Toolkit.js';
import { PlaybookEditor } from './surfaces/PlaybookEditor.js';
import { CommandPalette, type PaletteVerb } from './surfaces/CommandPalette.js';
import { EmptyState } from './surfaces/EmptyState.js';

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

  const [view, setView] = useState<ForemanView>('console');
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

  const handleConsoleAction = useCallback(
    (action: ConsoleAction, harness: Harness) => {
      switch (action) {
        case 'reply':
        case 'transcript':
          openTranscript(harness.id);
          break;
        case 'pause':
          void mutate(() => foremanApi.pauseHarness(harness.id, true));
          break;
        case 'resume':
          void mutate(() => foremanApi.resumeHarness(harness.id, true));
          break;
        case 'rendezvous':
          setFocusId(harness.id);
          setView('graph');
          break;
        case 'run-tool':
          setToolkitOpen(true);
          break;
      }
    },
    [mutate, openTranscript],
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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink">
      <AppChrome
        view={view}
        onViewChange={setView}
        objective={objective}
        objectives={objectives}
        onObjectiveChange={setObjectiveId}
        pendingInterventions={state.interventions.length}
        onOpenPalette={() => { setPaletteOpen(true); }}
        onOpenInterventions={() => { setInterventionsOpen(true); }}
        onOpenLegacy={onOpenLegacy}
        right={
          !live && (
            <span
              title="The live stream is unavailable; polling instead."
              className="font-mono text-[10px] text-warn"
            >
              ◌ polling
            </span>
          )
        }
      />

      {(error ?? actionError) && (
        <div className="flex-none border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-[11px] text-danger-tint">
          {actionError ?? error}
        </div>
      )}

      {view === 'console' && (
        <ConsoleShell
          state={state}
          focusId={focusId}
          onFocus={setFocusId}
          tools={tools}
          onAction={handleConsoleAction}
          onSpawn={(parentId) => {
            setSpawnParent({ parent: harnesses.find((h) => h.id === parentId) ?? null });
          }}
        />
      )}

      {view === 'board' && (
        <BoardShell
          state={state}
          onFocus={(id) => {
            setFocusId(id);
            setView('console');
          }}
          onResolve={(item, action) => void handleResolve(item, action)}
          onResolveCard={(harness, action) => {
            if (action === 'reply' || action === 'logs') {
              openTranscript(harness.id);
            } else if (action === 'raise-cap') {
              // The budget intervention is the record of the cap being hit, so
              // resolving it is what actually raises the cap.
              const item = state.interventions.find(
                (i) => i.harnessId === harness.id && i.kind === 'budget',
              );
              if (item) void handleResolve(item, 'raise-cap');
              else setActionError(`No budget request is open for ${harness.name}.`);
            } else {
              setSpawnParent({ parent: harnesses.find((h) => h.id === harness.parentId) ?? null });
            }
          }}
          onOpenLane={(workstreamId) => {
            const lead = harnesses.find(
              (h) => h.workstreamId === workstreamId && !h.parentId,
            );
            if (lead) setFocusId(lead.id);
            setView('console');
          }}
          onToggleWorkstream={(ws) => {
            void mutate(() =>
              ws.paused
                ? foremanApi.resumeWorkstream(ws.id)
                : foremanApi.pauseWorkstream(ws.id),
            );
          }}
        />
      )}

      {view === 'graph' && (
        <GraphShell
          state={state}
          focusId={focusId}
          onFocus={(id) => { setFocusId(id || null); }}
          onAction={(action, harness) => {
            if (action === 'reply') openTranscript(harness.id);
            else if (action === 'pause-subtree')
              void mutate(() => foremanApi.pauseHarness(harness.id, true));
            else setSpawnParent({ parent: harness });
          }}
        />
      )}

      {view === 'work' && (
        <WorkBoard
          tickets={state.tickets}
          objectiveName={objective.name}
          onOpenHarness={(id) => {
            setFocusId(id);
            setView('console');
          }}
        />
      )}

      {view === 'usage' && (
        <Usage
          usage={usage}
          objectiveName={objective.name}
          days={usageDays}
          onDaysChange={setUsageDays}
          onOpenHarness={(id) => {
            setFocusId(id);
            setView('console');
          }}
        />
      )}

      {view === 'playbooks' && (
        <PlaybookEditor
          playbooks={playbooks}
          selectedId={playbookId}
          onSelect={setPlaybookId}
          harnesses={harnesses}
          onSave={async (id, body) => {
            const next = await foremanApi.savePlaybookVersion(id, body);
            setPlaybooks((prev) => prev.map((p) => (p.id === id ? next : p)));
            await refresh();
          }}
        />
      )}

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
