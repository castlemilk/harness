
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
  branch: 'branch',
  baseCommit: 'baseCommit',
  resultStatus: 'resultStatus',
  validationSummary: 'validationSummary',
  publishedVersion: 'publishedVersion',
  promptTokens: 'promptTokens',
  completionTokens: 'completionTokens',
  totalTokens: 'totalTokens',
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
  hash: 'hash',
  metadata: 'metadata',
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
  PromptVersion: 'PromptVersion'
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
  "inlineSchema": "generator client {\n  provider        = \"prisma-client-js\"\n  output          = \"../generated/client\"\n  previewFeatures = [\"driverAdapters\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nmodel Project {\n  id          String   @id @default(uuid())\n  name        String\n  path        String   @unique\n  repoUrl     String?\n  description String?\n  env         String? // JSON\n  createdAt   DateTime @default(now())\n  tasks       Task[]\n}\n\nmodel Task {\n  id          String      @id @default(uuid())\n  projectId   String\n  project     Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)\n  title       String\n  description String?\n  status      String      @default(\"todo\")\n  complexity  String      @default(\"simple\")\n  tags        String? // JSON array\n  provider    String?\n  model       String?\n  result      String?\n  error       String?\n  createdAt   DateTime    @default(now())\n  updatedAt   DateTime    @updatedAt\n  steps       TaskStep[]\n  traces      TaskTrace[]\n  diffs       TaskDiff[]\n  agentRuns   AgentRun[]\n  traceSpans  TraceSpan[]\n}\n\nmodel TaskStep {\n  id        String   @id @default(uuid())\n  taskId    String\n  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  idx       Int\n  name      String\n  status    String   @default(\"pending\")\n  input     String? // JSON or free text\n  output    String?\n  error     String?\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@index([taskId])\n}\n\nmodel TaskTrace {\n  id        String   @id @default(uuid())\n  taskId    String\n  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  stepId    String?\n  role      String // system | user | assistant | tool\n  content   String?\n  toolCalls String? // JSON\n  createdAt DateTime @default(now())\n\n  @@index([taskId])\n}\n\nmodel TaskDiff {\n  id        String   @id @default(uuid())\n  taskId    String\n  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  branch    String\n  commitSha String?\n  patch     String\n  createdAt DateTime @default(now())\n\n  @@index([taskId])\n}\n\nmodel AgentRun {\n  id                String   @id @default(uuid())\n  taskId            String\n  task              Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  branch            String\n  baseCommit        String\n  resultStatus      String   @default(\"running\")\n  validationSummary String? // JSON\n  publishedVersion  String?\n  promptTokens      Int?\n  completionTokens  Int?\n  totalTokens       Int?\n  createdAt         DateTime @default(now())\n  updatedAt         DateTime @updatedAt\n\n  @@index([taskId])\n}\n\nmodel TraceSpan {\n  id         String    @id @default(uuid())\n  traceId    String\n  spanId     String\n  parentId   String?\n  taskId     String?\n  task       Task?     @relation(fields: [taskId], references: [id], onDelete: Cascade)\n  name       String\n  startTime  DateTime  @default(now())\n  endTime    DateTime?\n  status     String    @default(\"ok\") // ok | error\n  attributes String? // JSON\n  events     String? // JSON\n\n  @@index([traceId])\n  @@index([taskId])\n}\n\nmodel ProviderConfig {\n  id           String   @id @default(uuid())\n  name         String   @unique\n  kind         String\n  baseUrl      String?\n  apiKey       String?\n  defaultModel String\n  capabilities String // JSON\n  enabled      Boolean  @default(true)\n  createdAt    DateTime @default(now())\n}\n\nmodel SkillArtifact {\n  id            String   @id @default(uuid())\n  name          String   @unique\n  sourcePath    String\n  generatedPath String\n  manifest      String // JSON\n  registeredAt  DateTime @default(now())\n}\n\nmodel PromptVersion {\n  id              String   @id @default(uuid())\n  name            String   @unique\n  sourcePath      String\n  systemPrompt    String\n  textToolsPrompt String\n  hash            String\n  metadata        String? // JSON\n  createdAt       DateTime @default(now())\n}\n",
  "inlineSchemaHash": "706f1d527473edc6491261477cc3abdf51083dd7c101404982e2c275b2ca4b29",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"Project\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"path\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"repoUrl\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"env\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"tasks\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"ProjectToTask\"}],\"dbName\":null},\"Task\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"projectId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"project\",\"kind\":\"object\",\"type\":\"Project\",\"relationName\":\"ProjectToTask\"},{\"name\":\"title\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"complexity\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"tags\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"provider\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"model\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"result\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"error\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"steps\",\"kind\":\"object\",\"type\":\"TaskStep\",\"relationName\":\"TaskToTaskStep\"},{\"name\":\"traces\",\"kind\":\"object\",\"type\":\"TaskTrace\",\"relationName\":\"TaskToTaskTrace\"},{\"name\":\"diffs\",\"kind\":\"object\",\"type\":\"TaskDiff\",\"relationName\":\"TaskToTaskDiff\"},{\"name\":\"agentRuns\",\"kind\":\"object\",\"type\":\"AgentRun\",\"relationName\":\"AgentRunToTask\"},{\"name\":\"traceSpans\",\"kind\":\"object\",\"type\":\"TraceSpan\",\"relationName\":\"TaskToTraceSpan\"}],\"dbName\":null},\"TaskStep\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTaskStep\"},{\"name\":\"idx\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"input\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"output\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"error\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"TaskTrace\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTaskTrace\"},{\"name\":\"stepId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"role\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"content\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"toolCalls\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"TaskDiff\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTaskDiff\"},{\"name\":\"branch\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"commitSha\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"patch\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"AgentRun\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"AgentRunToTask\"},{\"name\":\"branch\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"baseCommit\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"resultStatus\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"validationSummary\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"publishedVersion\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"promptTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"completionTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"totalTokens\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"TraceSpan\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"traceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"spanId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"parentId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"taskId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"task\",\"kind\":\"object\",\"type\":\"Task\",\"relationName\":\"TaskToTraceSpan\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"startTime\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"endTime\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"attributes\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"events\",\"kind\":\"scalar\",\"type\":\"String\"}],\"dbName\":null},\"ProviderConfig\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"kind\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"baseUrl\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"apiKey\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"defaultModel\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"capabilities\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"enabled\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"SkillArtifact\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sourcePath\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"generatedPath\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"manifest\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"registeredAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"PromptVersion\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sourcePath\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"systemPrompt\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"textToolsPrompt\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"hash\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"metadata\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null}},\"enums\":{},\"types\":{}}")
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

