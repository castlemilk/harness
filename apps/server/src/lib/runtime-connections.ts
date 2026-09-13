import { CuttlefishClient, type FlowRuntimeConfig, type DispatchMode, type IntentProfile } from '@omega/cuttlefish';
import type { PrismaClient, RuntimeConnection, Task } from '@omega/db';
import { safeJsonParse } from './utils.js';

export interface ResolvedTaskRuntime {
  connection: RuntimeConnection;
  /** Named workflow from a `flow:<name>` tag. Latest published version wins. */
  workflowName?: string;
  /** Pinned version from `flow-version:<id>` or the connection default. */
  workflowVersionId?: string;
}

export function createRuntimeClient(connection: RuntimeConnection): CuttlefishClient {
  if (connection.kind !== 'cuttlefish') {
    throw new Error(`Unsupported runtime kind: ${connection.kind}`);
  }
  return new CuttlefishClient({
    baseUrl: connection.baseUrl,
    token: connection.apiToken ?? undefined,
    projectId: connection.externalProjectId ?? undefined,
  });
}

export function toFlowRuntimeConfig(
  connection: RuntimeConnection,
  workflowVersionId?: string | null
): FlowRuntimeConfig {
  return {
    workflowVersionId: workflowVersionId ?? connection.defaultWorkflowVersionId,
    workflowTemplate: connection.workflowTemplate,
    nodeImage: connection.nodeImage,
    nodeCommand: connection.nodeCommand,
    nodeTimeout: connection.nodeTimeout,
    nodeRetries: connection.nodeRetries,
    runnerPool: connection.runnerPool,
    runnerLabels: safeJsonParse<Record<string, string> | null>(connection.runnerLabels, null),
    runnerCapabilities: safeJsonParse<string[] | null>(connection.runnerCapabilities, null),
    dispatchMode: (connection.dispatchMode as DispatchMode | null) ?? 'autopilot',
    intentProfile: (connection.intentProfile as IntentProfile | null) ?? undefined,
    candidateLimit: connection.candidateLimit,
    baseInputs: safeJsonParse<Record<string, unknown> | null>(connection.baseInputs, null),
  };
}

export async function findRuntimeConnection(
  prisma: PrismaClient,
  projectId: string,
  extraWhere: Record<string, unknown> = {}
): Promise<RuntimeConnection | null> {
  const scoped = await prisma.runtimeConnection.findFirst({
    where: { ...extraWhere, projectId },
    orderBy: { createdAt: 'asc' },
  });
  if (scoped) return scoped;
  return prisma.runtimeConnection.findFirst({
    where: { ...extraWhere, projectId: null },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Decides whether a task should be executed by an external workflow runtime.
 *
 * Tags:
 * - `runtime:<connection-name>` selects a named connection.
 * - `flow:<workflow-name|id>` runs that workflow from its latest published version.
 * - `flow-version:<version-id>` pins a published workflow version.
 * - `flow-off` disables routing even when the connection has `autoRoute`.
 *
 * With no tags, a connection with `autoRoute` enabled for the task's project
 * (or a global one) takes over.
 */
export async function resolveTaskRuntime(
  prisma: PrismaClient,
  task: Pick<Task, 'id' | 'projectId' | 'tags'>
): Promise<ResolvedTaskRuntime | null> {
  const tags = safeJsonParse<string[]>(task.tags, []);
  if (tags.includes('flow-off')) return null;

  const runtimeTag = tags.find((t) => t.startsWith('runtime:'));
  const flowTag = tags.find((t) => t.startsWith('flow:'));
  const versionTag = tags.find((t) => t.startsWith('flow-version:'));

  if (runtimeTag) {
    const name = runtimeTag.slice('runtime:'.length);
    const connection = await prisma.runtimeConnection.findFirst({
      where: { name, enabled: true },
    });
    if (!connection) throw new Error(`Runtime connection "${name}" not found or disabled`);
    return {
      connection,
      workflowName: flowTag?.slice('flow:'.length),
      workflowVersionId: versionTag?.slice('flow-version:'.length)
        ?? (flowTag ? undefined : connection.defaultWorkflowVersionId ?? undefined),
    };
  }

  if (flowTag || versionTag) {
    const connection = await findRuntimeConnection(prisma, task.projectId, { enabled: true, kind: 'cuttlefish' });
    if (!connection) return null;
    return {
      connection,
      workflowName: flowTag?.slice('flow:'.length),
      workflowVersionId: versionTag?.slice('flow-version:'.length)
        ?? (flowTag ? undefined : connection.defaultWorkflowVersionId ?? undefined),
    };
  }

  const autoRouted = await findRuntimeConnection(prisma, task.projectId, {
    enabled: true,
    kind: 'cuttlefish',
    autoRoute: true,
  });
  if (!autoRouted) return null;
  return {
    connection: autoRouted,
    workflowVersionId: autoRouted.defaultWorkflowVersionId ?? undefined,
  };
}
