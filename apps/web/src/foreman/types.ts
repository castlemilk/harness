/**
 * The Foreman view model.
 *
 * These are the shapes the three shells and the supporting surfaces render, and
 * they are also what the server puts on the wire: `/foreman/objectives/:id/state`
 * serialises exactly this, so there is no per-field remapping to maintain and no
 * second dialect to drift from.
 *
 * What that leaves at the seam is validation, not translation. `data/adapt.ts`
 * owns it: `projectObjectiveState` checks the invariants these types promise
 * (arrays are arrays, ids are strings, money is finite) at the one point state
 * enters — fetched snapshot and SSE frame alike — and the projections there
 * (`buildTree`, `groupByWorkstream`, …) turn these flat lists into what a view
 * renders, so a shell never rebuilds the hierarchy itself.
 */

export type HarnessStatus =
  | 'working' // actively burning a pulse
  | 'watching' // a lead between pulses, supervising children
  | 'waiting' // blocked on a human
  | 'failed'
  | 'paused'
  | 'ready' // staffed but not started
  | 'retired';

export type PulseOutcome = 'ok' | 'warn' | 'fail' | 'idle';

export interface Objective {
  id: string;
  name: string;
  /**
   * The use-case shell this objective renders in — a registry id, not a label.
   * Absent or unregistered means the core Foreman chrome only.
   */
  useCase?: string | null;
  /** 0..1 across all tickets in the objective. */
  progress: number;
  ticketsTotal: number;
  ticketsDone: number;
  /** Null when the objective has no deadline. */
  daysLeft: number | null;
  spendToday: number;
  spendTotal: number;
  spendCap: number | null;
  phases: ObjectivePhase[];
  stats: ObjectiveStats;
}

export interface ObjectivePhase {
  name: string;
  state: 'done' | 'active' | 'pending';
  /** Drives the phase spine's relative widths. */
  weight: number;
  detail: string;
}

export interface ObjectiveStats {
  running: number;
  runningDelta: string | null;
  blocked: number;
  blockedNeedingYou: number;
  mergedToday: number;
  awaitingReview: number;
}

export interface Pulse {
  id: string;
  /** Monotonic pulse number shown as "#204". */
  seq: number;
  startedAt: string;
  durationMs: number | null;
  cost: number;
  outcome: PulseOutcome;
  /** Null when the pulse recorded no summary. */
  summary: string | null;
  /** Relative bar height in the sparkline, 0..1. */
  weight: number;
}

export interface Harness {
  id: string;
  name: string;
  parentId: string | null;
  objectiveId: string;
  workstreamId: string | null;
  status: HarnessStatus;
  /** One-line "what it's doing right now", shown on board cards. */
  activity: string;
  /** The standing brief — how it reasons. */
  mission: string;
  /** The job it is currently driving. */
  currentJob: string;
  model: string;
  /** 0..1 of the context window consumed. */
  contextUsed: number;
  spend: number;
  spendCap: number | null;
  /** Spend of this harness plus everything beneath it. */
  subtreeSpend: number;
  /** Heartbeat period in minutes. */
  heartbeatMinutes: number;
  /** Minutes until the next pulse; null when paused or not scheduled. */
  nextPulseInMinutes: number | null;
  childCount: number;
  maxChildren: number;
  /** How long it has been idle, in minutes. */
  idleMinutes: number | null;
  latestPulseSeq: number | null;
  /** Most recent first. */
  recentPulses: Pulse[];
  /** The every-pulse routine this harness runs. */
  routine: RoutineStep[];
  playbookId: string | null;
  branch: string | null;
  ticketId: string | null;
}

export interface RoutineStep {
  id: string;
  index: number;
  text: string;
  /** Set when the step is conditional, e.g. "escalates to parent". */
  condition: string | null;
}

export interface Workstream {
  id: string;
  name: string;
  leadHarnessId: string | null;
  status: HarnessStatus;
  agentCount: number;
  spend: number;
  paused: boolean;
  pausedNote: string | null;
}

export type InterventionKind = 'approval' | 'question' | 'budget';

export interface Intervention {
  id: string;
  kind: InterventionKind;
  harnessId: string;
  harnessName: string;
  title: string;
  detail: string | null;
  createdAt: string;
  /** e.g. "blocks 2 children" / "idle since". */
  impact: string | null;
  /** Present on approval items: the change under review. */
  diff: InterventionDiff | null;
  /** Present on budget items. */
  budget: { spent: number; cap: number; suggestedCap: number } | null;
}

export interface InterventionDiff {
  added: number;
  removed: number;
  filesChanged: number;
  summary: string;
  lines: { kind: 'add' | 'del' | 'meta'; text: string }[];
}

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

export type TicketState = 'backlog' | 'triaged' | 'in-progress' | 'in-review' | 'done';

export interface Ticket {
  id: string;
  ref: string;
  title: string;
  state: TicketState;
  ownerHarnessId: string | null;
  ownerHarnessName: string | null;
  ownerStatus: HarnessStatus | null;
  branch: string | null;
  prNumber: number | null;
  childCount: number;
  labels: { text: string; tone: 'growth' | 'medium' | 'high' | 'integrations' }[];
  assignmentNote: string | null;
}

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

export interface ActivityEntry {
  id: string;
  verb: 'merged' | 'spawned' | 'paused' | 'failed' | 'retired';
  text: string;
  at: string;
}
