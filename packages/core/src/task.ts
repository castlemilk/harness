import type { ModelRef } from './provider.js';

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'failed';
export type Complexity = 'simple' | 'medium' | 'complex';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  complexity: Complexity;
  tags: string[];
  assignedModel?: ModelRef;
  result?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  repoUrl?: string;
  description?: string;
  env?: Record<string, string>;
  createdAt: Date;
}
