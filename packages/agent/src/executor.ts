import type { PrismaClient } from '@omega/db';
import type { ProviderConfig, Task, AgentOptions } from '@omega/core';
import { omegaWorkDir } from '@omega/core';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import type { IntelligentRouter } from '@omega/router';
import { type AgentResult, type AgentContext } from './agent-types.js';
import { executeAgentLoop } from './agent-loop.js';
import { maxStepsForComplexity, installWorktreeDependencies, deadlineMsForComplexity, explorationBudgetForComplexity, projectHasTestableArtifacts, toCoreTask } from './project-utils.js';
import { buildSystemPrompt, buildTextToolsSystemPrompt } from './prompts.js';
import { adaptPrompts, type PromptFormat } from './prompt-adapters.js';
import { buildPromptContext } from './prompt-context.js';
import { resolveSkills, formatSkillContext, type ResolvedSkill } from './skill-resolver.js';
import { createClients } from './lsp/index.js';
import { setLspClients, clearLspClients } from './tools.js';
import { loadCurrentPrompts, hashPrompts } from './prompt-versioning.js';
import { logger } from './logger.js';
import { Tracer } from './tracer.js';
import { codeOverview } from './tools.js';
import { failTask } from './agent-loop.js';
import {
  getCurrentBranch,
  getCurrentCommit,
  createBranch,
  hasChanges,
  checkoutBranch,
  stashAll,
  popStash,
  createWorktree,
  removeWorktree,
  deleteOtherLocalBranches,
} from './git.js';

export type { AgentResult } from './agent-types.js';

export async function runAgentTask(
  prisma: PrismaClient,
  taskId: string,
  options: AgentOptions,
  router?: IntelligentRouter,
): Promise<AgentResult> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null, result: null },
  });

  const providerConfigs = await prisma.providerConfig.findMany();
  const coreConfigs: ProviderConfig[] = providerConfigs.map((cfg) => ({
    id: cfg.id,
    name: cfg.name,
    kind: cfg.kind as ProviderConfig['kind'],
    baseUrl: cfg.baseUrl ?? undefined,
    apiKey: cfg.apiKey ?? undefined,
    refreshToken: cfg.refreshToken ?? undefined,
    tokenExpiresAt: cfg.tokenExpiresAt?.getTime() ?? undefined,
    defaultModel: cfg.defaultModel,
    capabilities: JSON.parse(cfg.capabilities) as ProviderConfig['capabilities'],
    enabled: cfg.enabled,
  }));
  // Use intelligent router when available, fallback to blind rules-based selection
  let selection: Awaited<ReturnType<typeof selectProvider>>;
  if (router) {
    const taskForRouter: Task = {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status as Task['status'],
      complexity: task.complexity as Task['complexity'],
      tags: task.tags ? (JSON.parse(task.tags) as Task['tags']) : [],
      assignedModel:
        task.provider && task.model ? { provider: task.provider, model: task.model } : undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    const decision = router.route(coreConfigs, taskForRouter, {
      strategy: 'balanced',
      maxCandidates: 1,
    });
    selection = decision
      ? { provider: decision.primary.provider, model: decision.primary.model }
      : selectProvider(coreConfigs, [], toCoreTask(task));
  } else {
    selection = selectProvider(coreConfigs, [], toCoreTask(task));
  }
  if (!selection) {
    await failTask(prisma, taskId, 'No provider available for this task');
    throw new Error('No provider available for this task');
  }
  const provider = createProvider(selection.provider);
  // Wire up credential persistence for OAuth token refresh
  if (selection.provider.refreshToken) {
    const providerId = selection.provider.id;
    selection.provider.onCredentialsUpdate = (creds) => {
      void (async () => {
        try {
          await prisma.providerConfig.update({
            where: { id: providerId },
            data: {
              apiKey: creds.apiKey,
              refreshToken: creds.refreshToken,
              tokenExpiresAt: new Date(creds.tokenExpiresAt),
            },
          });
        } catch (err) {
          console.warn('Failed to persist refreshed OAuth credentials:', err);
        }
      })();
    };
  }

  const branch = `agent/${task.id}`;
  const baseBranch = await getCurrentBranch(options.projectPath);
  const baseCommit = await getCurrentCommit(options.projectPath);
  if (!baseBranch.success || !baseCommit.success) {
    await failTask(prisma, taskId, 'Not a git repository');
    throw new Error('Not a git repository');
  }

  // Isolated runs (the default) get a clean base: uncommitted changes are
  // stashed and the agent works in a separate worktree/branch. Non-isolated
  // runs execute directly in options.projectPath on the current branch, so
  // they must NOT stash, create branches, or checkout — the caller (e.g. the
  // orchestrator) owns the working tree.
  const isolated = options.isolated ?? true;
  let stashed = false;
  if (isolated && (await hasChanges(options.projectPath))) {
    const stashResult = await stashAll(options.projectPath);
    stashed = stashResult.success;
  }

  let worktreePath: string | undefined;
  let effectiveProjectPath = options.projectPath;
  if (isolated) {
    // Keep isolated worktrees outside the project tree. Nested worktrees inherit
    // node_modules and config files from the parent repo and break tooling such
    // as ESLint plugin resolution and TypeScript project references.
    worktreePath = path.join(omegaWorkDir(), 'worktrees', `${options.projectName}-${task.id}`);
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    const worktreeResult = await createWorktree(options.projectPath, worktreePath, branch, baseCommit.output);
    if (worktreeResult.success) {
      effectiveProjectPath = worktreePath;
      // Remove any pre-existing feature/solution branches so the agent cannot
      // accidentally checkout a branch that already contains the answer.
      await deleteOtherLocalBranches(worktreePath, branch).catch((err: unknown) => {
        logger.warn('Failed to clean other branches from worktree', { worktreePath, error: String(err) });
      });
    } else {
      logger.warn('Worktree creation failed, falling back to in-repo run', {
        projectPath: options.projectPath,
        worktreePath,
        error: worktreeResult.output,
      });
      const branchResult = await createBranch(options.projectPath, branch, baseCommit.output);
      if (!branchResult.success) {
        await checkoutBranch(options.projectPath, branch);
      }
      await deleteOtherLocalBranches(options.projectPath, branch).catch((err: unknown) => {
        logger.warn('Failed to clean other branches from project', { projectPath: options.projectPath, error: String(err) });
      });
    }
  }
  // Non-isolated mode: no worktree, no branch, no checkout. The agent loop
  // still commits at the end (see executeAgentLoop), which is what the
  // orchestrator relies on to accumulate subtask changes on the current branch.

  let agentRun;
  let agentResult: AgentResult | undefined;
  let projectHasTests = false;
  let promptContext;
  let skills: ResolvedSkill[] = [];
  let combinedContext = '';
  let systemPrompt = '';
  let textToolsSystemPrompt = '';
  let promptFormat: PromptFormat = 'xml';
  let repoOverviewText = '';
  try {
    // Isolated worktrees lack installed dependencies. Install per-language so the
    // agent's build/test verification (the build gate) can actually run.
    await installWorktreeDependencies(effectiveProjectPath);
    projectHasTests = await projectHasTestableArtifacts(effectiveProjectPath);

    promptContext = await buildPromptContext(prisma, task.projectId, {
      lookbackRuns: 5,
      taskDescription: task.description,
    });
    const taskTags = task.tags ? (JSON.parse(task.tags) as string[]) : [];
    // Sub-agents created by the orchestrator should not have task-specific
    // reference skills auto-applied; they implement their own subtask.
    skills = taskTags.includes('subtask')
      ? []
      : await resolveSkills(prisma, effectiveProjectPath, task.description, taskTags);
    const skillContext = formatSkillContext(skills);
    // Seed a condensed repository overview so the agent starts with a structural
    // map instead of spending its first steps on blind exploration.
    try {
      const overview = await codeOverview(effectiveProjectPath);
      if (overview.success && overview.output) {
        repoOverviewText = `Repository overview:\n${overview.output.slice(0, 2000)}`;
      }
    } catch {
      // ignore overview failures
    }
    combinedContext = [promptContext.text, skillContext, repoOverviewText].filter(Boolean).join('\n\n');
    const fullSystemPrompt = buildSystemPrompt(combinedContext);
    const fullTextToolsPrompt = buildTextToolsSystemPrompt(combinedContext);
    const adapted = adaptPrompts(fullSystemPrompt, fullTextToolsPrompt, provider.config.kind, selection.model);
    systemPrompt = adapted.systemPrompt;
    textToolsSystemPrompt = adapted.textToolsPrompt;
    promptFormat = adapted.format;

    const currentPrompts = await loadCurrentPrompts(skillContext);
    const promptHash = hashPrompts({
      systemPrompt: currentPrompts.systemPrompt,
      textToolsPrompt: currentPrompts.textToolsPrompt,
      planningPrompt: currentPrompts.planningPrompt,
      skillContext,
    });
    const promptVersion =
      (await prisma.promptVersion.findFirst({ where: { hash: promptHash } })) ??
      (await prisma.promptVersion.create({
        data: {
          name: currentPrompts.name,
          sourcePath: currentPrompts.sourcePath,
          systemPrompt: currentPrompts.systemPrompt,
          textToolsPrompt: currentPrompts.textToolsPrompt,
          planningPrompt: currentPrompts.planningPrompt ?? null,
          skillContext: skillContext || null,
          hash: promptHash,
        },
      }));

    agentRun = await prisma.agentRun.create({
      data: {
        taskId,
        branch,
        baseCommit: baseCommit.output,
        resultStatus: 'running',
        promptVersionId: promptVersion.id,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failTask(prisma, taskId, `Setup failed: ${message}`);
    throw err;
  }

  const lspClients = createClients(effectiveProjectPath);
  setLspClients(effectiveProjectPath, lspClients);
  for (const client of new Set(lspClients.values())) {
    try {
      await client.start();
    } catch (err) {
      logger.warn('LSP client failed to start', {
        command: client,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const tracer = new Tracer(prisma, taskId, taskId);
  const rootSpan = tracer.startSpan('agent.task');
  rootSpan.setAttributes({
    project: options.projectName,
    provider: provider.config.name,
    model: selection.model,
    autoPublish: options.autoPublish ?? false,
    promptContextUsed: combinedContext.length > 0,
    runsAnalysed: promptContext.runsAnalysed,
    skillsInjected: skills.map((s) => s.name),
  });

  const ctx: AgentContext = {
    prisma,
    task: toCoreTask(task),
    projectPath: effectiveProjectPath,
    projectName: options.projectName,
    provider,
    model: selection.model,
    branch,
    baseCommit: baseCommit.output,
    agentRunId: agentRun.id,
    autoPublish: options.autoPublish ?? false,
    maxSteps: options.maxSteps ?? maxStepsForComplexity(task.complexity),
    explorationBudget: explorationBudgetForComplexity(task.complexity),
    tokenBudget: options.tokenBudget,
    modifiedFiles: new Set<string>(),
    consecutiveThinks: 0,
    explorationCount: 0,
    editCount: 0,
    explorationAtLastEdit: 0,
    explorationSinceLastEdit: 0,
    hasRunTestCommand: false,
    projectHasTests,
    tracer,
    rootSpan,
    systemPrompt,
    textToolsSystemPrompt,
    promptFormat,
    promptContext: combinedContext,
    usage: {},
    apiSurfaceVerified: false,
    repoOverview: repoOverviewText,
    deadlineMs: Date.now() + deadlineMsForComplexity(task.complexity),
    signal: options.signal,
    router,
  };

  logger.info('Agent task started', {
    taskId: ctx.task.id,
    agentRunId: ctx.agentRunId,
    traceId: tracer.traceId,
    spanId: rootSpan.spanId,
    provider: ctx.provider.config.name,
    model: ctx.model,
    project: ctx.projectName,
  });

  try {
    agentResult = await executeAgentLoop(ctx, skills);
    rootSpan.addEvent('task.finished', { status: agentResult.task.status });
    await rootSpan.end(agentResult.task.status === 'done' ? 'ok' : 'error');
    logger.info('Agent task finished', {
      taskId: ctx.task.id,
      agentRunId: ctx.agentRunId,
      traceId: tracer.traceId,
      status: agentResult.task.status,
    });
    return agentResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootSpan.recordError(err);
    await rootSpan.end('error');
    logger.error('Agent task failed', {
      taskId,
      agentRunId: agentRun.id,
      traceId: tracer.traceId,
      error: message,
    });
    await failTask(prisma, taskId, message);
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: { resultStatus: 'failed' },
    });
    throw err;
  } finally {
    for (const client of new Set(lspClients.values())) {
      try {
        await client.stop();
      } catch {
        // ignore shutdown errors
      }
    }
    clearLspClients(effectiveProjectPath);
    const keepWorktree =
      (options.retainWorktree ?? false) ||
      process.env.OMEGA_RETAIN_WORKTREE === 'true' ||
      ctx.task.tags.includes('retain-worktree') ||
      agentResult?.task.status !== 'done';
    if (worktreePath) {
      if (keepWorktree) {
        logger.info('Retaining isolated worktree for inspection', { worktreePath });
      } else {
        const removeResult = await removeWorktree(options.projectPath, worktreePath);
        if (!removeResult.success) {
          logger.warn('Failed to remove worktree', {
            worktreePath,
            error: removeResult.output,
          });
        }
      }
    } else if (isolated) {
      await checkoutBranch(options.projectPath, baseBranch.output);
    }
    if (stashed) {
      await popStash(options.projectPath);
    }
  }
}
