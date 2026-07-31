import type { AgentOptions } from '@omega/core';
import type { IntelligentRouter } from '@omega/router';

export interface OrchestratorOptions extends AgentOptions {
  maxSubtasks?: number;
  maxIterations?: number;
  concurrency?: number;
  maxEscalations?: number;
  intelligentRouter?: IntelligentRouter;
}

export interface OrchestratedSubtask {
  title: string;
  description: string;
  complexity: 'simple' | 'medium' | 'complex';
  tier: 'medium' | 'low';
  dependsOn?: number[];
  affectedFiles?: string[];
}

export interface SubtaskState extends OrchestratedSubtask {
  index: number;
  taskId?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  notes?: string;
}

export interface ReviewResult {
  status: 'done' | 'continue';
  notes?: string;
  nextSubtasks?: OrchestratedSubtask[];
}

export interface OrchestratorResult {
  taskId: string;
  agentRunId: string;
  status: 'done' | 'failed';
  summary: string;
  subtasks: { taskId?: string; title: string; status: string }[];
  iterations: number;
}
