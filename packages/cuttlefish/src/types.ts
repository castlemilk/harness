/**
 * Types mirroring the cuttlefish control-plane HTTP API
 * (`internal/controlplane` in the cuttlefish repo).
 *
 * Only the subset the harness needs is modelled: workflows, runs, attempts,
 * events and artifacts. Unknown fields are preserved on `raw` where callers
 * may want to inspect them.
 */

export type RunStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'DISPATCHED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED'
  | (string & {});

export type DispatchMode = 'manual' | 'autopilot';
export type IntentProfile = 'balanced' | 'low_latency' | 'high_capacity';

export interface CuttlefishWorkflowSummary {
  id: string;
  name: string;
  description?: string;
  kind?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CuttlefishWorkflow {
  id: string;
  name: string;
  description?: string;
  kind?: string;
  draftYAML?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CuttlefishWorkflowVersion {
  id: string;
  workflowId?: string;
  versionNum?: number;
  workflowYAML?: string;
  createdAt?: string;
}

export interface CuttlefishValidationIssue {
  severity: 'warn' | 'error' | (string & {});
  code?: string;
  message: string;
  file?: string;
  jsonPointer?: string;
  edgeId?: string;
  nodeId?: string;
  field?: string;
  line?: number;
  column?: number;
}

export interface CuttlefishRun {
  id: string;
  status: RunStatus;
  workflowName?: string;
  workflowVersionId?: string;
  workflowYAML?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  latestReason?: string;
  latestReasonNodeId?: string;
  projectId?: string;
  runnerId?: string;
  runnerPoolName?: string;
  runnerVersion?: string;
  runnerExecutionMode?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CuttlefishTaskInstance {
  runId: string;
  nodeId: string;
  status: RunStatus;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CuttlefishAttempt {
  id: string;
  runId?: string;
  nodeId: string;
  attemptNum: number;
  status: RunStatus;
  runnerId?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  logs?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  [key: string]: unknown;
}

export interface CuttlefishRunEvent {
  id: number | string;
  runId: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
  [key: string]: unknown;
}

export interface CuttlefishArtifact {
  id?: string;
  name?: string;
  path?: string;
  sizeBytes?: number;
  contentType?: string;
  attemptId?: string;
  nodeId?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface CuttlefishRunner {
  id: string;
  poolName?: string;
  capacity?: number;
  acceptingWork?: boolean;
  version?: string;
  executionMode?: string;
  capabilities?: string[];
  labels?: Record<string, string>;
  activeLeases?: number;
  displayName?: string;
  hostname?: string;
  os?: string;
  arch?: string;
  lastSeenAt?: string;
  [key: string]: unknown;
}

export interface StartRunRequest {
  /** Inline workflow document. Mutually exclusive with `workflowVersionId`. */
  workflowYAML?: string;
  /** A published workflow version. Mutually exclusive with `workflowYAML`. */
  workflowVersionId?: string;
  inputs?: Record<string, unknown>;
  dispatchMode?: DispatchMode;
  intentProfile?: IntentProfile;
  candidateLimit?: number;
  runnerPoolName?: string;
  runnerId?: string;
  runnerVersion?: string;
  runnerExecutionMode?: string;
  runnerCapabilities?: string[];
  runnerLabels?: Record<string, string>;
}

export interface StartRunResponse {
  run: CuttlefishRun;
  taskInstances?: CuttlefishTaskInstance[];
  planning?: Record<string, unknown>;
}

export interface RunDetail {
  run: CuttlefishRun;
  taskInstances: CuttlefishTaskInstance[];
}

export interface ListRunsParams {
  status?: string;
  limit?: number;
  runnerId?: string;
  projectId?: string;
}
