/**
 * The Foreman view model.
 *
 * These are the shapes the three shells and the supporting surfaces render, and
 * they are also what the server puts on the wire: `/foreman/objectives/:id/state`
 * serialises exactly this, so there is no per-field remapping to maintain and no
 * second dialect to drift from.
 *
 * The half of it that `ObjectiveState` is made of now lives in
 * `@omega-harness/usecase-kit` and is re-exported below. It had to: a use-case
 * view is handed `state: ObjectiveState`, and an out-of-tree shell cannot import
 * a type out of this app. The kit is therefore the single definition and this
 * file is a barrel over it — importing `Harness` from `../types.js` and from the
 * kit gets you the same type, not two that agree today.
 *
 * What is still defined here is what only the core chrome renders — transcripts,
 * usage, tools, playbooks, and the resolved `ForemanState` — because none of it
 * is on `ObjectiveState` and none of it is a shell's business.
 *
 * What that leaves at the seam is validation, not translation. `data/adapt.ts`
 * owns it: `projectObjectiveState` checks the invariants these types promise
 * (arrays are arrays, ids are strings, money is finite) at the one point state
 * enters — fetched snapshot and SSE frame alike — and the projections there
 * (`buildTree`, `groupByWorkstream`, …) turn these flat lists into what a view
 * renders, so a shell never rebuilds the hierarchy itself. The validators stayed
 * in the app deliberately: the kit ships the contract, the host enforces it.
 */

export type {
  ActivityEntry,
  Harness,
  HarnessStatus,
  Intervention,
  InterventionDiff,
  InterventionKind,
  Objective,
  ObjectivePhase,
  ObjectiveState,
  ObjectiveStats,
  Pulse,
  PulseOutcome,
  RoutineStep,
  Ticket,
  TicketState,
  Workstream,
} from '@omega-harness/usecase-kit';

// The kit types this file's own shapes are built from. Imported as well as
// re-exported above because a `export type { … } from` is not in scope locally.
import type {
  ActivityEntry,
  Harness,
  Intervention,
  Objective,
  RoutineStep,
  Ticket,
  Workstream,
} from '@omega-harness/usecase-kit';

export type TranscriptEntry =
  | { kind: 'pulse-divider'; id: string; seq: number; at: string; duration: string; cost: number }
  | { kind: 'plan'; id: string; text: string }
  | { kind: 'finding'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      tool: string;
      target: string;
      duration: string | null;
      status: 'ok' | 'fail';
      resultLabel: string | null;
      output: { ok: boolean; text: string }[] | null;
    }
  | { kind: 'human'; id: string; at: string; text: string }
  | { kind: 'live'; id: string; text: string };

export interface UsageSummary {
  spend: number;
  spendCap: number | null;
  tokens: number;
  /** Null when the server has no cache telemetry — do not render 0%. */
  cacheHitRate: number | null;
  costPerMergedTicket: number | null;
  costPerTicketDelta: number | null;
  wasted: number;
  harnessCount: number;
  days: UsageDay[];
  models: string[];
  topSpenders: TopSpender[];
}

export interface UsageDay {
  label: string;
  /** Spend per model, keyed by model name. */
  byModel: Record<string, number>;
  projected: boolean;
}

export interface TopSpender {
  harnessId: string;
  name: string;
  childCount: number;
  spend: number;
  /** 0..1 relative to the top spender. */
  share: number;
  outcome: string;
  outcomeTone: 'ok' | 'fail' | 'neutral';
}

export interface Tool {
  id: string;
  name: string;
  group: string;
  lastResult: { label: string; tone: 'ok' | 'fail' | 'warn' | 'idle' } | null;
  needsApproval: boolean;
  /** The shell command this tool runs, if any. Null means it records only. */
  command?: string | null;
  /** False when no command is configured: running it executes nothing. */
  executable?: boolean;
  /** The last attempt — recorded, blocked, or executed. */
  lastRun?: {
    id: string;
    status: string;
    exitCode: number | null;
    durationMs: number | null;
    cwd: string | null;
    permissionId: string | null;
    interventionId: string | null;
    output: string | null;
    createdAt: string;
  } | null;
}

export interface Playbook {
  id: string;
  name: string;
  version: number;
  usedByCount: number;
  variables: string[];
  steps: RoutineStep[];
  cadence: string;
  retireWhen: string;
  /** Change from the previous version, for the editor's diff panel. */
  diffFromPrevious: { kind: 'add' | 'del'; text: string }[];
}

/** Everything the shells need for one objective, resolved in one pass. */
export interface ForemanState {
  objective: Objective | null;
  objectives: Objective[];
  harnesses: Harness[];
  workstreams: Workstream[];
  interventions: Intervention[];
  tickets: Ticket[];
  usage: UsageSummary | null;
  activity: ActivityEntry[];
}
