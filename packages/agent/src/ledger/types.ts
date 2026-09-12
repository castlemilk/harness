export interface LedgerProblem {
  id: string;
  statement: string;
  tests?: { input: string; output: string }[];
}

export interface LedgerSpec {
  kind: 'code';
  solverSystem: string;
}

export interface LedgerCallRequest {
  role: string;
  system: string;
  user: string;
  temperature: number;
  maxOutputTokens?: number;
}

export interface LedgerUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LedgerCallResult {
  text: string;
  finishReason?: string;
  usage?: LedgerUsage;
  costUsd?: number;
}

export type LedgerSend = (req: LedgerCallRequest) => Promise<LedgerCallResult>;

export interface LedgerOptions {
  workspaceDir: string;
  maxIters?: number;
  maxTasks?: number;
  maxOutputTokens?: number;
  /** Run one independent worker (raw problem, no plan/notes) before managing. */
  freshPerspective?: boolean;
  now?: () => Date;
}

export interface LedgerCallRecord {
  role: string;
  request: LedgerCallRequest;
  response: string;
  finishReason?: string;
  usage?: LedgerUsage;
  costUsd?: number;
  truncated: boolean;
  startedAt?: number;
  durationMs?: number;
}

export interface LedgerResult {
  solution: string;
  status: 'done' | 'max_iters' | 'no_progress' | 'failed';
  calls: LedgerCallRecord[];
  truncatedCalls: number;
  usage: LedgerUsage;
  ws: string;
}