export type TaskStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface TaskStep {
  id: string;
  taskId: string;
  idx: number;
  name: string;
  status: TaskStepStatus;
  input?: string;
  output?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type TaskTraceRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TaskTrace {
  id: string;
  taskId: string;
  stepId?: string;
  role: TaskTraceRole;
  content?: string;
  toolCalls?: string;
  createdAt: Date;
}

export interface TaskDiff {
  id: string;
  taskId: string;
  branch: string;
  commitSha?: string;
  patch: string;
  createdAt: Date;
}

export type AgentRunStatus = 'running' | 'done' | 'failed';

export interface AgentRun {
  id: string;
  taskId: string;
  branch: string;
  baseCommit: string;
  resultStatus: AgentRunStatus;
  validationSummary?: string;
  publishedVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentOptions {
  projectPath: string;
  projectName: string;
  autoPublish?: boolean;
  maxSteps?: number;
  baseBranch?: string;
}
