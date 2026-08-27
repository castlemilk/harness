import type { PrismaClient } from '@omega/db';
import type { UsageInfo } from '@omega/core';
import { runAgentTask } from './executor.js';
import { validateProject } from './validator.js';
import { generateSkillFromTask, recallRelevantSkills } from './skill-generator.js';
import { Tracer } from './tracer.js';
import { getCurrentBranch, getCurrentCommit, getDiff, getGradedDiff } from './git.js';
import { logger } from './logger.js';
import { sanitizeForDb } from './utils.js';
import type {
  OrchestratorOptions,
  OrchestratedSubtask,
  SubtaskState,
  ReviewResult,
  OrchestratorResult,
} from './orchestrator-types.js';
import {
  COMPLEXITIES,
  extractJson,
  normalizeSubtask,
  loadProviderByName,
  detectFileConflicts,
  buildPlanPrompt,
  buildReviewPrompt,
  runPool,
  pickModel, resolvePinnedModel } from './orchestrator-utils.js';
import { validationSummaryWithPatchAudit } from './patch-audit.js';
import { createDeadlineGuard } from './project-utils.js';
import { abortableOperation } from './retry.js';

export type { OrchestratorOptions, OrchestratorResult, OrchestratedSubtask } from './orchestrator-types.js';

function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Orchestrated task cancelled', 'AbortError');
}

export async function runOrchestratedTask(
  prisma: PrismaClient,
  taskId: string,
  options: OrchestratorOptions
): Promise<OrchestratorResult> {
  throwIfCancelled(options.signal);
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
  let parentPatchCaptured = false;

  try {
    // An explicit pin on the parent is an operator instruction, not a hint:
    // it must govern the planner AND every subtask. Without this the
    // orchestrator silently routed subtasks to whatever the intelligent
    // router preferred, so "orchestrate model X to build this" ran on a
    // different model entirely — which also invalidates any model
    // comparison run through the orchestrator.
    const pinned = resolvePinnedModel(task);
    if (pinned) {
      logger.info('Orchestration honouring pinned model for all subtasks', {
        taskId,
        provider: pinned.provider,
        model: pinned.model,
      });
    }

    // --- Planning (high tier) ---
    const plannerPick =
      pinned ?? (await pickModel(prisma, 'high', options.intelligentRouter, task.title, task.complexity));
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
      const raw = await abortableOperation(
        () => planner.send(buildPlanPrompt(task.title, task.description ?? '', maxSubtasks, memory), {
          system: 'You are a meticulous staff engineer producing execution plans as strict JSON.',
          model: plannerModel,
          temperature: 0.2,
          onUsage: recordUsage,
        }),
        options.signal,
      );
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
      throwIfCancelled(options.signal);
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
        const validation = await validateProject(options.projectPath, { signal: options.signal });
        throwIfCancelled(options.signal);
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
        throwIfCancelled(options.signal);
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
        const raw = await abortableOperation(
          () => planner.send(
            buildReviewPrompt(task.title, task.description ?? '', subtasks, diff, verification.summary),
            {
              system: 'You are a meticulous staff engineer reviewing implementation progress as strict JSON.',
              model: plannerModel,
              temperature: 0.2,
              onUsage: recordUsage,
            },
          ),
          options.signal,
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
        throwIfCancelled(options.signal);
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
      throwIfCancelled(options.signal);
      subtask.status = 'running';
      let tierIndex = Math.max(0, tierOrder.indexOf(subtask.tier));
      for (let attempt = 0; attempt <= maxEscalations; attempt++) {
        const tier = tierOrder[Math.min(tierIndex, tierOrder.length - 1)];
        const pick =
          pinned
          ?? (await pickModel(prisma, tier, options.intelligentRouter, subtask.title, subtask.complexity));
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
          // Combine the per-subtask deadline with caller cancellation so
          // either source stops the active executor without leaking timers.
          const subtaskTimeoutMs = subtask.complexity === 'complex'
            ? 10 * 60 * 1000
            : subtask.complexity === 'medium'
              ? 5 * 60 * 1000
              : 3 * 60 * 1000;
          const deadlineGuard = createDeadlineGuard(
            Date.now() + subtaskTimeoutMs,
            options.signal,
          );

          const result = await (async () => {
            try {
              return await runAgentTask(prisma, subtaskRow.id, {
                ...options,
                projectPath: options.projectPath,
                projectName: options.projectName,
                isolated: false,
                tokenBudget: options.tokenBudget,
                signal: deadlineGuard.signal,
              }, options.intelligentRouter);
            } finally {
              deadlineGuard.dispose();
            }
          })();
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
          throwIfCancelled(options.signal);
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
      throwIfCancelled(options.signal);
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

      // Detect file-level conflicts among ready subtasks.
      const conflicts = detectFileConflicts(ready);
      let effectiveConcurrency = concurrency;
      if (conflicts.length > 0 && concurrency > 1) {
        logger.warn('File-level conflicts detected among ready subtasks; falling back to sequential execution', {
          taskId,
          conflicts: conflicts.map((c) => c.join(', ')),
        });
        effectiveConcurrency = 1;
      }

      // Run the ready subtasks with bounded concurrency (1 = sequential),
      // escalating to a higher model tier on failure.
      await runPool(ready, effectiveConcurrency, runSubtask);

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
    const gradedDiff = await getGradedDiff(options.projectPath, baseCommitSha);
    const finalDiff = gradedDiff.output;
    const patchAuditValidation = await validationSummaryWithPatchAudit(prisma, agentRun.id, gradedDiff);
    const success =
      subtasks.some((s) => s.status === 'done') &&
      (finished || subtasks.every((s) => s.status !== 'pending'));
    if (gradedDiff.success && finalDiff) {
      await prisma.taskDiff.create({
        data: {
          taskId,
          branch,
          patch: sanitizeForDb(finalDiff) ?? '',
        },
      });
    } else if (!gradedDiff.success) {
      logger.warn(`graded diff failed for task ${taskId}: ${gradedDiff.error ?? 'unknown error'}`);
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
        ...(patchAuditValidation ? { validationSummary: patchAuditValidation } : {}),
      },
    });
    parentPatchCaptured = true;
    rootSpan.setAttributes({
      gradedPatchTestPaths: gradedDiff.gradedPatchTestPaths.length,
      gradedPatchAddedTestPaths: gradedDiff.gradedPatchAddedTestPaths.length,
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
    logger.error('Orchestrated task failed', { taskId, agentRunId: agentRun.id, error: message });

    // A caller cancellation can arrive after a non-isolated subtask edited the
    // shared worktree. Preserve the same graded patch/audit evidence as the
    // normal integration path before disclosing the cancelled parent run.
    if (!parentPatchCaptured) {
      try {
        const gradedDiff = await getGradedDiff(options.projectPath, baseCommitSha);
        const patchAuditValidation = await validationSummaryWithPatchAudit(prisma, agentRun.id, gradedDiff);
        if (gradedDiff.success && gradedDiff.output) {
          await prisma.taskDiff.create({
            data: {
              taskId,
              branch,
              patch: sanitizeForDb(gradedDiff.output) ?? '',
            },
          });
        } else if (!gradedDiff.success) {
          logger.warn(`graded diff failed for task ${taskId}: ${gradedDiff.error ?? 'unknown error'}`);
        }
        if (patchAuditValidation) {
          await prisma.agentRun.update({
            where: { id: agentRun.id },
            data: { validationSummary: patchAuditValidation },
          });
        }
        rootSpan.setAttributes({
          gradedPatchTestPaths: gradedDiff.gradedPatchTestPaths.length,
          gradedPatchAddedTestPaths: gradedDiff.gradedPatchAddedTestPaths.length,
        });
      } catch (captureErr) {
        logger.warn('Failed to capture orchestrated task patch after cancellation/error', {
          taskId,
          error: captureErr instanceof Error ? captureErr.message : String(captureErr),
        });
      }
    }
    await rootSpan.end('error');
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
