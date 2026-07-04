import { createProvider } from '@omega/providers';
import { selectProvider } from '@omega/router';
import { runAgentTask } from '@omega/agent';
import type { PrismaClient } from '@omega/db';
import type { ProviderConfig as CoreProviderConfig, Task } from '@omega/core';

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

export async function runTask(prisma: PrismaClient, taskId: string, options: { detached?: boolean } = {}) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task) throw new Error('Task not found');

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'in_progress', error: null, result: null },
  });

  const tags: string[] = task.tags ? (JSON.parse(task.tags) as string[]) : [];
  if (tags.includes('agent') || tags.includes('self-improve')) {
    if (options.detached) {
      void (async () => {
        try {
          await runAgentTask(prisma, taskId, {
            projectPath: task.project.path,
            projectName: task.project.name,
            autoPublish: tags.includes('publish'),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Detached agent task ${taskId} failed:`, message);
        }
      })();
      return { status: 'in_progress', taskId };
    }
    const agentResult = await runAgentTask(prisma, taskId, {
      projectPath: task.project.path,
      projectName: task.project.name,
      autoPublish: tags.includes('publish'),
    });
    return agentResult.task;
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

  const selection = selectProvider(coreConfigs, [], taskForRouter);
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
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: message,
        provider: providerName,
        model: modelName,
      },
    });
    return updated;
  }
}
