
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.ProjectScalarFieldEnum = {
  id: 'id',
  name: 'name',
  path: 'path',
  repoUrl: 'repoUrl',
  description: 'description',
  env: 'env',
  createdAt: 'createdAt'
};

exports.Prisma.TaskScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  title: 'title',
  description: 'description',
  status: 'status',
  complexity: 'complexity',
  tags: 'tags',
  provider: 'provider',
  model: 'model',
  result: 'result',
  error: 'error',
  retryCount: 'retryCount',
  lastRetryAt: 'lastRetryAt',
  retryHistory: 'retryHistory',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TaskStepScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  idx: 'idx',
  name: 'name',
  status: 'status',
  input: 'input',
  output: 'output',
  error: 'error',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TaskTraceScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  stepId: 'stepId',
  role: 'role',
  content: 'content',
  toolCalls: 'toolCalls',
  createdAt: 'createdAt'
};

exports.Prisma.TaskDiffScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  branch: 'branch',
  commitSha: 'commitSha',
  patch: 'patch',
  createdAt: 'createdAt'
};

exports.Prisma.AgentRunScalarFieldEnum = {
  id: 'id',
  taskId: 'taskId',
  promptVersionId: 'promptVersionId',
  branch: 'branch',
  baseCommit: 'baseCommit',
  resultStatus: 'resultStatus',
  validationSummary: 'validationSummary',
  publishedVersion: 'publishedVersion',
  promptTokens: 'promptTokens',
  completionTokens: 'completionTokens',
  totalTokens: 'totalTokens',
  costUsd: 'costUsd',
  turnCount: 'turnCount',
  toolCalls: 'toolCalls',
  turnDurationMs: 'turnDurationMs',
  phaseTimings: 'phaseTimings',
  currentPhase: 'currentPhase',
  currentPhaseStartedAt: 'currentPhaseStartedAt',
  currentTurn: 'currentTurn',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TraceSpanScalarFieldEnum = {
  id: 'id',
  traceId: 'traceId',
  spanId: 'spanId',
  parentId: 'parentId',
  taskId: 'taskId',
  name: 'name',
  startTime: 'startTime',
  endTime: 'endTime',
  status: 'status',
  attributes: 'attributes',
  events: 'events'
};

exports.Prisma.ProviderConfigScalarFieldEnum = {
  id: 'id',
  name: 'name',
  kind: 'kind',
  baseUrl: 'baseUrl',
  apiKey: 'apiKey',
  refreshToken: 'refreshToken',
  tokenExpiresAt: 'tokenExpiresAt',
  defaultModel: 'defaultModel',
  capabilities: 'capabilities',
  enabled: 'enabled',
  createdAt: 'createdAt'
};

exports.Prisma.SkillArtifactScalarFieldEnum = {
  id: 'id',
  name: 'name',
  sourcePath: 'sourcePath',
  generatedPath: 'generatedPath',
  manifest: 'manifest',
  registeredAt: 'registeredAt'
};

exports.Prisma.PromptVersionScalarFieldEnum = {
  id: 'id',
  name: 'name',
  sourcePath: 'sourcePath',
  systemPrompt: 'systemPrompt',
  textToolsPrompt: 'textToolsPrompt',
  planningPrompt: 'planningPrompt',
  skillContext: 'skillContext',
  hash: 'hash',
  metadata: 'metadata',
  benchmarkScore: 'benchmarkScore',
  createdAt: 'createdAt'
};

exports.Prisma.BenchmarkHistoryScalarFieldEnum = {
  id: 'id',
  suite: 'suite',
  provider: 'provider',
  model: 'model',
  totalTasks: 'totalTasks',
  passed: 'passed',
  failed: 'failed',
  timeouts: 'timeouts',
  passRate: 'passRate',
  totalDurationMs: 'totalDurationMs',
  totalCostUsd: 'totalCostUsd',
  totalTokens: 'totalTokens',
  metadata: 'metadata',
  reportPath: 'reportPath',
  createdAt: 'createdAt'
};

exports.Prisma.BenchmarkRunScalarFieldEnum = {
  id: 'id',
  suite: 'suite',
  status: 'status',
  config: 'config',
  totalTasks: 'totalTasks',
  passed: 'passed',
  failed: 'failed',
  timeouts: 'timeouts',
  totalDurationMs: 'totalDurationMs',
  totalCostUsd: 'totalCostUsd',
  totalTokens: 'totalTokens',
  results: 'results',
  error: 'error',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProviderCircuitStateScalarFieldEnum = {
  providerName: 'providerName',
  state: 'state',
  errorRate: 'errorRate',
  lastFailureAt: 'lastFailureAt',
  lastSuccessAt: 'lastSuccessAt',
  cooldownUntil: 'cooldownUntil',
  trialStartedAt: 'trialStartedAt',
  trialRequestId: 'trialRequestId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ObjectiveScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  name: 'name',
  description: 'description',
  status: 'status',
  targetDate: 'targetDate',
  spendCapUsd: 'spendCapUsd',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ObjectivePhaseScalarFieldEnum = {
  id: 'id',
  objectiveId: 'objectiveId',
  name: 'name',
  state: 'state',
  weight: 'weight',
  detail: 'detail',
  orderIdx: 'orderIdx'
};

exports.Prisma.WorkstreamScalarFieldEnum = {
  id: 'id',
  objectiveId: 'objectiveId',
  name: 'name',
  paused: 'paused',
  pausedAt: 'pausedAt',
  pausedNote: 'pausedNote',
  orderIdx: 'orderIdx',
  leadHarnessId: 'leadHarnessId'
};

exports.Prisma.HarnessScalarFieldEnum = {
  id: 'id',
  objectiveId: 'objectiveId',
  workstreamId: 'workstreamId',
  parentId: 'parentId',
  name: 'name',
  status: 'status',
  statusBeforePause: 'statusBeforePause',
  activity: 'activity',
  mission: 'mission',
  currentJob: 'currentJob',
  model: 'model',
  playbookId: 'playbookId',
  taskId: 'taskId',
  branch: 'branch',
  heartbeatMinutes: 'heartbeatMinutes',
  nextPulseAt: 'nextPulseAt',
  maxChildren: 'maxChildren',
  spendCapUsd: 'spendCapUsd',
  spendUsd: 'spendUsd',
  contextTokens: 'contextTokens',
  contextWindow: 'contextWindow',
  permissions: 'permissions',
  dryRun: 'dryRun',
  lastPulseSeq: 'lastPulseSeq',
  idleSince: 'idleSince',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  retiredAt: 'retiredAt'
};

exports.Prisma.PulseScalarFieldEnum = {
  id: 'id',
  harnessId: 'harnessId',
  seq: 'seq',
  startedAt: 'startedAt',
  endedAt: 'endedAt',
  outcome: 'outcome',
  summary: 'summary',
  costUsd: 'costUsd',
  tokens: 'tokens',
  weight: 'weight'
};

exports.Prisma.InterventionScalarFieldEnum = {
  id: 'id',
  objectiveId: 'objectiveId',
  harnessId: 'harnessId',
  kind: 'kind',
  title: 'title',
  detail: 'detail',
  impact: 'impact',
  payload: 'payload',
  status: 'status',
  response: 'response',
  createdAt: 'createdAt',
  resolvedAt: 'resolvedAt'
};

exports.Prisma.PlaybookScalarFieldEnum = {
  id: 'id',
  projectId: 'projectId',
  name: 'name',
  version: 'version',
  variables: 'variables',
  cadence: 'cadence',
  retireWhen: 'retireWhen',
  steps: 'steps',
  previousVersionId: 'previousVersionId',
  createdAt: 'createdAt'
};

exports.Prisma.HarnessToolScalarFieldEnum = {
  id: 'id',
  harnessId: 'harnessId',
  name: 'name',
  groupName: 'groupName',
  needsApproval: 'needsApproval',
  lastStatus: 'lastStatus',
  lastResultLabel: 'lastResultLabel',
  lastRanAt: 'lastRanAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  Project: 'Project',
  Task: 'Task',
  TaskStep: 'TaskStep',
  TaskTrace: 'TaskTrace',
  TaskDiff: 'TaskDiff',
  AgentRun: 'AgentRun',
  TraceSpan: 'TraceSpan',
  ProviderConfig: 'ProviderConfig',
  SkillArtifact: 'SkillArtifact',
  PromptVersion: 'PromptVersion',
  BenchmarkHistory: 'BenchmarkHistory',
  BenchmarkRun: 'BenchmarkRun',
  ProviderCircuitState: 'ProviderCircuitState',
  Objective: 'Objective',
  ObjectivePhase: 'ObjectivePhase',
  Workstream: 'Workstream',
  Harness: 'Harness',
  Pulse: 'Pulse',
  Intervention: 'Intervention',
  Playbook: 'Playbook',
  HarnessTool: 'HarnessTool'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
