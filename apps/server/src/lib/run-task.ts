import { createProvider } from '@omega/providers';
import { selectProvider, selectProviderWithHistory, getHistoricalScores } from '@omega/router';
import { runAgentTask, runOrchestratedTask, runExternalAgentTask, type ExternalCli } from '@omega/agent';
import type { PrismaClient } from '@omega/db';
import type { ProviderConfig as CoreProviderConfig, Task } from '@omega/core';
import { queue } from './task-queue.js';
import { notifyFailure } from './webhook-alerts.js';
import { getNextStrategy, executeRetry, type RetryContext, type RetryRecord } from './retry-strategies.js';

async function tryAutoRetry(
  prisma: PrismaClient,
  taskId: string,
): Promise<void> {
  if (process.env.OMEGA_AUTO_RETRY !== 'true') return;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task || task.status !== 'failed') return;

  const tags: string[] = task.tags ? (JSON.parse(task.tags) as string[]) : [];
  const retryHistory = task.retryHistory ? (JSON.parse(task.retryHistory) as RetryRecord[]) : [];
  const ctx: RetryContext = {
    task: {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      complexity: task.complexity,
      tags,
      provider: task.provider,
      model: task.model,
      retryCount: task.retryCount,
      retryHistory,
    },
    projectPath: task.project.path,
    projectName: task.project.name,
    error: task.error ?? '',
  };

  const attempt = getNextStrategy(ctx);
  if (!attempt) return;

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null },
  });

  void executeRetry(prisma, taskId, attempt, {
    projectPath: task.project.path,
    projectName: task.project.name,
    autoPublish: tags.includes('publish'),
  });
}

function toCoreConfig(row: {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiKey: string | null;
  defaultModel: string;
  capabilities: string;
  enabled: boolean;
}): CoreProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CoreProviderConfig['kind'],
    baseUrl: row.baseUrl ?? undefined,
    apiKey: row.apiKey ?? undefined,
    defaultModel: row.defaultModel,
    capabilities: JSON.parse(row.capabilities) as CoreProviderConfig['capabilities'],
    enabled: row.enabled,
  };
}

export async function runTask(
  prisma: PrismaClient,
  taskId: string,
  options: {
    detached?: boolean;
    tokenBudget?: number;
    maxSubtasks?: number;
    maxIterations?: number;
    concurrency?: number;
  } = {}
) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task) throw new Error('Task not found');

  if (task.status === 'in_progress') {
    throw new Error(`Task ${taskId} is already in progress`);
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null, result: null },
  });

  const tags: string[] = task.tags ? (JSON.parse(task.tags) as string[]) : [];

  // Tasks tagged external:<cli> are driven by an external coding-agent CLI
  // (Codex, Claude Code, Gemini CLI, OpenCode, Cursor CLI, Aider).
  const externalTag = tags.find((t) => t.startsWith('external:'));
  if (externalTag) {
    const cli = externalTag.split(':')[1] as ExternalCli;
    const run = () =>
      runExternalAgentTask(prisma, taskId, {
        projectPath: task.project.path,
        projectName: task.project.name,
        autoPublish: tags.includes('publish'),
        cli,
        complexity: task.complexity,
      });
    if (options.detached) {
      const result = queue.enqueue(taskId, cli, async () => {
        try {
          await run();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Detached external agent task ${taskId} failed:`, message);
          void notifyFailure(prisma, {
            taskId, title: task.title, provider: cli, error: message, tags,
            timestamp: new Date().toISOString(),
          });
          void tryAutoRetry(prisma, taskId);
        }
      });
      return { status: 'in_progress', taskId, ...result };
    }
    return run();
  }

  if (tags.includes('agent') || tags.includes('self-improve') || tags.includes('orchestrate')) {
    const tokenBudget = options.tokenBudget ?? (process.env.OMEGA_TOKEN_BUDGET
      ? Number(process.env.OMEGA_TOKEN_BUDGET)
      : undefined);

    // Tasks tagged 'orchestrate' go through the multi-agent orchestrator
    // (high-tier planner/reviewer + smaller sub-agent models); the
    // orchestrator runs its sub-agents non-isolated in the project path.
    const orchestrate = tags.includes('orchestrate');
    const run = () =>
      orchestrate
        ? runOrchestratedTask(prisma, taskId, {
            projectPath: task.project.path,
            projectName: task.project.name,
            autoPublish: tags.includes('publish'),
            tokenBudget,
            maxSubtasks: options.maxSubtasks,
            maxIterations: options.maxIterations,
            concurrency: options.concurrency,
            complexity: task.complexity,
          })
        : runAgentTask(prisma, taskId, {
            projectPath: task.project.path,
            projectName: task.project.name,
            autoPublish: tags.includes('publish'),
            isolated: true,
            tokenBudget,
            complexity: task.complexity,
          });

    if (options.detached) {
      const result = queue.enqueue(taskId, undefined, async () => {
        try {
          await run();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Detached agent task ${taskId} failed:`, message);
          void notifyFailure(prisma, {
            taskId, title: task.title, error: message, tags,
            timestamp: new Date().toISOString(),
          });
          void tryAutoRetry(prisma, taskId);
        }
      });
      return { status: 'in_progress', taskId, ...result };
    }
    const agentResult = await run();
    return 'task' in agentResult ? agentResult.task : prisma.task.findUnique({ where: { id: taskId } });
  }

  const configs = await prisma.providerConfig.findMany();
  const coreConfigs = configs.map(toCoreConfig);

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
    result: task.result ?? undefined,
    error: task.error ?? undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  // Use difficulty-aware routing if historical data is available; fall back to
  // the standard capability-based router otherwise.
  const historicalScores = await getHistoricalScores(() =>
    prisma.agentRun.findMany({
      select: {
        resultStatus: true,
        costUsd: true,
        createdAt: true,
        updatedAt: true,
        task: { select: { provider: true, model: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).then((runs) => runs.map((r) => ({
      resultStatus: r.resultStatus,
      costUsd: r.costUsd,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      provider: r.task.provider,
      model: r.task.model,
    }))),
  );

  const selection = historicalScores.size > 0
    ? selectProviderWithHistory(coreConfigs, [], taskForRouter, historicalScores)
    : selectProvider(coreConfigs, [], taskForRouter);
  if (!selection) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', error: 'No provider available for this task' },
    });
    return { status: 'failed', error: 'No provider available' };
  }

  const config = selection.provider;
  const providerName = config.name;
  const modelName = selection.model;
  const provider = createProvider(config);
  const prompt = [task.title, task.description].filter(Boolean).join('\n\n');

  try {
    const result = await provider.send(prompt, { model: modelName });
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'done',
        result,
        provider: providerName,
        model: modelName,
        error: null,
      },
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void notifyFailure(prisma, {
      taskId, title: task.title, provider: providerName, model: modelName,
      error: message, tags, timestamp: new Date().toISOString(),
    });
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: message,
        provider: providerName,
        model: modelName,
      },
    });
    void tryAutoRetry(prisma, taskId);
    return updated;
  }
}
