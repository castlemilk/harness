import type { PrismaClient } from '@omega/db';
import type { AgentOptions, Provider, ProviderConfig, UsageInfo } from '@omega/core';
import { createProvider } from '@omega/providers';
import { pickModelForTier } from '@omega/router';
import { runAgentTask } from './executor.js';
import { validateProject } from './validator.js';
import { generateSkillFromTask, recallRelevantSkills } from './skill-generator.js';
import { Tracer } from './tracer.js';
import { getCurrentBranch, getCurrentCommit, getDiff } from './git.js';
import { logger } from './logger.js';

export interface OrchestratorOptions extends AgentOptions {
  /** Maximum number of subtasks the planner may create up front. Default 5. */
  maxSubtasks?: number;
  /** Maximum plan/review feedback-loop rounds. Default 3. */
  maxIterations?: number;
  /** How many sub-agents may run concurrently. Default 1 (sequential MVP). */
  concurrency?: number;
  /** How many times a failed subtask may be retried on a higher model tier. Default 1. */
  maxEscalations?: number;
}

export interface OrchestratedSubtask {
  title: string;
  description: string;
  complexity: 'simple' | 'medium' | 'complex';
  tier: 'medium' | 'low';
  dependsOn?: number[];
}

interface SubtaskState extends OrchestratedSubtask {
  index: number;
  taskId?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  notes?: string;
}

interface ReviewResult {
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

/**
 * Strip characters that Postgres (UTF8) cannot store (same rules as the
 * executor's sanitizeForDb).
 */
function sanitizeForDb(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code !== 0x00 && !(code >= 0x01 && code <= 0x08) && code !== 0x0b && code !== 0x0c && !(code >= 0x0e && code <= 0x1f);
    })
    .join('');
}

function extractJson(raw: string): unknown {
  const text = raw.trim();
  const candidates = [text];
  const fence = /```(?:json)?\n([\s\S]*?)```/.exec(text);
  if (fence) candidates.push(fence[1]);
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

const COMPLEXITIES = new Set(['simple', 'medium', 'complex']);
const SUBTASK_TIERS = new Set(['medium', 'low']);

function normalizeSubtask(raw: unknown, fallbackTitle: string): OrchestratedSubtask | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackTitle;
  const description = typeof obj.description === 'string' ? obj.description : '';
  const complexity =
    typeof obj.complexity === 'string' && COMPLEXITIES.has(obj.complexity)
      ? (obj.complexity as OrchestratedSubtask['complexity'])
      : 'medium';
  const tier =
    typeof obj.tier === 'string' && SUBTASK_TIERS.has(obj.tier)
      ? (obj.tier as OrchestratedSubtask['tier'])
      : 'medium';
  const dependsOn = Array.isArray(obj.dependsOn)
    ? obj.dependsOn.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0)
    : undefined;
  return { title, description, complexity, tier, dependsOn };
}

async function loadProviderByName(
  prisma: PrismaClient,
  name: string
): Promise<Provider | undefined> {
  const row = await prisma.providerConfig.findFirst({ where: { name, enabled: true } });
  if (!row) return undefined;
  const config: ProviderConfig = {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    refreshToken: row.refreshToken ?? undefined,
    tokenExpiresAt: row.tokenExpiresAt?.getTime() ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: JSON.parse(row.capabilities) as ProviderConfig['capabilities'],
    enabled: row.enabled,
  };
  return createProvider(config);
}

function buildPlanPrompt(title: string, description: string, maxSubtasks: number, memory = ''): string {
  const memorySection = memory
    ? `\nRelevant patterns from past successful tasks:\n${memory}\n\nReuse these patterns where they fit; do not repeat past mistakes.\n`
    : '';
  return `You are the planning model in a multi-agent orchestration system. Decompose the following software engineering task into at most ${String(maxSubtasks)} concrete, independently implementable subtasks.

Task title: ${title}

Task description:
${description}
${memorySection}
Respond with ONLY a JSON array (no markdown fences, no commentary) of subtasks:
[
  {
    "title": "short imperative title",
    "description": "precise instructions for the implementing sub-agent, including file paths where known",
    "complexity": "simple" | "medium" | "complex",
    "tier": "medium" | "low",
    "dependsOn": [0]
  }
]

Rules:
- "tier" is the intelligence tier of the implementing sub-agent: "medium" for most implementation work, "low" for mechanical/trivial edits.
- "dependsOn" lists zero-based indexes of subtasks that must finish first; omit it when there are no dependencies.
- Order subtasks so dependencies come before dependents.
- Keep subtasks small enough that a smaller model can complete each one.`;
}

function buildReviewPrompt(
  title: string,
  description: string,
  completed: SubtaskState[],
  diff: string,
  verification: string
): string {
  const completedList = completed
    .map((s) => `- [${s.status}] ${s.title}${s.notes ? ` — ${s.notes}` : ''}`)
    .join('\n');
  return `You are the reviewing model in a multi-agent orchestration system. Sub-agents have been implementing parts of the task below. Review the accumulated git diff and the project build/test verification result, then decide whether the task is complete.

Task title: ${title}

Task description:
${description}

Subtasks executed so far:
${completedList || '(none)'}

Project build/test verification:
${verification || '(not run)'}

Current cumulative diff (truncated):
${diff.slice(0, 12000) || '(no changes yet)'}

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "status": "done" | "continue",
  "notes": "short review summary",
  "nextSubtasks": [ { "title": "...", "description": "...", "complexity": "simple|medium|complex", "tier": "medium|low" } ]
}

Use "done" only when the diff fully implements the task AND the project build/test verification passes. Use "continue" when more work is needed or verification fails, and list the follow-up subtasks in "nextSubtasks" (omit "nextSubtasks" if the already-planned subtasks cover it).`;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Multi-agent orchestration: a high-tier model plans the task and reviews
 * progress; implementation is delegated to sub-agents on smaller models that
 * run non-isolated (directly in options.projectPath) so their commits
 * accumulate on the current branch. After each subtask the high-tier model
 * reviews the cumulative diff and can request follow-up subtasks, forming a
 * feedback loop bounded by maxIterations.
 */
export async function runOrchestratedTask(
  prisma: PrismaClient,
  taskId: string,
  options: OrchestratorOptions
): Promise<OrchestratorResult> {
  const maxSubtasks = options.maxSubtasks ?? 5;
  const maxIterations = options.maxIterations ?? 3;
  const concurrency = options.concurrency ?? 1;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null, result: null },
  });

  const tracer = new Tracer(prisma, taskId);
  const rootSpan = tracer.startSpan('orchestrator.task');
  rootSpan.setAttributes({
    project: options.projectName,
    maxSubtasks,
    maxIterations,
    concurrency,
  });

  const [baseBranch, baseCommit] = await Promise.all([
    getCurrentBranch(options.projectPath),
    getCurrentCommit(options.projectPath),
  ]);
  const branch = baseBranch.success ? baseBranch.output : `orchestrator/${taskId}`;
  const baseCommitSha = baseCommit.success ? baseCommit.output : '';

  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      branch,
      baseCommit: baseCommitSha,
      resultStatus: 'running',
    },
  });

  const usage: UsageInfo = {};
  const recordUsage = (u: UsageInfo): void => {
    usage.promptTokens = (usage.promptTokens ?? 0) + (u.promptTokens ?? 0);
    usage.completionTokens = (usage.completionTokens ?? 0) + (u.completionTokens ?? 0);
    usage.totalTokens = (usage.totalTokens ?? 0) + (u.totalTokens ?? 0);
  };

  const subtasks: SubtaskState[] = [];
  let iterations = 0;
  let finished = false;
  let summary = '';

  try {
    // --- Planning (high tier) ---
    const plannerPick = await pickModelForTier(prisma, 'high');
    if (!plannerPick) throw new Error('No provider available for orchestration planning');
    const planner = await loadProviderByName(prisma, plannerPick.provider);
    if (!planner) throw new Error(`Planner provider '${plannerPick.provider}' is not available`);
    const plannerModel = plannerPick.model;
    rootSpan.setAttributes({ plannerProvider: plannerPick.provider, plannerModel });

    const planSpan = tracer.startSpan('orchestrator.plan', rootSpan.toContext());
    let planned: OrchestratedSubtask[] = [];
    try {
      const recalled = await recallRelevantSkills(prisma, task.description, 3);
      const memory = recalled.length > 0
        ? recalled.map((s) => `- ${s.name}: ${s.description}`).join('\n')
        : '';
      planSpan.setAttributes({ recalledSkills: recalled.length });
      const raw = await planner.send(buildPlanPrompt(task.title, task.description ?? '', maxSubtasks, memory), {
        system: 'You are a meticulous staff engineer producing execution plans as strict JSON.',
        model: plannerModel,
        temperature: 0.2,
        onUsage: recordUsage,
      });
      const parsed = extractJson(raw);
      if (Array.isArray(parsed)) {
        planned = parsed
          .slice(0, maxSubtasks)
          .map((item, i) => normalizeSubtask(item, `Subtask ${String(i + 1)}`))
          .filter((s): s is OrchestratedSubtask => s !== undefined);
      }
      planSpan.setAttributes({ plannedSubtasks: planned.length });
      await planSpan.end('ok');
    } catch (err) {
      planSpan.recordError(err);
      await planSpan.end('error');
      logger.warn('Orchestrator planning call failed; falling back to a single subtask', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (planned.length === 0) {
      // Graceful fallback: run the whole task as one subtask.
      planned = [
        {
          title: task.title,
          description: task.description ?? '',
          complexity: COMPLEXITIES.has(task.complexity)
            ? (task.complexity as OrchestratedSubtask['complexity'])
            : 'medium',
          tier: 'medium',
        },
      ];
    }
    planned.forEach((s, index) => {
      subtasks.push({ ...s, index, status: 'pending' });
    });

    const currentDiff = async (): Promise<string> => {
      const diff = await getDiff(options.projectPath, baseCommitSha);
      return diff.output;
    };

    const runVerification = async (): Promise<{ allPassed: boolean; summary: string }> => {
      try {
        const validation = await validateProject(options.projectPath);
        const parts: string[] = [];
        for (const key of ['lint', 'test', 'build'] as const) {
          const step = validation[key];
          parts.push(`${key}: ${step.passed ? 'pass' : 'fail'}${step.output ? ` — ${step.output.slice(-200)}` : ''}`);
        }
        return {
          allPassed: validation.allPassed,
          summary: parts.length > 0 ? parts.join('\n') : 'no validation steps run',
        };
      } catch (err) {
        return {
          allPassed: false,
          summary: `verification error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    };

    const review = async (): Promise<ReviewResult> => {
      const reviewSpan = tracer.startSpan('orchestrator.review', rootSpan.toContext());
      try {
        const [diff, verification] = await Promise.all([currentDiff(), runVerification()]);
        // Do not allow "done" when the project build/test verification fails.
        if (!verification.allPassed) {
          reviewSpan.setAttributes({ verificationPassed: false });
          await reviewSpan.end('ok');
          return {
            status: 'continue',
            notes: `Verification failed; cannot mark done. ${verification.summary}`,
          };
        }
        const raw = await planner.send(
          buildReviewPrompt(task.title, task.description ?? '', subtasks, diff, verification.summary),
          {
            system: 'You are a meticulous staff engineer reviewing implementation progress as strict JSON.',
            model: plannerModel,
            temperature: 0.2,
            onUsage: recordUsage,
          }
        );
        const parsed = extractJson(raw) as Record<string, unknown> | undefined;
        reviewSpan.setAttributes({ verificationPassed: true });
        await reviewSpan.end('ok');
        if (!parsed || typeof parsed !== 'object') {
          return { status: 'continue', notes: 'unparseable review response; continuing' };
        }
        const nextSubtasks = Array.isArray(parsed.nextSubtasks)
          ? parsed.nextSubtasks
              .map((item, i) => normalizeSubtask(item, `Follow-up ${String(i + 1)}`))
              .filter((s): s is OrchestratedSubtask => s !== undefined)
          : undefined;
        return {
          status: parsed.status === 'done' ? 'done' : 'continue',
          notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
          nextSubtasks,
        };
      } catch (err) {
        reviewSpan.recordError(err);
        await reviewSpan.end('error');
        logger.warn('Orchestrator review call failed; continuing without review guidance', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 'continue', notes: 'review call failed; continuing' };
      }
    };

    // --- Execution + review feedback loop ---
    const tierOrder: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    const maxEscalations = options.maxEscalations ?? 1;
    const runSubtask = async (subtask: SubtaskState): Promise<void> => {
      subtask.status = 'running';
      let tierIndex = Math.max(0, tierOrder.indexOf(subtask.tier));
      for (let attempt = 0; attempt <= maxEscalations; attempt++) {
        const tier = tierOrder[Math.min(tierIndex, tierOrder.length - 1)];
        const pick = await pickModelForTier(prisma, tier);
        const subtaskRow = await prisma.task.create({
          data: {
            projectId: task.projectId,
            title: subtask.title,
            description: subtask.description,
            complexity: subtask.complexity,
            tags: JSON.stringify(['subtask', `parent:${taskId}`]),
            provider: pick?.provider ?? null,
            model: pick?.model ?? null,
          },
        });
        subtask.taskId = subtaskRow.id;

        const subtaskSpan = tracer.startSpan(`orchestrator.subtask.${String(subtask.index)}.attempt${String(attempt + 1)}`, rootSpan.toContext());
        subtaskSpan.setAttributes({
          subtaskId: subtaskRow.id,
          title: subtask.title,
          tier,
          provider: pick?.provider,
          model: pick?.model,
          attempt: attempt + 1,
        });
        try {
          const result = await runAgentTask(prisma, subtaskRow.id, {
            ...options,
            projectPath: options.projectPath,
            projectName: options.projectName,
            isolated: false,
            tokenBudget: options.tokenBudget,
          });
          if (result.task.status === 'done') {
            subtask.status = 'done';
            subtask.notes = result.task.result ?? undefined;
            await subtaskSpan.end('ok');
            return;
          }
          subtask.notes = result.task.error ?? undefined;
          await subtaskSpan.end('error');
        } catch (err) {
          subtask.notes = err instanceof Error ? err.message : String(err);
          subtaskSpan.recordError(err);
          await subtaskSpan.end('error');
          logger.error('Orchestrated subtask failed', {
            taskId,
            subtaskId: subtaskRow.id,
            error: subtask.notes,
          });
        }
        if (attempt < maxEscalations) {
          tierIndex = Math.min(tierIndex + 1, tierOrder.length - 1);
          logger.info('Escalating subtask to higher tier', {
            taskId,
            subtask: subtask.title,
            tier: tierOrder[tierIndex],
          });
        }
      }
      subtask.status = 'failed';
    };

    // Every path that sets `finished = true` also breaks out of the loop.
    while (iterations < maxIterations) {
      iterations++;
      const completedIndexes = new Set(
        subtasks.filter((s) => s.status === 'done').map((s) => s.index)
      );
      const ready = subtasks.filter(
        (s) => s.status === 'pending' && (s.dependsOn ?? []).every((d) => completedIndexes.has(d))
      );

      if (ready.length === 0) {
        const blocked = subtasks.filter((s) => s.status === 'pending');
        if (blocked.length > 0) {
          summary = `Orchestration stalled: ${String(blocked.length)} subtask(s) have unsatisfiable dependencies.`;
        } else {
          // Everything planned has run; one final review decides done/continue.
          const finalReview = await review();
          if (finalReview.status === 'done') {
            finished = true;
            summary = finalReview.notes ?? 'All subtasks completed and review passed.';
          } else if (finalReview.nextSubtasks && finalReview.nextSubtasks.length > 0) {
            for (const s of finalReview.nextSubtasks) {
              subtasks.push({ ...s, index: subtasks.length, status: 'pending' });
            }
          } else {
            finished = true;
            summary = finalReview.notes ?? 'All subtasks completed.';
          }
        }
        break;
      }

      // Run the ready subtasks with bounded concurrency (1 = sequential),
      // escalating to a higher model tier on failure.
      await runPool(ready, concurrency, runSubtask);

      // Review after each round; the high-tier model can finish early or add
      // follow-up subtasks (feedback loop).
      const reviewResult = await review();
      if (reviewResult.status === 'done') {
        finished = true;
        summary = reviewResult.notes ?? 'Review marked the task as done.';
        break;
      }
      if (reviewResult.nextSubtasks && reviewResult.nextSubtasks.length > 0) {
        for (const s of reviewResult.nextSubtasks) {
          subtasks.push({ ...s, index: subtasks.length, status: 'pending' });
        }
      }
      // If every subtask failed and the review added nothing, stop early.
      if (
        subtasks.every((s) => s.status !== 'pending') &&
        subtasks.some((s) => s.status === 'failed') &&
        subtasks.every((s) => s.status !== 'done')
      ) {
        finished = true;
        summary = `All subtasks failed. Last review: ${reviewResult.notes ?? 'no notes'}`;
        break;
      }
    }

    if (!finished && !summary) {
      const anyDone = subtasks.some((s) => s.status === 'done');
      summary = anyDone
        ? `Reached max iterations (${String(maxIterations)}); partial progress committed.`
        : `Reached max iterations (${String(maxIterations)}) without completing subtasks.`;
    }

    // --- Integration: capture the final diff and close out the task ---
    const integrateSpan = tracer.startSpan('orchestrator.integrate', rootSpan.toContext());
    const finalDiff = await currentDiff();
    const success =
      subtasks.some((s) => s.status === 'done') &&
      (finished || subtasks.every((s) => s.status !== 'pending'));
    if (finalDiff) {
      await prisma.taskDiff.create({
        data: {
          taskId,
          branch,
          patch: sanitizeForDb(finalDiff) ?? '',
        },
      });
    }
    const finalSummary = sanitizeForDb(
      `${summary}\n\nOrchestration: ${String(subtasks.filter((s) => s.status === 'done').length)}/${String(subtasks.length)} subtasks done in ${String(iterations)} iteration(s).`
    );
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: success ? 'done' : 'failed',
        result: finalSummary,
        error: success ? null : finalSummary,
        provider: plannerPick.provider,
        model: plannerModel,
      },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        resultStatus: success ? 'done' : 'failed',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    });
    if (success) {
      // Close the learning loop: turn the successful run into a reusable skill
      // for future similar tasks.
      try {
        await generateSkillFromTask(prisma, taskId, options.projectPath, baseCommitSha);
      } catch (err) {
        logger.warn('Failed to auto-generate skill from orchestrated task', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    integrateSpan.setAttributes({ subtasks: subtasks.length, iterations, success });
    await integrateSpan.end(success ? 'ok' : 'error');
    rootSpan.addEvent('orchestrator.finished', { success, iterations });
    await rootSpan.end(success ? 'ok' : 'error');

    logger.info('Orchestrated task finished', {
      taskId,
      agentRunId: agentRun.id,
      traceId: tracer.traceId,
      success,
      iterations,
      subtasks: subtasks.length,
    });

    return {
      taskId,
      agentRunId: agentRun.id,
      status: success ? 'done' : 'failed',
      summary: finalSummary ?? summary,
      subtasks: subtasks.map((s) => ({ taskId: s.taskId, title: s.title, status: s.status })),
      iterations,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootSpan.recordError(err);
    await rootSpan.end('error');
    logger.error('Orchestrated task failed', { taskId, agentRunId: agentRun.id, error: message });
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', error: sanitizeForDb(message) },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        resultStatus: 'failed',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    });
    throw err;
  }
}
