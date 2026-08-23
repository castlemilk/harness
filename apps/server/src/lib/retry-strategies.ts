import type { PrismaClient } from '@omega/db';
import {
  runAgentTask,
  type ExternalCli,
  type ExternalSessionKind,
  type ExternalSessionRef,
} from '@omega/agent';
import { notifyFailure, notifyRetry } from './webhook-alerts.js';
import { envInt, safeJsonParse } from './utils.js';
import { runRoutedExternalAgentTask } from './external-agent-runner.js';

export interface RetryStrategy {
  name: string;
  description: string;
  apply: (ctx: RetryContext) => RetryAttempt | undefined | Promise<RetryAttempt | undefined>;
}

export interface RetryContext {
  task: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    complexity: string;
    tags: string[];
    provider: string | null;
    model: string | null;
    retryCount: number;
    retryHistory: RetryRecord[];
  };
  projectPath: string;
  projectName: string;
  error: string;
  prisma: PrismaClient;
}

export interface RetryAttempt {
  strategy: string;
  provider?: string;
  model?: string;
  effort?: string;
  cli?: ExternalCli;
  tokenBudget?: number;
  classification?: RetryFailureClassification;
  category?: RetryFailureCategory;
  triggerError?: string;
}

export interface RetryRecord {
  strategy: string;
  provider?: string;
  model?: string;
  cli?: ExternalCli;
  error: string;
  timestamp: string;
  classification?: RetryFailureClassification;
  category?: RetryFailureCategory;
  decision?: 'retry' | 'skipped';
  triggerError?: string;
  reason?: string;
}

export type RetryFailureClassification = 'transient' | 'terminal';

export type RetryFailureCategory =
  | 'rate-limit'
  | 'provider-server-error'
  | 'stream-abort'
  | 'timeout'
  | 'validation-failure'
  | 'agent-result'
  | 'authentication'
  | 'configuration'
  | 'cancelled'
  | 'circuit-open'
  | 'unknown';

export interface RetryFailureClassificationResult {
  classification: RetryFailureClassification;
  category: RetryFailureCategory;
  reason: string;
}

/**
 * Decide whether repeating the same work can plausibly succeed. Product/test
 * failures take precedence over incidental infrastructure words in their
 * details (for example, a test itself may have "timed out"). Unknown failures
 * are terminal because automatically doubling spend needs positive evidence.
 */
export function classifyRetryFailure(error: string): RetryFailureClassificationResult {
  const normalized = error.trim().toLowerCase();
  const terminal = (
    category: RetryFailureCategory,
    reason: string,
  ): RetryFailureClassificationResult => ({ classification: 'terminal', category, reason });
  const transient = (
    category: RetryFailureCategory,
    reason: string,
  ): RetryFailureClassificationResult => ({ classification: 'transient', category, reason });

  if (!normalized) return terminal('unknown', 'No failure reason was available to justify a retry.');

  if (
    /(?:validation|finish) (?:failed|rejected|did not pass)/.test(normalized)
    || /(?:tests?|specs?|lint|typecheck|type-check|build|api surface).{0,80}(?:failed|failure|did not pass|rejected)/.test(normalized)
    || /(?:failed|failure|did not pass|rejected).{0,80}(?:tests?|specs?|lint|typecheck|type-check|build|api surface)/.test(normalized)
  ) {
    return terminal('validation-failure', 'The produced work failed validation; replaying the same attempt is not transient recovery.');
  }
  if (
    /produced no (?:changes|patch)/.test(normalized)
    || /(?:wrong|invalid|empty) patch/.test(normalized)
    || /(?:step|iteration|tool-error)s? (?:cap|limit)/.test(normalized)
    || /ran out of (?:iterations|steps)|maximum (?:iteration|step)s? reached/.test(normalized)
    || normalized.includes('stopped without calling finish')
    || normalized.includes('token budget')
    || normalized.includes('forced-edit refusal')
    // A wall-clock deadline is a POLICY limit we imposed, not an
    // infrastructure interruption. Retrying re-spends the same wall clock to
    // hit the same wall: the 80-minute task that motivated this work would
    // otherwise auto-retry three more times.
    || normalized.includes('wall-clock deadline')
  ) {
    return terminal('agent-result', 'The agent reached a terminal result or policy limit rather than an infrastructure interruption.');
  }
  // Ordinary test/assertion output is TERMINAL and must be matched before the
  // transient branches: a suite asserting on HTTP status codes puts literal
  // "500"/"429" into the failure text, and this repo's whole benchmark
  // workload is test-fixing. Misreading those as provider errors is how a
  // sweep silently multiplies its cost on failures that can never pass.
  if (
    /assertionerror|assertion failed/.test(normalized)
    // An assert/expect call in the text means the number beside it is a
    // value under test, not a provider status.
    || /\bassert(?:\.\w+)?\s*\(|\bexpect\s*\(/.test(normalized)
    || /expected .{0,40}(?:but|got|received)/.test(normalized)
    || /does not apply|corrupt patch|patch (?:does not|failed to) apply/.test(normalized)
    || /\bts\d{4}\b|elifecycle/.test(normalized)
  ) {
    return terminal('validation-failure', 'The failure is a test, assertion or patch-application result, not an infrastructure interruption.');
  }
  if (/circuit.{0,40}open|open circuit/.test(normalized)) {
    return terminal('circuit-open', 'The CLI circuit is already open; an immediate automatic retry would be skipped again.');
  }
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|invalid api key|authentication|credential/.test(normalized)) {
    return terminal('authentication', 'Authentication or credentials require configuration changes before retrying.');
  }
  if (/not found in path|unsupported external cli|invalid external cli|cannot resume|configuration error/.test(normalized)) {
    return terminal('configuration', 'The CLI or session configuration must be corrected before retrying.');
  }
  if (/\b(?:cancelled|canceled|external abort|aborted by user)\b/.test(normalized)) {
    return terminal('cancelled', 'The run was deliberately cancelled.');
  }

  if (
    /rate.?limit|too many requests|quota temporarily/.test(normalized)
    // A bare "429" is far more often a count in test output than a status.
    || /(?:http|status(?:\s+code)?|response|error)\D{0,10}429\b/.test(normalized)
  ) {
    return transient('rate-limit', 'The provider rate-limited the request.');
  }
  if (
    /stream.{0,40}(?:abort|interrupt|reset|closed|disconnect)/.test(normalized)
    || /aborterror|operation was aborted|econnaborted|econnreset|econnrefused|eai_again|enotfound|socket hang up|connection (?:reset|closed)|fetch failed/.test(normalized)
  ) {
    return transient('stream-abort', 'The provider stream or network connection was interrupted.');
  }
  if (
    /service unavailable|bad gateway|internal server error|provider server error/.test(normalized)
    // Anchored to HTTP context: a bare 3-digit number is usually a line
    // number, a file count or an asserted status, not a provider fault.
    || /(?:http|status(?:\s+code)?|response|error)\D{0,10}5\d{2}\b/.test(normalized)
  ) {
    return transient('provider-server-error', 'The provider reported a temporary server-side failure.');
  }
  if (/\b(?:408|504)\b|etimedout|timed? out|timeout/.test(normalized)) {
    return transient('timeout', 'The provider or transport timed out.');
  }

  return terminal('unknown', 'The failure has no recognized transient infrastructure signal.');
}

const EXTERNAL_CLIS = new Set<ExternalCli>([
  'codex',
  'claude-code',
  'agy',
  'opencode',
  'cursor-cli',
  'aider',
  'gemini-cli',
]);

function externalCliFromTags(tags: string[]): ExternalCli | undefined {
  const value = tags.find((tag) => tag.startsWith('external:'))?.slice('external:'.length);
  return value && EXTERNAL_CLIS.has(value as ExternalCli) ? value as ExternalCli : undefined;
}

function resumableSessionKindForCli(cli: ExternalCli): ExternalSessionKind | undefined {
  // Only these installed drivers expose a stable, explicit resume identity.
  // The other CLIs intentionally retry fresh rather than pretending their
  // conversational context can be reconstructed from task metadata.
  if (cli === 'codex') return 'codex-thread';
  if (cli === 'opencode') return 'opencode-session';
  return undefined;
}

const MAX_RETRIES = envInt('OMEGA_MAX_RETRIES', 3);

async function nextInternalTier(
  prisma: PrismaClient,
  ctx: RetryContext,
): Promise<{ provider: string; model: string } | null> {
  if (!ctx.task.provider || !ctx.task.model) return null;
  const provider = await prisma.providerConfig.findFirst({
    where: { kind: ctx.task.provider },
  });
  if (!provider) return null;
  const caps = provider.capabilities as { modelTiers?: Record<string, string> } | null;
  const ladder = caps?.modelTiers;
  if (ladder?.[ctx.task.model]) {
    const nextModel = ladder[ctx.task.model];
    if (nextModel) return { provider: ctx.task.provider, model: nextModel };
  }
  return null;
}

async function pickDifferentProvider(
  prisma: PrismaClient,
  current: string | null,
): Promise<{ provider: string; model: string } | null> {
  const candidates = await prisma.providerConfig.findMany({
    where: {
      enabled: true,
      ...(current ? { kind: { not: current } } : {}),
    },
    take: 5,
  });
  if (candidates.length === 0) return null;
  const pick = candidates[0];
  return { provider: pick.kind, model: pick.defaultModel };
}

const RETRY_STRATEGIES: RetryStrategy[] = [
  {
    name: 'clean-retry',
    description: 'Same config, clean retry (transient error recovery)',
    apply: (ctx) => {
      if (ctx.task.retryCount > 0) return undefined;
      const cli = externalCliFromTags(ctx.task.tags);
      return {
        strategy: 'clean-retry',
        provider: ctx.task.provider ?? undefined,
        model: ctx.task.model ?? undefined,
        cli,
      };
    },
  },
  {
    name: 'tier-escalation',
    description: 'Escalate to a higher model tier (internal tasks only)',
    apply: async (ctx) => {
      if (ctx.task.retryCount > 1) return undefined;
      const tags = ctx.task.tags;
      if (tags.some((t) => t.startsWith('external:'))) return undefined;
      if (tags.includes('orchestrate')) return undefined;
      const next = await nextInternalTier(ctx.prisma, ctx);
      if (!next) return undefined;
      return { strategy: 'tier-escalation', provider: next.provider, model: next.model };
    },
  },
  {
    name: 'different-provider',
    description: 'Swap to a different provider (internal tasks only)',
    apply: async (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      if (tags.some((t) => t.startsWith('external:'))) return undefined;
      if (tags.includes('orchestrate')) return undefined;
      const next = await pickDifferentProvider(ctx.prisma, ctx.task.provider);
      if (!next) return undefined;
      return { strategy: 'different-provider', provider: next.provider, model: next.model };
    },
  },
  {
    name: 'orchestrated-fallback',
    description: 'Fall back to orchestrated multi-agent mode',
    apply: (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      if (tags.includes('orchestrate')) return undefined;
      if (tags.some((t) => t.startsWith('external:'))) return undefined;
      return {
        strategy: 'orchestrated-fallback',
      };
    },
  },
  {
    name: 'different-cli',
    description: 'Try a different external CLI',
    apply: (ctx) => {
      if (ctx.task.retryCount > 2) return undefined;
      const tags = ctx.task.tags;
      const externalTag = tags.find((t) => t.startsWith('external:'));
      if (!externalTag) return undefined;
      const currentCli = externalTag.split(':')[1];
      const cliRotation: Record<string, string[]> = {
        'agy': ['claude-code', 'opencode'],
        'claude-code': ['agy', 'opencode'],
        'opencode': ['agy', 'claude-code'],
        'codex': ['agy', 'claude-code'],
      };
      const alternatives = cliRotation[currentCli] ?? ['agy'];
      const nextCli = alternatives[ctx.task.retryCount % alternatives.length];
      return {
        strategy: 'different-cli',
        cli: nextCli as ExternalCli,
      };
    },
  },
];

export const STRATEGIES_BY_NAME: Record<string, RetryStrategy> = Object.fromEntries(
  RETRY_STRATEGIES.map((s) => [s.name, s]),
);

export async function getNextStrategy(ctx: RetryContext): Promise<RetryAttempt | undefined> {
  if (ctx.task.retryCount >= MAX_RETRIES) return undefined;
  for (const strategy of RETRY_STRATEGIES) {
    const attempt = await strategy.apply(ctx);
    if (attempt) return attempt;
  }
  return undefined;
}

export async function appendRetryRecord(
  prisma: PrismaClient,
  taskId: string,
  record: RetryRecord,
): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { retryHistory: true } });
  if (!task) return;
  const existing = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
  existing.push(record);
  await prisma.task.update({
    where: { id: taskId },
    data: { retryHistory: JSON.stringify(existing) },
  });
}

async function resumableSessionForRetry(
  prisma: PrismaClient,
  taskId: string,
  attempt: RetryAttempt,
): Promise<ExternalSessionRef | undefined> {
  if (!attempt.cli || attempt.strategy !== 'clean-retry') return undefined;
  const sessionKind = resumableSessionKindForCli(attempt.cli);
  if (!sessionKind) return undefined;

  try {
    const priorRun = await prisma.agentRun.findFirst({
      where: {
        taskId,
        sessionKind,
        sessionId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { sessionId: true },
    });
    if (!priorRun?.sessionId) return undefined;
    return { sessionId: priorRun.sessionId, sessionKind };
  } catch (err) {
    // Session lookup is continuity metadata, not permission to fail a retry.
    console.warn('Could not load external retry session; starting fresh', {
      taskId,
      cli: attempt.cli,
      error: String(err),
    });
    return undefined;
  }
}

export async function executeRetry(
  prisma: PrismaClient,
  taskId: string,
  attempt: RetryAttempt,
  options: { projectPath: string; projectName: string; autoPublish: boolean },
): Promise<void> {
  // 1. Pre-run task row update: persist the active provider/model on the task row.
  //    This is the path that executor.ts / orchestrator.ts already honor via
  //    task.assignedModel (a { provider, model } record).
  const taskUpdate: Record<string, unknown> = {};
  if (attempt.provider) taskUpdate.provider = attempt.provider;
  else if (attempt.cli) taskUpdate.provider = `external:${attempt.cli}`;
  if (attempt.model) taskUpdate.model = attempt.model;
  if (Object.keys(taskUpdate).length > 0) {
    await prisma.task.update({ where: { id: taskId }, data: taskUpdate });
  }

  // 2. Pre-run audit: append to retryHistory BEFORE the run so successful retries leave a record.
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  const snapshotRetryCount = task?.retryCount ?? 0;
  if (task) {
    const existing = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
    const record: RetryRecord = {
      strategy: attempt.strategy,
      provider: attempt.provider,
      model: attempt.model,
      cli: attempt.cli,
      error: '', // populated with the retry outcome below
      timestamp: new Date().toISOString(),
      classification: attempt.classification,
      category: attempt.category,
      decision: 'retry',
      triggerError: attempt.triggerError,
      reason: attempt.classification
        ? `Automatic retry approved for ${attempt.classification}/${attempt.category ?? 'unknown'}.`
        : undefined,
    };
    existing.push(record);
    await prisma.task.update({
      where: { id: taskId },
      data: { retryHistory: JSON.stringify(existing) },
    });
  }

  // Webhook: notify that a retry is starting (NOT after, so the user is informed of the attempt).
  void notifyRetry(prisma, {
    taskId,
    title: task?.title ?? '',
    provider: attempt.provider ?? attempt.cli ?? null,
    model: attempt.model ?? null,
    strategy: attempt.strategy,
    retryCount: (task?.retryCount ?? 0) + 1,
    previousError: task?.error ?? '',
    tags: ['retry', attempt.strategy],
    timestamp: new Date().toISOString(),
  });

  // 3. Run the retry.
  try {
    if (attempt.cli) {
      const resumeSession = await resumableSessionForRetry(prisma, taskId, attempt);
      await runRoutedExternalAgentTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        cli: attempt.cli,
        model: attempt.model,
        effort: attempt.effort,
        resumeSession,
      });
    } else if (attempt.strategy === 'orchestrated-fallback') {
      const { getRouter } = await import('./intelligent-router.js');
      const router = await getRouter(prisma);
      const { runOrchestratedTask } = await import('@omega/agent');
      await runOrchestratedTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        isolated: true,
        intelligentRouter: router,
      });
    } else {
      const { getRouter } = await import('./intelligent-router.js');
      const router = await getRouter(prisma);
      // internal task — task row already updated with provider/model; the runner honors it.
      await runAgentTask(prisma, taskId, {
        projectPath: options.projectPath,
        projectName: options.projectName,
        autoPublish: options.autoPublish,
        isolated: true,
      }, router);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = message.trim() || `Retry strategy ${attempt.strategy} failed without an error message.`;
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', error: reason, result: reason },
    });
    const provider = attempt.provider ?? attempt.cli ?? undefined;
    void notifyFailure(prisma, {
      taskId,
      title: task?.title ?? '',
      provider,
      model: attempt.model ?? undefined,
      error: reason,
      tags: ['retry', attempt.strategy],
      timestamp: new Date().toISOString(),
    });
  }

  // 4. After the run: keep the existing retryCount + lastRetryAt + retryHistory update behavior.
  const after = await prisma.task.findUnique({ where: { id: taskId } });
  if (!after) return;
  const existing = safeJsonParse<RetryRecord[]>(after.retryHistory, []);
  // Update the latest record with the actual error if any
  const lastRecord = existing.at(-1);
  if (lastRecord?.error === '') {
    lastRecord.error = after.error ?? '';
  }
  const isStillFailed = after.status === 'failed' || after.status === 'in_progress';
  if (isStillFailed) {
    try {
      await prisma.task.update({
        where: { id: taskId, retryCount: snapshotRetryCount },
        data: {
          retryCount: { increment: 1 },
          lastRetryAt: new Date(),
          retryHistory: JSON.stringify(existing),
        },
      });
    } catch (err) {
      // Optimistic-concurrency guard: another concurrent retry already
      // incremented retryCount. Skip the increment but still record the audit
      // trail + lastRetryAt for this attempt.
      const code = (err as { code?: string }).code;
      if (code !== 'P2025') throw err;
      await prisma.task.update({
        where: { id: taskId },
        data: {
          lastRetryAt: new Date(),
          retryHistory: JSON.stringify(existing),
        },
      });
      console.warn('Retry concurrent-update race detected, skipping increment', { taskId, snapshotRetryCount });
    }
  } else {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        lastRetryAt: new Date(),
        retryHistory: JSON.stringify(existing),
      },
    });
  }

  console.log('Retry executed', {
    taskId,
    strategy: attempt.strategy,
    retryCount: after.retryCount + 1,
    error: after.error ?? undefined,
  });
}
