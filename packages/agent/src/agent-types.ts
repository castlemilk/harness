import type { PrismaClient } from '@omega/db';
import type { Provider, Task, UsageInfo } from '@omega/core';
import type { IntelligentRouter } from '@omega/router';
import type { Tracer, Span } from './tracer.js';
import type { ValidationSummary } from './validator.js';
import type { PublishResult } from './publisher.js';
import type { PromptFormat } from './prompt-adapters.js';

export interface AgentResult {
  task: Task;
  agentRunId: string;
  validation?: ValidationSummary;
  publish?: PublishResult;
}

export interface AgentContext {
  prisma: PrismaClient;
  task: Task;
  projectPath: string;
  projectName: string;
  provider: Provider;
  model: string;
  branch: string;
  baseCommit: string;
  agentRunId: string;
  autoPublish: boolean;
  maxSteps: number;
  explorationBudget: { beforeFirstEdit: number; betweenEdits: number };
  modifiedFiles: Set<string>;
  consecutiveThinks: number;
  explorationCount: number;
  editCount: number;
  explorationAtLastEdit: number;
  explorationSinceLastEdit: number;
  hasRunTestCommand: boolean;
  projectHasTests: boolean;
  tracer: Tracer;
  rootSpan: Span;
  systemPrompt: string;
  textToolsSystemPrompt: string;
  promptFormat: PromptFormat;
  promptContext?: string;
  usage: UsageInfo;
  apiSurfaceVerified: boolean;
  tokenBudget?: number;
  repoOverview?: string;
  stuckSolveAttempted?: boolean;
  deadlineMs: number;
  signal?: AbortSignal;
  router?: IntelligentRouter;
}
