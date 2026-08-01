import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';

const execFileAsync = promisify(execFile);

const SERVICE_NAME = 'omega_harness';

const DEFAULT_CLIENT_INFO = {
  title: 'Omega Harness',
  name: 'Omega',
  version: '0.1.0',
};

const DEFAULT_CAPABILITIES = {
  experimentalApi: false,
  requestAttestation: false,
  optOutNotificationMethods: [
    'item/agentMessage/delta',
    'item/reasoning/summaryTextDelta',
    'item/reasoning/summaryPartAdded',
    'item/reasoning/textDelta',
  ],
};

const TASK_THREAD_PREFIX = 'Omega Task';
const INFERRED_COMPLETION_DELAY_MS = 250;

export class CodexUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'CodexUnavailableError';
  }
}

export interface CodexClientInfo {
  title: string;
  name: string;
  version: string;
}

export interface CodexInitializeCapabilities {
  experimentalApi: boolean;
  requestAttestation: boolean;
  optOutNotificationMethods: string[];
}

export interface CodexUserInput {
  type: 'text';
  text: string;
  text_elements: [];
}

export interface CodexThread {
  id: string;
}

export interface CodexTurn {
  id: string;
  status: string;
}

export interface CodexThreadItem {
  id: string;
  type: string;
  status?: string;
  phase?: string;
  text?: string;
  command?: string;
  exitCode?: number;
  changes?: { path?: string }[];
  summary?: unknown;
  tool?: string;
  server?: string;
  query?: string;
  receiverThreadIds?: string[];
}

export interface CodexTurnResult {
  status: 'completed' | 'failed' | 'interrupted' | 'timed-out';
  threadId: string;
  turnId: string | null;
  finalMessage: string;
  reasoningSummary: string[];
  turn: CodexTurn | null;
  error: unknown;
  stderr: string;
  fileChanges: CodexThreadItem[];
  touchedFiles: string[];
  commandExecutions: CodexThreadItem[];
  timedOut: boolean;
}

export type CodexProgressReporter = (message: string, phase?: string | null) => void;

export interface CodexRunOptions {
  model?: string | null;
  effort?: string | null;
  threadName?: string;
  timeoutMs: number;
  onProgress?: CodexProgressReporter;
}

interface AppServerNotification {
  method: string;
  params: {
    threadId?: string | null;
    turnId?: string;
    turn?: CodexTurn;
    thread?: {
      id: string;
      name?: string | null;
      agentNickname?: string | null;
      agentRole?: string | null;
    };
    threadName?: string | null;
    item?: CodexThreadItem;
    error?: { message: string };
  };
}

interface AppServerRequestMap {
  initialize: { params: { clientInfo: CodexClientInfo; capabilities: CodexInitializeCapabilities }; result: { ok?: boolean } };
  'thread/start': { params: { cwd: string; model: string | null; approvalPolicy: string; sandbox: string; serviceName: string; ephemeral: boolean }; result: { thread: CodexThread } };
  'thread/name/set': { params: { threadId: string; name: string }; result: Record<string, never> };
  'turn/start': { params: { threadId: string; input: CodexUserInput[]; model: string | null; effort: string | null; outputSchema: unknown }; result: { turn?: CodexTurn } };
  'turn/interrupt': { params: { threadId: string; turnId: string }; result: Record<string, never> };
}

type AppServerMethod = keyof AppServerRequestMap;

interface JsonRpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ProtocolError extends Error {
  rpcCode?: number;
  data?: unknown;
}

interface TurnCaptureState {
  threadId: string;
  threadIds: Set<string>;
  threadTurnIds: Map<string, string>;
  threadLabels: Map<string, string>;
  turnId: string | null;
  bufferedNotifications: AppServerNotification[];
  completion: Promise<TurnCaptureState>;
  resolveCompletion: (state: TurnCaptureState) => void;
  finalTurn: CodexTurn | null;
  completed: boolean;
  finalAnswerSeen: boolean;
  pendingCollaborations: Set<string>;
  activeSubagentTurns: Set<string>;
  completionTimer: NodeJS.Timeout | null;
  lastAgentMessage: string;
  reasoningSummary: string[];
  error: unknown;
  messages: { lifecycle: string; phase: string | null; text: string }[];
  fileChanges: CodexThreadItem[];
  commandExecutions: CodexThreadItem[];
  onProgress: CodexProgressReporter | null;
  timedOut: boolean;
}

export async function getCodexAvailability(): Promise<{ available: boolean; detail: string }> {
  try {
    await execFileAsync('codex', ['--version'], { timeout: 10_000 });
  } catch (err) {
    return { available: false, detail: `codex CLI not found: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    await execFileAsync('codex', ['app-server', '--help'], { timeout: 10_000 });
  } catch (err) {
    return { available: false, detail: `codex app-server unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { available: true, detail: 'codex app-server available' };
}

class CodexAppServerClient {
  readonly transport = 'direct';
  stderr = '';

  private readonly cwd: string;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly exitPromise: Promise<void>;
  private proc: ChildProcess | null = null;
  private readline: readline.Interface | null = null;
  private nextId = 1;
  private lineBuffer = '';
  notificationHandler: ((message: AppServerNotification) => void) | null = null;
  private closed = false;
  private exitResolved = false;
  private resolveExit!: () => void;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  setNotificationHandler(handler: ((message: AppServerNotification) => void) | null): void {
    this.notificationHandler = handler;
  }

  async initialize(): Promise<void> {
    const child = spawn('codex', ['app-server'], {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });

    child.on('error', (error) => {
      this.handleExit(error);
    });

    child.on('exit', (code, signal) => {
      const stderr = this.stderr.trim();
      const detail =
        code === 0
          ? null
          : new Error(
              `codex app-server exited unexpectedly (${signal ? `signal ${signal}` : `exit ${String(code ?? 'unknown')}`}).${stderr ? `\n${stderr}` : ''}`,
            );
      this.handleExit(detail);
    });

    this.readline = readline.createInterface({ input: child.stdout });
    this.readline.on('line', (line) => {
      this.handleLine(line);
    });

    await this.request('initialize', {
      clientInfo: DEFAULT_CLIENT_INFO,
      capabilities: DEFAULT_CAPABILITIES,
    });
    this.notify('initialized', {});
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;

    this.readline?.close();

    if (this.proc && !this.proc.killed) {
      this.proc.stdin?.end();
      setTimeout(() => {
        if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
          this.proc.kill('SIGTERM');
        }
      }, 50).unref();
    }

    await this.exitPromise;
  }

  request<M extends AppServerMethod>(method: M, params: AppServerRequestMap[M]['params']): Promise<AppServerRequestMap[M]['result']> {
    if (this.closed) {
      throw new Error('codex app-server client is closed.');
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: (value: unknown) => {
          resolve(value as AppServerRequestMap[M]['result']);
        },
        reject,
      });
      this.sendMessage({ id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    if (this.closed) return;
    this.sendMessage({ method, params });
  }

  private sendMessage(message: unknown): void {
    const line = `${JSON.stringify(message)}\n`;
    const stdin = this.proc?.stdin;
    if (!stdin) {
      throw new Error('codex app-server stdin is not available.');
    }
    stdin.write(line);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.handleExit(new Error(`Failed to parse codex app-server JSONL: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    if (message.id !== undefined && message.method) {
      this.sendMessage({
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` },
      });
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);

      if (message.error) {
        const error = new Error(message.error.message ?? `codex app-server ${pending.method} failed.`) as ProtocolError;
        error.rpcCode = message.error.code;
        error.data = message.error;
        pending.reject(error);
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method && this.notificationHandler) {
      this.notificationHandler(message as unknown as AppServerNotification);
    }
  }

  private handleExit(error: Error | null): void {
    if (this.exitResolved) return;

    this.exitResolved = true;

    for (const pending of this.pending.values()) {
      pending.reject(error ?? new Error('codex app-server connection closed.'));
    }
    this.pending.clear();
    this.resolveExit();
  }
}

function shorten(text: string, limit = 72): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function buildTaskThreadName(prompt: string): string {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_THREAD_PREFIX}: ${excerpt}` : TASK_THREAD_PREFIX;
}

function extractThreadId(message: AppServerNotification): string | null {
  return message.params.threadId ?? null;
}

function extractTurnId(message: AppServerNotification): string | null {
  if (message.params.turnId) return message.params.turnId;
  if (message.params.turn?.id) return message.params.turn.id;
  return null;
}

function collectTouchedFiles(fileChanges: CodexThreadItem[]): string[] {
  const paths = new Set<string>();
  for (const fileChange of fileChanges) {
    for (const change of fileChange.changes ?? []) {
      if (change.path) paths.add(change.path);
    }
  }
  return [...paths];
}

function normalizeReasoningText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractReasoningSections(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    const normalized = normalizeReasoningText(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractReasoningSections(entry));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return extractReasoningSections(record.text);
    if ('summary' in record) return extractReasoningSections(record.summary);
    if ('content' in record) return extractReasoningSections(record.content);
    if ('parts' in record) return extractReasoningSections(record.parts);
  }

  return [];
}

function mergeReasoningSections(existingSections: string[], nextSections: string[]): string[] {
  const merged: string[] = [];
  for (const section of [...existingSections, ...nextSections]) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) continue;
    merged.push(normalized);
  }
  return merged;
}

function looksLikeVerificationCommand(command: string): boolean {
  return /\b(test|tests|lint|build|typecheck|type-check|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|mvn test|gradle test|tsc|eslint|ruff)\b/i.test(
    command,
  );
}

function emitProgress(onProgress: CodexProgressReporter | null, message: string, phase: string | null = null): void {
  if (!onProgress || !message) return;
  onProgress(message, phase);
}

function labelForThread(state: TurnCaptureState, threadId: string): string | null {
  if (!threadId || threadId === state.threadId) return null;
  return state.threadLabels.get(threadId) ?? threadId;
}

function registerThread(
  state: TurnCaptureState,
  threadId: string | null | undefined,
  options: { threadName?: string | null; name?: string | null; agentNickname?: string | null; agentRole?: string | null } = {},
): void {
  if (!threadId) return;

  state.threadIds.add(threadId);
  const label =
    options.threadName ??
    options.name ??
    options.agentNickname ??
    options.agentRole ??
    state.threadLabels.get(threadId) ??
    null;
  if (label) {
    state.threadLabels.set(threadId, label);
  }
}

function describeStartedItem(state: TurnCaptureState, item: CodexThreadItem): { message: string; phase: string } | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        message: `Running command: ${shorten(item.command ?? '', 96)}`,
        phase: looksLikeVerificationCommand(item.command ?? '') ? 'verifying' : 'running',
      };
    case 'fileChange':
      return { message: `Applying ${String(item.changes?.length ?? 0)} file change(s).`, phase: 'editing' };
    case 'mcpToolCall':
      return { message: `Calling ${item.server ?? ''}/${item.tool ?? ''}.`, phase: 'investigating' };
    case 'dynamicToolCall':
      return { message: `Running tool: ${item.tool ?? ''}.`, phase: 'investigating' };
    case 'collabAgentToolCall': {
      const subagents = (item.receiverThreadIds ?? []).map((threadId) => labelForThread(state, threadId) ?? threadId);
      const summary =
        subagents.length > 0
          ? `Starting subagent ${subagents.join(', ')} via collaboration tool: ${item.tool ?? ''}.`
          : `Starting collaboration tool: ${item.tool ?? ''}.`;
      return { message: summary, phase: 'investigating' };
    }
    case 'webSearch':
      return { message: `Searching: ${shorten(item.query ?? '', 96)}`, phase: 'investigating' };
    default:
      return null;
  }
}

function describeCompletedItem(state: TurnCaptureState, item: CodexThreadItem): { message: string; phase: string } | null {
  switch (item.type) {
    case 'commandExecution': {
      const exitCode = item.exitCode ?? '?';
      const statusLabel = item.status === 'completed' ? 'completed' : (item.status ?? 'completed');
      return {
        message: `Command ${statusLabel}: ${shorten(item.command ?? '', 96)} (exit ${String(exitCode)})`,
        phase: looksLikeVerificationCommand(item.command ?? '') ? 'verifying' : 'running',
      };
    }
    case 'fileChange':
      return { message: `File changes ${item.status ?? 'completed'}.`, phase: 'editing' };
    case 'mcpToolCall':
      return { message: `Tool ${item.server ?? ''}/${item.tool ?? ''} ${item.status ?? 'completed'}.`, phase: 'investigating' };
    case 'dynamicToolCall':
      return { message: `Tool ${item.tool ?? ''} ${item.status ?? 'completed'}.`, phase: 'investigating' };
    case 'collabAgentToolCall': {
      const subagents = (item.receiverThreadIds ?? []).map((threadId) => labelForThread(state, threadId) ?? threadId);
      const summary =
        subagents.length > 0
          ? `Subagent ${subagents.join(', ')} ${item.status ?? 'completed'}.`
          : `Collaboration tool ${item.tool ?? ''} ${item.status ?? 'completed'}.`;
      return { message: summary, phase: 'investigating' };
    }
    default:
      return null;
  }
}

function createTurnCaptureState(threadId: string, onProgress: CodexProgressReporter | null): TurnCaptureState {
  let resolveCompletion!: (state: TurnCaptureState) => void;
  const completion = new Promise<TurnCaptureState>((resolve) => {
    resolveCompletion = resolve;
  });

  return {
    threadId,
    threadIds: new Set([threadId]),
    threadTurnIds: new Map(),
    threadLabels: new Map(),
    turnId: null,
    bufferedNotifications: [],
    completion,
    resolveCompletion,
    finalTurn: null,
    completed: false,
    finalAnswerSeen: false,
    pendingCollaborations: new Set(),
    activeSubagentTurns: new Set(),
    completionTimer: null,
    lastAgentMessage: '',
    reasoningSummary: [],
    error: null,
    messages: [],
    fileChanges: [],
    commandExecutions: [],
    onProgress,
    timedOut: false,
  };
}

function clearCompletionTimer(state: TurnCaptureState): void {
  if (state.completionTimer) {
    clearTimeout(state.completionTimer);
    state.completionTimer = null;
  }
}

function completeTurn(state: TurnCaptureState, turn: CodexTurn | null = null): void {
  if (state.completed) return;

  clearCompletionTimer(state);
  state.completed = true;

  if (turn) {
    state.finalTurn = turn;
    state.turnId ??= turn.id;
  } else {
    state.finalTurn ??= {
      id: state.turnId ?? 'inferred-turn',
      status: state.timedOut ? 'interrupted' : 'completed',
    };
  }

  if (state.timedOut) {
    emitProgress(state.onProgress, 'Turn timed out; interrupting Codex.', 'failed');
  }

  state.resolveCompletion(state);
}

function scheduleInferredCompletion(state: TurnCaptureState): void {
  if (state.completed || state.finalTurn || !state.finalAnswerSeen) return;

  if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) return;

  clearCompletionTimer(state);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (state.completed || state.finalTurn || !state.finalAnswerSeen) return;
    if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) return;
    completeTurn(state);
  }, INFERRED_COMPLETION_DELAY_MS);
  state.completionTimer.unref();
}

function belongsToTurn(state: TurnCaptureState, message: AppServerNotification): boolean {
  const messageThreadId = extractThreadId(message);
  if (!messageThreadId || !state.threadIds.has(messageThreadId)) return false;
  const trackedTurnId = state.threadTurnIds.get(messageThreadId) ?? null;
  const messageTurnId = extractTurnId(message);
  return trackedTurnId === null || messageTurnId === null || messageTurnId === trackedTurnId;
}

function recordItem(state: TurnCaptureState, item: CodexThreadItem, lifecycle: string, threadId: string | null = null): void {
  if (item.type === 'collabAgentToolCall') {
    if (!threadId || threadId === state.threadId) {
      if (lifecycle === 'started' || item.status === 'inProgress') {
        state.pendingCollaborations.add(item.id);
      } else if (lifecycle === 'completed') {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
    }
    for (const receiverThreadId of item.receiverThreadIds ?? []) {
      registerThread(state, receiverThreadId);
    }
  }

  if (item.type === 'agentMessage') {
    state.messages.push({
      lifecycle,
      phase: item.phase ?? null,
      text: item.text ?? '',
    });
    if (item.text) {
      if (!threadId || threadId === state.threadId) {
        state.lastAgentMessage = item.text;
        if (lifecycle === 'completed' && item.phase === 'final_answer') {
          state.finalAnswerSeen = true;
          scheduleInferredCompletion(state);
        }
      }
    }
    return;
  }

  if (item.type === 'reasoning' && lifecycle === 'completed') {
    const nextSections = extractReasoningSections(item.summary);
    state.reasoningSummary = mergeReasoningSections(state.reasoningSummary, nextSections);
    return;
  }

  if (item.type === 'fileChange' && lifecycle === 'completed') {
    state.fileChanges.push(item);
    return;
  }

  if (item.type === 'commandExecution' && lifecycle === 'completed') {
    state.commandExecutions.push(item);
  }
}

function applyTurnNotification(state: TurnCaptureState, message: AppServerNotification): void {
  switch (message.method) {
    case 'thread/started':
      registerThread(state, message.params.thread?.id, {
        threadName: message.params.thread?.name,
        name: message.params.thread?.name,
        agentNickname: message.params.thread?.agentNickname,
        agentRole: message.params.thread?.agentRole,
      });
      break;
    case 'thread/name/updated':
      registerThread(state, message.params.threadId, {
        threadName: message.params.threadName ?? null,
      });
      break;
    case 'turn/started':
      registerThread(state, message.params.threadId);
      if (message.params.turn?.id) {
        state.threadTurnIds.set(message.params.threadId ?? state.threadId, message.params.turn.id);
      }
      if ((message.params.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.add(message.params.threadId ?? state.threadId);
      }
      emitProgress(
        state.onProgress,
        `Turn started (${message.params.turn?.id ?? 'unknown'}).`,
        'starting',
      );
      break;
    case 'item/started': {
      if (!message.params.item) return;
      const update = describeStartedItem(state, message.params.item);
      emitProgress(state.onProgress, update?.message ?? '', update?.phase ?? null);
      break;
    }
    case 'item/completed': {
      if (!message.params.item) return;
      recordItem(state, message.params.item, 'completed', message.params.threadId ?? null);
      const update = describeCompletedItem(state, message.params.item);
      emitProgress(state.onProgress, update?.message ?? '', update?.phase ?? null);
      break;
    }
    case 'error':
      state.error = message.params.error;
      emitProgress(state.onProgress, `Codex error: ${message.params.error?.message ?? 'unknown error'}`, 'failed');
      break;
    case 'turn/completed':
      if ((message.params.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.delete(message.params.threadId ?? state.threadId);
        scheduleInferredCompletion(state);
        break;
      }
      emitProgress(
        state.onProgress,
        `Turn ${message.params.turn?.status === 'completed' ? 'completed' : (message.params.turn?.status ?? 'completed')}.`,
        'finalizing',
      );
      if (message.params.turn) completeTurn(state, message.params.turn);
      break;
    default:
      break;
  }
}

function cleanCodexStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('WARNING: proceeding, even though we could not update PATH:'))
    .join('\n');
}

function buildResultStatus(state: TurnCaptureState): CodexTurnResult['status'] {
  const status = state.finalTurn?.status;
  if (status === 'completed') return 'completed';
  if (status === 'interrupted') return 'interrupted';
  return 'failed';
}

async function captureTurn(
  client: CodexAppServerClient,
  threadId: string,
  startRequest: () => Promise<{ turn?: CodexTurn }>,
  onProgress: CodexProgressReporter | null,
  timeoutMs: number,
): Promise<TurnCaptureState> {
  const state = createTurnCaptureState(threadId, onProgress);
  const previousHandler = client.notificationHandler;

  client.setNotificationHandler((message) => {
    if (!state.turnId) {
      state.bufferedNotifications.push(message);
      return;
    }

    if (message.method === 'thread/started' || message.method === 'thread/name/updated') {
      applyTurnNotification(state, message);
      return;
    }

    if (!belongsToTurn(state, message)) {
      previousHandler?.(message);
      return;
    }

    applyTurnNotification(state, message);
  });

  let timeoutTimer: NodeJS.Timeout | null = null;
  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      if (state.completed) return;
      state.timedOut = true;
      if (state.turnId) {
        void client.request('turn/interrupt', { threadId, turnId: state.turnId }).catch(() => undefined);
      }
      completeTurn(state);
    }, timeoutMs);
  }

  try {
    const response = await startRequest();
    state.turnId = response.turn?.id ?? null;
    if (state.turnId) {
      state.threadTurnIds.set(state.threadId, state.turnId);
    }
    for (const message of state.bufferedNotifications) {
      if (belongsToTurn(state, message)) {
        applyTurnNotification(state, message);
      } else {
        previousHandler?.(message);
      }
    }
    state.bufferedNotifications.length = 0;

    if (response.turn?.status && response.turn.status !== 'inProgress') {
      completeTurn(state, response.turn);
    }

    return await state.completion;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    clearCompletionTimer(state);
    client.setNotificationHandler(previousHandler ?? null);
  }
}

export async function runCodexTurn(cwd: string, prompt: string, options: CodexRunOptions): Promise<CodexTurnResult> {
  const availability = await getCodexAvailability();
  if (!availability.available) {
    throw new CodexUnavailableError(availability.detail);
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('A prompt is required for this Codex run.');
  }

  const client = new CodexAppServerClient(cwd);
  await client.initialize();
  try {
    const threadResponse = await client.request('thread/start', {
      cwd,
      model: options.model ?? null,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      serviceName: SERVICE_NAME,
      ephemeral: true,
    });
    const threadId = threadResponse.thread.id;

    const threadName = options.threadName ?? buildTaskThreadName(trimmedPrompt);
    try {
      await client.request('thread/name/set', { threadId, name: threadName });
    } catch {
      /* ignored */
    }
    const state = await captureTurn(
      client,
      threadId,
      () =>
        client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: trimmedPrompt, text_elements: [] }],
          model: options.model ?? null,
          effort: options.effort ?? null,
          outputSchema: null,
        }),
      options.onProgress ?? null,
      options.timeoutMs,
    );

    return {
      status: state.timedOut ? 'timed-out' : buildResultStatus(state),
      threadId,
      turnId: state.turnId,
      finalMessage: state.lastAgentMessage,
      reasoningSummary: state.reasoningSummary,
      turn: state.finalTurn,
      error: state.error,
      stderr: cleanCodexStderr(client.stderr),
      fileChanges: state.fileChanges,
      touchedFiles: collectTouchedFiles(state.fileChanges),
      commandExecutions: state.commandExecutions,
      timedOut: state.timedOut,
    };
  } finally {
    await client.close();
  }
}
