import type { ComponentType } from 'react';
import { foremanApi, type ObjectiveState, type ResolveAction } from '../data/api.js';
import type {
  Harness,
  Intervention,
  Playbook,
  Tool,
  UsageSummary,
} from '../types.js';
import { ConsoleShell } from '../shells/ConsoleShell.js';
import { BoardShell } from '../shells/BoardShell.js';
import { GraphShell } from '../shells/GraphShell.js';
import { WorkBoard } from '../surfaces/WorkBoard.js';
import { Usage } from '../surfaces/Usage.js';
import { PlaybookEditor } from '../surfaces/PlaybookEditor.js';
import type { ViewDescriptor } from './registry.js';

/**
 * The core views.
 *
 * These are NOT a use case. Every objective gets them whether or not it has a
 * `useCase`, they are the presentation axis rather than the domain axis, and
 * they read Foreman internals (the focused harness's tool list, the playbook
 * draft, the usage window) that no third-party shell should be handed. Modelling
 * them as a reserved shell would have meant either widening `UseCaseViewProps`
 * to everything the app holds — destroying the plugin contract on day one — or
 * lying about a 'core' use case that no objective can ever be assigned. So they
 * are their own list with their own richer context, and `viewTabs()` composes
 * the two.
 *
 * This list is the single source of truth for the core tab bar AND for what
 * ForemanApp renders. It replaces the three parallel definitions that used to
 * drift: the `ForemanView` union, the `FOREMAN_TABS` array, and the
 * `{view === 'x' && <X/>}` chain.
 */

/**
 * What a core view is handed. Internal by design — this is Foreman's own guts,
 * and it will grow as the app does. The stable, narrow contract is
 * `UseCaseViewProps` in `./registry.ts`.
 */
export interface CoreViewContext {
  state: ObjectiveState;
  /** `state.harnesses`, memoised by ForemanApp so shells don't re-render. */
  harnesses: Harness[];
  focusId: string | null;
  onFocus: (harnessId: string | null) => void;
  onOpenView: (viewId: string) => void;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
  onResolve: (item: Intervention, action: ResolveAction) => void;
  onOpenTranscript: (harnessId: string) => void;
  onOpenToolkit: () => void;
  /** Open the spawn dialog beneath a parent; null spawns at the top level. */
  onSpawnUnder: (parent: Harness | null) => void;
  onError: (message: string) => void;
  tools: Tool[];
  usage: UsageSummary | null;
  usageDays: number;
  onUsageDaysChange: (days: number) => void;
  playbooks: Playbook[];
  playbookId: string | null;
  onSelectPlaybook: (id: string) => void;
  onSavePlaybook: (
    id: string,
    body: {
      steps: { index: number; text: string; condition: string | null }[];
      variables: string[];
      cadence: string;
      retireWhen: string;
    },
  ) => Promise<void>;
}

export interface CoreView extends ViewDescriptor {
  component: ComponentType<CoreViewContext>;
}

function ConsoleView(ctx: CoreViewContext) {
  return (
    <ConsoleShell
      state={ctx.state}
      focusId={ctx.focusId}
      onFocus={ctx.onFocus}
      tools={ctx.tools}
      onAction={(action, harness) => {
        switch (action) {
          case 'reply':
          case 'transcript':
            ctx.onOpenTranscript(harness.id);
            break;
          case 'pause':
            void ctx.mutate(() => foremanApi.pauseHarness(harness.id, true));
            break;
          case 'resume':
            void ctx.mutate(() => foremanApi.resumeHarness(harness.id, true));
            break;
          case 'rendezvous':
            ctx.onFocus(harness.id);
            ctx.onOpenView('graph');
            break;
          case 'run-tool':
            ctx.onOpenToolkit();
            break;
        }
      }}
      onSpawn={(parentId) => {
        ctx.onSpawnUnder(ctx.harnesses.find((h) => h.id === parentId) ?? null);
      }}
    />
  );
}

function BoardView(ctx: CoreViewContext) {
  return (
    <BoardShell
      state={ctx.state}
      onFocus={(id) => {
        ctx.onFocus(id);
        ctx.onOpenView('console');
      }}
      onResolve={ctx.onResolve}
      onResolveCard={(harness, action) => {
        if (action === 'reply' || action === 'logs') {
          ctx.onOpenTranscript(harness.id);
        } else if (action === 'raise-cap') {
          // The budget intervention is the record of the cap being hit, so
          // resolving it is what actually raises the cap.
          const item = ctx.state.interventions.find(
            (i) => i.harnessId === harness.id && i.kind === 'budget',
          );
          if (item) ctx.onResolve(item, 'raise-cap');
          else ctx.onError(`No budget request is open for ${harness.name}.`);
        } else {
          ctx.onSpawnUnder(ctx.harnesses.find((h) => h.id === harness.parentId) ?? null);
        }
      }}
      onOpenLane={(workstreamId) => {
        const lead = ctx.harnesses.find((h) => h.workstreamId === workstreamId && !h.parentId);
        if (lead) ctx.onFocus(lead.id);
        ctx.onOpenView('console');
      }}
      onToggleWorkstream={(ws) => {
        void ctx.mutate(() =>
          ws.paused ? foremanApi.resumeWorkstream(ws.id) : foremanApi.pauseWorkstream(ws.id),
        );
      }}
    />
  );
}

function GraphView(ctx: CoreViewContext) {
  return (
    <GraphShell
      state={ctx.state}
      focusId={ctx.focusId}
      onFocus={(id) => { ctx.onFocus(id || null); }}
      onAction={(action, harness) => {
        if (action === 'reply') ctx.onOpenTranscript(harness.id);
        else if (action === 'pause-subtree')
          void ctx.mutate(() => foremanApi.pauseHarness(harness.id, true));
        else ctx.onSpawnUnder(harness);
      }}
    />
  );
}

function WorkView(ctx: CoreViewContext) {
  return (
    <WorkBoard
      tickets={ctx.state.tickets}
      objectiveName={ctx.state.objective.name}
      onOpenHarness={(id) => {
        ctx.onFocus(id);
        ctx.onOpenView('console');
      }}
    />
  );
}

function UsageView(ctx: CoreViewContext) {
  return (
    <Usage
      usage={ctx.usage}
      objectiveName={ctx.state.objective.name}
      days={ctx.usageDays}
      onDaysChange={ctx.onUsageDaysChange}
      onOpenHarness={(id) => {
        ctx.onFocus(id);
        ctx.onOpenView('console');
      }}
    />
  );
}

function PlaybooksView(ctx: CoreViewContext) {
  return (
    <PlaybookEditor
      playbooks={ctx.playbooks}
      selectedId={ctx.playbookId}
      onSelect={ctx.onSelectPlaybook}
      harnesses={ctx.harnesses}
      onSave={ctx.onSavePlaybook}
    />
  );
}

export const CORE_VIEWS: CoreView[] = [
  { id: 'console', label: 'Console', order: 10, component: ConsoleView },
  { id: 'board', label: 'Board', order: 20, component: BoardView },
  { id: 'graph', label: 'Graph', order: 30, component: GraphView },
  { id: 'work', label: 'Work', order: 40, component: WorkView },
  { id: 'usage', label: 'Usage', order: 50, component: UsageView },
  { id: 'playbooks', label: 'Playbooks', order: 60, component: PlaybooksView },
];

/** The view Foreman opens on, and the fallback for an unknown view id. */
export const DEFAULT_VIEW = CORE_VIEWS[0].id;

export function findCoreView(viewId: string): CoreView | null {
  return CORE_VIEWS.find((v) => v.id === viewId) ?? null;
}
