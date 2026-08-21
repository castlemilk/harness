/**
 * The objective state, as it appears on the wire.
 *
 * `GET /foreman/objectives/:id/state` serialises exactly these shapes, and the
 * same shapes arrive on the SSE stream, so there is no per-field remapping to
 * maintain and no second dialect to drift from.
 *
 * They live in the kit rather than in the app because `UseCaseViewProps.state`
 * is `ObjectiveState`: a plugin cannot be handed a type it has no way to name.
 * Everything here is therefore part of the plugin contract and subject to the
 * same never-widen discipline as the rest of it — a field added here is a field
 * every out-of-tree shell may start depending on.
 *
 * What is NOT here is anything the *core* chrome alone renders — transcripts,
 * usage summaries, tool lists, playbooks. Those stay in the app's own
 * `foreman/types.ts`; they are not on `ObjectiveState` and a shell has no
 * business reading them.
 *
 * Validation is not translation: the app's `data/adapt.ts` checks the
 * invariants these types promise (arrays are arrays, ids are strings, money is
 * finite) at the one point state enters. The kit deliberately ships types only
 * — a plugin trusts the state it is handed, because the host already checked
 * it.
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
  /** The objective blurb. Absent on older payloads. */
  description?: string | null;
  /** `active` | `complete` | `archived`. Absent on older payloads. */
  status?: string;
  /**
   * The use-case shell this objective renders in — a registry id, not a label.
   * Absent or unregistered means the core Foreman chrome only.
   */
  useCase?: string | null;
  /**
   * Standing instructions injected into the system prompt of every pulse of
   * every harness under this objective. Absent means none are set.
   */
  instructions?: string | null;
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
  /** The model that actually served this pulse. Absent on older payloads. */
  model?: string | null;
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
  /** SkillArtifact names granted to this harness. Absent on older payloads. */
  skills?: string[];
  /** Rolling working memory the agent carries across pulses. */
  memory?: string | null;
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

export interface ActivityEntry {
  id: string;
  verb: 'merged' | 'spawned' | 'paused' | 'failed' | 'retired';
  text: string;
  at: string;
}

/** The single payload every shell renders from. */
export interface ObjectiveState {
  objective: Objective;
  workstreams: Workstream[];
  /** Flat — the tree is rebuilt client-side from parentId. */
  harnesses: Harness[];
  interventions: Intervention[];
  tickets: Ticket[];
  activity: ActivityEntry[];
}
