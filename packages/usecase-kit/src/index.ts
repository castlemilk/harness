/**
 * `@omega-harness/usecase-kit` — the use-case plugin contract.
 *
 * Everything a Foreman use-case shell is allowed to know about the harness is
 * exported from here, and nothing else is. See README.md for the rules that
 * shape it (pure exports, the never-widen contract, how a foreign repo
 * consumes this package).
 */

export type {
  UseCaseShell,
  UseCaseView,
  UseCaseViewProps,
  Vocabulary,
} from './shell.js';

export {
  createDataSource,
  DataSourceError,
  resolveBaseUrl,
  setUseCaseEnv,
  type ProbeResult,
  type SseOptions,
  type UseCaseDataSource,
  type UseCaseDataSourceConfig,
} from './data-source.js';

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
} from './state.js';
