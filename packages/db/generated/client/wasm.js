
Object.defineProperty(exports, "__esModule", { value: true });

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  skip,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  warnOnce,
  defineDmmfProperty,
  Public,
  getRuntime
} = require('./runtime/wasm.js')


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

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError;
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = Extensions.getExtensionContext
Prisma.defineExtension = Extensions.defineExtension

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
  useCase: 'useCase',
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
  lastRanAt: 'lastRanAt',
  command: 'command',
  permissionId: 'permissionId',
  timeoutMs: 'timeoutMs',
  approvedInterventionId: 'approvedInterventionId'
};

exports.Prisma.HarnessToolRunScalarFieldEnum = {
  id: 'id',
  toolId: 'toolId',
  harnessId: 'harnessId',
  status: 'status',
  label: 'label',
  command: 'command',
  cwd: 'cwd',
  exitCode: 'exitCode',
  durationMs: 'durationMs',
  permissionId: 'permissionId',
  interventionId: 'interventionId',
  output: 'output',
  createdAt: 'createdAt'
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
  HarnessTool: 'HarnessTool',
  HarnessToolRun: 'HarnessToolRun'
};
/**
 * Create the Client
 */
const config = {
  "generator": {
    "name": "client",
    "provider": {
      "fromEnvVar": null,
      "value": "prisma-client-js"
    },
    "output": {
      "value": "/Users/benebsworth/projects/omega/harness/packages/db/generated/client",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "darwin-arm64",
        "native": true
      }
    ],
    "previewFeatures": [
      "driverAdapters"
    ],
    "sourceFilePath": "/Users/benebsworth/projects/omega/harness/packages/db/prisma/schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null
  },
  "relativePath": "../../prisma",
  "clientVersion": "5.22.0",
  "engineVersion": "605197351a3c8bdd595af2d2a9bc3025bca48ea2",
  "datasourceNames": [
    "db"
  ],
  "activeProvider": "postgresql",
  "postinstall": false,
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "generator client {\n  provider        = \"prisma-client-js\"\n  output          = \"../generated/client\"\n  previewFeatures = [\"driverAdapters\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nmodel Project {\n  id          String      @id @default(uuid())\n  name        String\n  path        String      @unique\n  repoUrl     String?\n  description String?\n  env         String? // JSON\n  createdAt   DateTime    @default(now())\n  tasks       Task[]\n  objectives  Objective[]\n}\n\nmodel Task {\n  id           String      @id @default(uuid())\n  projectId    String\n  project      Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)\n  title        String\n  description  String?\n  status       String      @default(\"todo\")\n  complexity   String      @default(\"simple\")\n  tags         String? // JSON array\n  provider     String?\n  model        String?\n  result       String?\n  error        String?\n  retryCount   Int         @default(0)\n  lastRetryAt  DateTime?\n  retryHistory String? // JSON: [{ strategy, provider, model, error, timestamp }]\n  createdAt    DateTime    @default(now())\n  updatedAt    DateTime    @updatedAt\n  steps        TaskStep[]\n  traces       TaskTrace[]\n  diffs        TaskDiff[]\n  agentRuns    AgentRun[]\n  traceSpans   TraceSpan[]\n\n  @@index([status, createdAt])\n  @@index([projectId])\n  @@index([provider, createdAt])\n}\n\nmodel TaskStep {\n  id        String   @id @default(uuid())\n  taskId    String\n  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  idx       Int\n  name      String\n  status    String   @default(\"pending\")\n  input     String? // JSON or free text\n  output    String?\n  error     String?\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@index([taskId])\n}\n\nmodel TaskTrace {\n  id        String   @id @default(uuid())\n  taskId    String\n  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  stepId    String?\n  role      String // system | user | assistant | tool\n  content   String?\n  toolCalls String? // JSON\n  createdAt DateTime @default(now())\n\n  @@index([taskId])\n}\n\nmodel TaskDiff {\n  id        String   @id @default(uuid())\n  taskId    String\n  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  branch    String\n  commitSha String?\n  patch     String\n  createdAt DateTime @default(now())\n\n  @@index([taskId])\n}\n\nmodel AgentRun {\n  id                    String         @id @default(uuid())\n  taskId                String\n  task                  Task           @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  promptVersionId       String?\n  promptVersion         PromptVersion? @relation(fields: [promptVersionId], references: [id], onDelete: SetNull)\n  branch                String\n  baseCommit            String\n  resultStatus          String         @default(\"running\")\n  validationSummary     String? // JSON\n  publishedVersion      String?\n  promptTokens          Int?\n  completionTokens      Int?\n  totalTokens           Int?\n  costUsd               Float?\n  turnCount             Int?\n  toolCalls             String? // JSON: { toolName: count, ... }\n  turnDurationMs        Int?\n  phaseTimings          String? // JSON: { phaseName: durationMs, ... }\n  currentPhase          String?\n  currentPhaseStartedAt DateTime?\n  currentTurn           Int?\n  createdAt             DateTime       @default(now())\n  updatedAt             DateTime       @updatedAt\n\n  @@index([taskId])\n  @@index([promptVersionId])\n  @@index([createdAt])\n}\n\nmodel TraceSpan {\n  id         String    @id @default(uuid())\n  traceId    String\n  spanId     String\n  parentId   String?\n  taskId     String?\n  task       Task?     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  name       String\n  startTime  DateTime  @default(now())\n  endTime    DateTime?\n  status     String    @default(\"ok\") // ok | error\n  attributes String? // JSON\n  events     String? // JSON\n\n  @@index([traceId])\n  @@index([taskId])\n}\n\nmodel ProviderConfig {\n  id             String    @id @default(uuid())\n  name           String    @unique\n  kind           String\n  baseUrl        String?\n  apiKey         String?\n  refreshToken   String?\n  tokenExpiresAt DateTime?\n  defaultModel   String\n  capabilities   String // JSON\n  enabled        Boolean   @default(true)\n  createdAt      DateTime  @default(now())\n}\n\nmodel SkillArtifact {\n  id            String   @id @default(uuid())\n  name          String   @unique\n  sourcePath    String\n  generatedPath String\n  manifest      String // JSON\n  registeredAt  DateTime @default(now())\n}\n\nmodel PromptVersion {\n  id              String     @id @default(uuid())\n  name            String     @unique\n  sourcePath      String\n  systemPrompt    String\n  textToolsPrompt String\n  planningPrompt  String?\n  skillContext    String?\n  hash            String\n  metadata        String? // JSON\n  benchmarkScore  Float?\n  agentRuns       AgentRun[]\n  createdAt       DateTime   @default(now())\n}\n\nmodel BenchmarkHistory {\n  id              String   @id @default(uuid())\n  suite           String\n  provider        String?\n  model           String?\n  totalTasks      Int\n  passed          Int\n  failed          Int\n  timeouts        Int\n  passRate        Float\n  totalDurationMs Int\n  totalCostUsd    Float?\n  totalTokens     Int?\n  metadata        String? // JSON: per-task results, variance data, etc.\n  reportPath      String?\n  createdAt       DateTime @default(now())\n\n  @@index([suite])\n  @@index([provider, model])\n  @@index([createdAt])\n}\n\nmodel BenchmarkRun {\n  id              String    @id @default(uuid())\n  suite           String\n  status          String    @default(\"pending\") // pending | running | done | failed | cancelled\n  config          String // JSON: { models, strategy, concurrency, timeoutMs, tokenBudget, ... }\n  totalTasks      Int       @default(0)\n  passed          Int       @default(0)\n  failed          Int       @default(0)\n  timeouts        Int       @default(0)\n  totalDurationMs Int       @default(0)\n  totalCostUsd    Float?\n  totalTokens     Int?\n  results         String? // JSON: per-task results\n  error           String?\n  startedAt       DateTime?\n  completedAt     DateTime?\n  createdAt       DateTime  @default(now())\n  updatedAt       DateTime  @updatedAt\n\n  @@index([status])\n  @@index([suite])\n  @@index([createdAt])\n}\n\nmodel ProviderCircuitState {\n  providerName   String    @id\n  state          String    @default(\"closed\") // closed, open, half-open\n  errorRate      Float     @default(0)\n  lastFailureAt  DateTime?\n  lastSuccessAt  DateTime?\n  cooldownUntil  DateTime?\n  trialStartedAt DateTime?\n  trialRequestId String?\n  createdAt      DateTime  @default(now())\n  updatedAt      DateTime  @updatedAt\n}\n\nmodel Objective {\n  id            String           @id @default(uuid())\n  projectId     String\n  project       Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)\n  name          String\n  description   String?\n  status        String           @default(\"active\")\n  /// Use-case shell id (a lowercase slug, e.g. \"victoria\"). Null means the\n  /// objective renders with the core Foreman chrome only.\n  useCase       String?\n  targetDate    DateTime?\n  spendCapUsd   Float?\n  createdAt     DateTime         @default(now())\n  updatedAt     DateTime         @updatedAt\n  phases        ObjectivePhase[]\n  workstreams   Workstream[]\n  harnesses     Harness[]\n  interventions Intervention[]\n\n  @@index([projectId])\n}\n\nmodel ObjectivePhase {\n  id          String    @id @default(uuid())\n  objectiveId String\n  objective   Objective @relation(fields: [objectiveId], references: [id], onDelete: Cascade)\n  name        String\n  state       String\n  weight      Float     @default(1)\n  detail      String?\n  orderIdx    Int\n\n  @@index([objectiveId])\n}\n\nmodel Workstream {\n  id            String    @id @default(uuid())\n  objectiveId   String\n  objective     Objective @relation(fields: [objectiveId], references: [id], onDelete: Cascade)\n  name          String\n  paused        Boolean   @default(false)\n  pausedAt      DateTime?\n  pausedNote    String?\n  orderIdx      Int       @default(0)\n  leadHarnessId String?\n  harnesses     Harness[]\n\n  @@index([objectiveId])\n}\n\nmodel Harness {\n  id                String        @id @default(uuid())\n  objectiveId       String\n  objective         Objective     @relation(fields: [objectiveId], references: [id], onDelete: Cascade)\n  workstreamId      String?\n  workstream        Workstream?   @relation(fields: [workstreamId], references: [id], onDelete: SetNull)\n  parentId          String?\n  parent            Harness?      @relation(\"HarnessTree\", fields: [parentId], references: [id], onDelete: SetNull)\n  children          Harness[]     @relation(\"HarnessTree\")\n  name              String\n  status            String        @default(\"ready\")\n  statusBeforePause String?\n  activity          String?\n  mission           String\n  currentJob        String?\n  model             String\n  playbookId        String?\n  taskId            String?\n  branch            String?\n  heartbeatMinutes  Int           @default(30)\n  nextPulseAt       DateTime?\n  maxChildren       Int           @default(3)\n  spendCapUsd       Float?\n  spendUsd          Float         @default(0)\n  contextTokens     Int           @default(0)\n  contextWindow     Int           @default(200000)\n  permissions       String        @default(\"[]\")\n  dryRun            Boolean       @default(false)\n  lastPulseSeq      Int           @default(0)\n  idleSince         DateTime?\n  createdAt         DateTime      @default(now())\n  updatedAt         DateTime      @updatedAt\n  retiredAt         DateTime?\n  pulses            Pulse[]\n  tools             HarnessTool[]\n\n  @@index([objectiveId, status])\n  @@index([parentId])\n  @@index([workstreamId])\n}\n\nmodel Pulse {\n  id        String    @id @default(uuid())\n  harnessId String\n  harness   Harness   @relation(fields: [harnessId], references: [id], onDelete: Cascade)\n  seq       Int\n  startedAt DateTime\n  endedAt   DateTime?\n  outcome   String\n  summary   String?\n  costUsd   Float     @default(0)\n  tokens    Int       @default(0)\n  weight    Float     @default(0.5)\n\n  @@unique([harnessId, seq])\n  @@index([harnessId, seq(sort: Desc)])\n  @@index([harnessId, startedAt(sort: Desc)])\n}\n\nmodel Intervention {\n  id          String    @id @default(uuid())\n  objectiveId String\n  objective   Objective @relation(fields: [objectiveId], references: [id], onDelete: Cascade)\n  harnessId   String\n  kind        String\n  title       String\n  detail      String?\n  impact      String?\n  payload     String?\n  status      String    @default(\"pending\")\n  response    String?\n  createdAt   DateTime  @default(now())\n  resolvedAt  DateTime?\n\n  @@index([objectiveId, status])\n}\n\nmodel Playbook {\n  id                String   @id @default(uuid())\n  projectId         String?\n  name              String\n  version           Int      @default(1)\n  variables         String   @default(\"[]\")\n  cadence           String   @default(\"every 30m\")\n  retireWhen        String?\n  steps             String   @default(\"[]\")\n  previousVersionId String?\n  createdAt         DateTime @default(now())\n\n  @@unique([name, version])\n}\n\nmodel HarnessTool {\n  id                     String    @id @default(uuid())\n  harnessId              String\n  harness                Harness   @relation(fields: [harnessId], references: [id], onDelete: Cascade)\n  name                   String\n  groupName              String\n  needsApproval          Boolean   @default(false)\n  lastStatus             String?\n  lastResultLabel        String?\n  lastRanAt              DateTime?\n  // The shell command this tool runs, in the objective's project checkout.\n  // NULL means the tool has no execution configured: running it records the\n  // request and executes nothing, which is what every tool did before.\n  command                String?\n  // Which `Harness.permissions` entry authorises this tool. Defaults to\n  // `tool:<id>` when unset.\n  permissionId           String?\n  // Per-tool wall-clock bound; NULL falls back to the 60s default.\n  timeoutMs              Int?\n  // Set when a human approved ONE run via an intervention. Consumed by the\n  // next run of this tool and cleared, so approval never becomes standing.\n  approvedInterventionId String?\n\n  runs HarnessToolRun[]\n\n  @@index([harnessId])\n}\n\n/// One attempted invocation of a HarnessTool — recorded, blocked, or executed.\n/// This is the audit trail: it exists even when nothing ran.\nmodel HarnessToolRun {\n  id             String      @id @default(uuid())\n  toolId         String\n  tool           HarnessTool @relation(fields: [toolId], references: [id], onDelete: Cascade)\n  harnessId      String\n  /// recorded | blocked-pending-approval | ok | fail | timeout | error\n  status         String\n  label          String\n  command        String?\n  cwd            String?\n  exitCode       Int?\n  durationMs     Int?\n  /// The permission id that authorised the run, if a standing permission did.\n  permissionId   String?\n  /// The intervention that authorised (one-shot approval) or blocked this run.\n  interventionId String?\n  /// Bounded excerpt of the combined stdout/stderr.\n  output         String?\n  createdAt      DateTime    @default(now())\n\n  @@index([toolId, createdAt(sort: Desc)])\n  @@index([harnessId, createdAt(sort: Desc)])\n}\n",
  "inlineSchemaHash": "bada509200dc160a2a00d95221d39f5905a11c045800fa636e74a0bd423d9f01",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"Project\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"path\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"repoUrl\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"env\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"tasks\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"ProjectToTask\"},{\"name\":\"objectives\",\"kind\":\"object\",\"type\":\"Objective\",\"relationName\":\"ObjectiveToProject\"}],\"dbName\":null},\"Task\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"projectId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"project\",\"kind\":\"object\",\"type\":\"Project\",\"relationName\":\"ProjectToTask\"},{\"name\":\"title\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"complexity\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tags\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"provider\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"model\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"result\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"error\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"retryCount\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"lastRetryAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"retryHistory\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"steps\",\"kind\":\"object\",\"type\":\"TaskStep\",\"relationName\":\"TaskToTaskStep\"},{\"name\":\"traces\",\"kind\":\"object\",\"type\":\"TaskTrace\",\"relationName\":\"TaskToTaskTrace\"},{\"name\":\"diffs\",\"kind\":\"object\",\"type\":\"TaskDiff\",\"relationName\":\"TaskToTaskDiff\"},{\"name\":\"agentRuns\",\"kind\":\"object\",\"type\":\"AgentRun\",\"relationName\":\"AgentRunToTask\"},{\"name\":\"traceSpans\",\"kind\":\"object\",\"type\":\"TraceSpan\",\"relationName\":\"TaskToTraceSpan\"}],\"dbName\":null},\"TaskStep\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTaskStep\"},{\"name\":\"idx\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"input\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"output\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"error\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"TaskTrace\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTaskTrace\"},{\"name\":\"stepId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"role\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"content\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"toolCalls\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"TaskDiff\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTaskDiff\"},{\"name\":\"branch\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"commitSha\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"patch\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"AgentRun\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"AgentRunToTask\"},{\"name\":\"promptVersionId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"promptVersion\",\"kind\":\"object\",\"type\":\"PromptVersion\",\"relationName\":\"AgentRunToPromptVersion\"},{\"name\":\"branch\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"baseCommit\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"resultStatus\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"validationSummary\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"publishedVersion\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"promptTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"completionTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"totalTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"costUsd\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"turnCount\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"toolCalls\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"turnDurationMs\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"phaseTimings\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"currentPhase\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"currentPhaseStartedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"currentTurn\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"TraceSpan\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"traceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"spanId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"parentId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTraceSpan\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"startTime\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"endTime\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"attributes\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"events\",\"kind\":\"scalar\",\"type\":\"String\"}],\"dbName\":null},\"ProviderConfig\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"kind\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"baseUrl\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"apiKey\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"refreshToken\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tokenExpiresAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"defaultModel\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"capabilities\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"enabled\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"SkillArtifact\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sourcePath\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"generatedPath\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"manifest\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"registeredAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"PromptVersion\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sourcePath\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"systemPrompt\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"textToolsPrompt\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"planningPrompt\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"skillContext\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"hash\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"metadata\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"benchmarkScore\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"agentRuns\",\"kind\":\"object\",\"type\":\"AgentRun\",\"relationName\":\"AgentRunToPromptVersion\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"BenchmarkHistory\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"suite\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"provider\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"model\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"totalTasks\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"passed\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"failed\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"timeouts\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"passRate\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"totalDurationMs\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"totalCostUsd\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"totalTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"metadata\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reportPath\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"BenchmarkRun\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"suite\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"config\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"totalTasks\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"passed\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"failed\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"timeouts\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"totalDurationMs\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"totalCostUsd\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"totalTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"results\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"error\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"startedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"completedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"ProviderCircuitState\":{\"fields\":[{\"name\":\"providerName\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"state\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"errorRate\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"lastFailureAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"lastSuccessAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"cooldownUntil\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"trialStartedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"trialRequestId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"Objective\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"projectId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"project\",\"kind\":\"object\",\"type\":\"Project\",\"relationName\":\"ObjectiveToProject\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"useCase\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"targetDate\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"spendCapUsd\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"phases\",\"kind\":\"object\",\"type\":\"ObjectivePhase\",\"relationName\":\"ObjectiveToObjectivePhase\"},{\"name\":\"workstreams\",\"kind\":\"object\",\"type\":\"Workstream\",\"relationName\":\"ObjectiveToWorkstream\"},{\"name\":\"harnesses\",\"kind\":\"object\",\"type\":\"Harness\",\"relationName\":\"HarnessToObjective\"},{\"name\":\"interventions\",\"kind\":\"object\",\"type\":\"Intervention\",\"relationName\":\"InterventionToObjective\"}],\"dbName\":null},\"ObjectivePhase\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objectiveId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objective\",\"kind\":\"object\",\"type\":\"Objective\",\"relationName\":\"ObjectiveToObjectivePhase\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"state\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"weight\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"detail\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"orderIdx\",\"kind\":\"scalar\",\"type\":\"Int\"}],\"dbName\":null},\"Workstream\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objectiveId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objective\",\"kind\":\"object\",\"type\":\"Objective\",\"relationName\":\"ObjectiveToWorkstream\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"paused\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"pausedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"pausedNote\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"orderIdx\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"leadHarnessId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"harnesses\",\"kind\":\"object\",\"type\":\"Harness\",\"relationName\":\"HarnessToWorkstream\"}],\"dbName\":null},\"Harness\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objectiveId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objective\",\"kind\":\"object\",\"type\":\"Objective\",\"relationName\":\"HarnessToObjective\"},{\"name\":\"workstreamId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workstream\",\"kind\":\"object\",\"type\":\"Workstream\",\"relationName\":\"HarnessToWorkstream\"},{\"name\":\"parentId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"parent\",\"kind\":\"object\",\"type\":\"Harness\",\"relationName\":\"HarnessTree\"},{\"name\":\"children\",\"kind\":\"object\",\"type\":\"Harness\",\"relationName\":\"HarnessTree\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"statusBeforePause\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"activity\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"mission\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"currentJob\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"model\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"playbookId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"branch\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"heartbeatMinutes\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"nextPulseAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"maxChildren\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"spendCapUsd\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"spendUsd\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"contextTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"contextWindow\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"permissions\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"dryRun\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"lastPulseSeq\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"idleSince\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"retiredAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"pulses\",\"kind\":\"object\",\"type\":\"Pulse\",\"relationName\":\"HarnessToPulse\"},{\"name\":\"tools\",\"kind\":\"object\",\"type\":\"HarnessTool\",\"relationName\":\"HarnessToHarnessTool\"}],\"dbName\":null},\"Pulse\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"harnessId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"harness\",\"kind\":\"object\",\"type\":\"Harness\",\"relationName\":\"HarnessToPulse\"},{\"name\":\"seq\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"startedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"endedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"outcome\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"summary\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"costUsd\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"tokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"weight\",\"kind\":\"scalar\",\"type\":\"Float\"}],\"dbName\":null},\"Intervention\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objectiveId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"objective\",\"kind\":\"object\",\"type\":\"Objective\",\"relationName\":\"InterventionToObjective\"},{\"name\":\"harnessId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"kind\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"title\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"detail\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"impact\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"payload\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"response\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"resolvedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"Playbook\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"projectId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"version\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"variables\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"cadence\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"retireWhen\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"steps\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"previousVersionId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"HarnessTool\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"harnessId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"harness\",\"kind\":\"object\",\"type\":\"Harness\",\"relationName\":\"HarnessToHarnessTool\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"groupName\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"needsApproval\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"lastStatus\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"lastResultLabel\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"lastRanAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"command\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"permissionId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"timeoutMs\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"approvedInterventionId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"runs\",\"kind\":\"object\",\"type\":\"HarnessToolRun\",\"relationName\":\"HarnessToolToHarnessToolRun\"}],\"dbName\":null},\"HarnessToolRun\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"toolId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tool\",\"kind\":\"object\",\"type\":\"HarnessTool\",\"relationName\":\"HarnessToolToHarnessToolRun\"},{\"name\":\"harnessId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"label\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"command\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"cwd\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"exitCode\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"durationMs\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"permissionId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"interventionId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"output\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null}},\"enums\":{},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = {
  getRuntime: () => require('./query_engine_bg.js'),
  getQueryEngineWasmModule: async () => {
    const loader = (await import('#wasm-engine-loader')).default
    const engine = (await loader).default
    return engine 
  }
}

config.injectableEdgeEnv = () => ({
  parsed: {
    DATABASE_URL: typeof globalThis !== 'undefined' && globalThis['DATABASE_URL'] || typeof process !== 'undefined' && process.env && process.env.DATABASE_URL || undefined
  }
})

if (typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined) {
  Debug.enable(typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined)
}

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

