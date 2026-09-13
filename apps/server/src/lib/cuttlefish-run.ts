import {
  CuttlefishApiError,
  buildStartRunRequest,
  type CuttlefishAttempt,
  type CuttlefishTaskInstance,
} from '@omega/cuttlefish';
import { context, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { FlowRun, PrismaClient, RuntimeConnection, Task } from '@omega/db';
import { createRuntimeClient, toFlowRuntimeConfig, type ResolvedTaskRuntime } from './runtime-connections.js';
import { getTracer } from './telemetry.js';

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED']);

const POLL_INTERVAL_MS = Math.max(500, Number(process.env.OMEGA_FLOW_POLL_MS ?? 2000));
const FLOW_TIMEOUT_MS = Math.max(60_000, Number(process.env.OMEGA_FLOW_TIMEOUT_MS ?? 2 * 60 * 60 * 1000));

const activeFlowSyncs = new Map<string, ReturnType<typeof setInterval>>();
/** Long-lived `flow.run` spans, one per in-flight flow, keyed by FlowRun id. */
const activeFlowSpans = new Map<string, Span>();

export function isTerminalFlowStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Stops every poll loop and closes open flow spans. Called on shutdown. */
export function stopAllFlowSyncs(): void {
  for (const timer of activeFlowSyncs.values()) clearInterval(timer);
  activeFlowSyncs.clear();
  for (const [flowRunId, span] of activeFlowSpans) {
    span.setAttribute('omega.flow.aborted', true);
    span.addEvent('harness.shutdown');
    span.end();
    activeFlowSpans.delete(flowRunId);
  }
}

function stopFlowSync(flowRunId: string): void {
  const timer = activeFlowSyncs.get(flowRunId);
  if (timer) {
    clearInterval(timer);
    activeFlowSyncs.delete(flowRunId);
  }
}

/** Deterministic task-step name for a flow run, stable across create/finish. */
function flowStepName(flowRun: Pick<FlowRun, 'id' | 'workflowName'>): string {
  return `flow:${flowRun.workflowName ?? flowRun.id.slice(0, 8)}`;
}

export interface StartTaskFlowOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Translates a task into a cuttlefish workflow, starts a run, records the
 * `FlowRun` link, and begins polling the run into task steps/spans.
 *
 * Returns as soon as the run is dispatched — the remote run continues on the
 * fleet and is mirrored back by the sync loop.
 */
export async function startTaskFlow(
  prisma: PrismaClient,
  taskId: string,
  runtime: ResolvedTaskRuntime,
  options: StartTaskFlowOptions = {}
): Promise<{ flowRun: FlowRun; task: Task }> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task) throw new Error(`Task ${taskId} not found`);

  const connection = runtime.connection;
  const client = createRuntimeClient(connection);

  let workflowVersionId = runtime.workflowVersionId ?? null;
  if (!workflowVersionId && runtime.workflowName) {
    workflowVersionId = await client.resolveWorkflowVersionId(runtime.workflowName);
    if (!workflowVersionId) {
      throw new Error(
        `Cuttlefish workflow "${runtime.workflowName}" was not found or has no published version on ${connection.baseUrl}`
      );
    }
  }

  const request = buildStartRunRequest({
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      complexity: task.complexity,
      tags: safeTags(task.tags),
    },
    project: {
      id: task.project.id,
      name: task.project.name,
      path: task.project.path,
      repoUrl: task.project.repoUrl,
    },
    connection: toFlowRuntimeConfig(connection, workflowVersionId),
    serverUrl: process.env.OMEGA_PUBLIC_URL,
  });

  const tracer = getTracer();
  const flowSpan = tracer.startSpan('flow.run', {
    attributes: {
      'omega.task.id': task.id,
      'omega.project.id': task.projectId,
      'omega.runtime.name': connection.name,
      'omega.workflow.name': runtime.workflowName ?? 'inline',
    },
  });

  let started: Awaited<ReturnType<typeof client.startRun>>;
  try {
    started = await context.with(trace.setSpan(context.active(), flowSpan), async () => {
      if (request.workflowYAML) {
        try {
          const issues = await client.validateWorkflow(request.workflowYAML);
          const errors = issues.filter((issue) => issue.severity === 'error');
          if (errors.length > 0) {
            throw new Error(
              `Generated workflow failed cuttlefish validation: ${errors.map((e) => e.message).join('; ')}`
            );
          }
        } catch (err) {
          if (err instanceof CuttlefishApiError && err.status === 404) {
            // Older control planes may not expose /validate; the start call still validates.
            console.warn('cuttlefish validate endpoint unavailable, starting run anyway');
          } else {
            throw err;
          }
        }
      }
      return tracer.startActiveSpan('flow.dispatch', async (span) => {
        try {
          return await client.startRun(request);
        } catch (err) {
          span.recordException(err instanceof Error ? err : String(err));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          throw err;
        } finally {
          span.end();
        }
      });
    });
  } catch (err) {
    flowSpan.recordException(err instanceof Error ? err : String(err));
    flowSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    flowSpan.end();
    throw err;
  }

  const workflowName = started.run.workflowName ?? runtime.workflowName ?? null;
  const flowRun = await prisma.flowRun.create({
    data: {
      taskId: task.id,
      runtimeId: connection.id,
      externalRunId: started.run.id,
      workflowName,
      workflowVersionId,
      traceId: flowSpan.spanContext().traceId,
      status: started.run.status,
      inputs: JSON.stringify(request.inputs ?? {}),
    },
  });
  activeFlowSpans.set(flowRun.id, flowSpan);
  flowSpan.setAttribute('omega.flow.id', flowRun.id);
  flowSpan.setAttribute('cuttlefish.run.id', started.run.id);

  const stepCount = await prisma.taskStep.count({ where: { taskId: task.id } });
  await prisma.taskStep.create({
    data: {
      taskId: task.id,
      idx: stepCount,
      name: flowStepName(flowRun),
      status: 'running',
      input: JSON.stringify({ externalRunId: flowRun.externalRunId, workflowVersionId }),
    },
  });

  await prisma.taskTrace.create({
    data: {
      taskId: task.id,
      role: 'system',
      content: `Dispatched cuttlefish run ${flowRun.externalRunId} (${workflowName ?? 'inline workflow'}) via runtime "${connection.name}" (${connection.baseUrl}).`,
    },
  });

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      provider: 'cuttlefish',
      model: workflowName ?? workflowVersionId ?? 'inline-workflow',
    },
  });

  if (options.timeoutMs && options.timeoutMs < FLOW_TIMEOUT_MS) {
    // The task-level timeout is still enforced when awaiting the run, but the
    // sync loop uses the global bound so we keep polling after a caller timeout.
    console.info(`flow ${flowRun.id}: task timeout ${String(options.timeoutMs)}ms is shorter than the sync bound`);
  }

  startFlowSync(prisma, flowRun.id);
  return { flowRun, task: updated };
}

function startFlowSync(prisma: PrismaClient, flowRunId: string): void {
  if (activeFlowSyncs.has(flowRunId)) return;
  const tick = () => {
    void syncFlowRunOnce(prisma, flowRunId).catch((err: unknown) => {
      console.error(`flow sync ${flowRunId} failed:`, err instanceof Error ? err.message : String(err));
    });
  };
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref();
  activeFlowSyncs.set(flowRunId, timer);
  tick();
}

/**
 * Pulls the cuttlefish run state once and mirrors it into the harness:
 * task steps per node, trace spans per attempt, and terminal task status.
 */
export async function syncFlowRunOnce(prisma: PrismaClient, flowRunId: string): Promise<void> {
  const flowRun = await prisma.flowRun.findUnique({
    where: { id: flowRunId },
    include: { runtime: true },
  });
  if (!flowRun) {
    stopFlowSync(flowRunId);
    return;
  }
  if (isTerminalFlowStatus(flowRun.status)) {
    stopFlowSync(flowRunId);
    return;
  }
  if (!flowRun.runtime) {
    await finishFlow(prisma, flowRun, {
      status: 'FAILED',
      error: 'Runtime connection no longer exists',
    });
    return;
  }

  if (Date.now() - flowRun.createdAt.getTime() > FLOW_TIMEOUT_MS) {
    await cancelTaskFlow(prisma, flowRun.taskId ?? '', {
      reason: `Flow exceeded the ${String(Math.round(FLOW_TIMEOUT_MS / 1000))}s sync window`,
    });
    return;
  }

  const client = createRuntimeClient(flowRun.runtime);
  let detail: Awaited<ReturnType<typeof client.getRun>>;
  try {
    detail = await client.getRun(flowRun.externalRunId);
  } catch (err) {
    if (err instanceof CuttlefishApiError && err.status === 404) {
      await finishFlow(prisma, flowRun, { status: 'FAILED', error: 'Cuttlefish run not found (404)' });
      return;
    }
    throw err;
  }
  if (!detail) {
    await finishFlow(prisma, flowRun, { status: 'FAILED', error: 'Cuttlefish run not found' });
    return;
  }

  const run = detail.run;
  if (flowRun.taskId) {
    for (const instance of detail.taskInstances) {
      await upsertNodeStep(prisma, flowRun.taskId, instance);
    }
    try {
      const attempts = await client.listRunAttempts(run.id);
      for (const attempt of attempts) {
        await persistAttemptSpan(prisma, flowRun.taskId, run.id, attempt);
      }
    } catch (err) {
      console.warn(`flow ${flowRunId}: could not read attempts:`, err instanceof Error ? err.message : String(err));
    }
  }

  const terminal = isTerminalFlowStatus(run.status);
  await prisma.flowRun.update({
    where: { id: flowRun.id },
    data: {
      status: run.status,
      outputs: run.outputs ? JSON.stringify(run.outputs) : flowRun.outputs,
      lastSyncedAt: new Date(),
      ...(terminal ? { completedAt: new Date() } : {}),
    },
  });

  if (flowRun.status !== run.status && flowRun.taskId) {
    activeFlowSpans.get(flowRun.id)?.addEvent('cuttlefish.run.status', {
      status: run.status,
      reason: run.latestReason ?? '',
    });
    await prisma.taskTrace.create({
      data: {
        taskId: flowRun.taskId,
        role: 'assistant',
        content: `Cuttlefish run ${run.id} is ${run.status}${run.latestReason ? ` (${run.latestReason})` : ''}.`,
      },
    });
  }

  if (terminal) {
    stopFlowSync(flowRun.id);
    const failedStatus = run.status === 'FAILED' || run.status === 'SKIPPED';
    await finishFlow(prisma, flowRun, {
      status: run.status,
      outputs: run.outputs,
      error: failedStatus ? run.latestReason ?? `Cuttlefish run ${run.status}` : undefined,
    });
  }
}

interface FinishResult {
  status: string;
  outputs?: Record<string, unknown>;
  error?: string;
}

async function finishFlow(
  prisma: PrismaClient,
  flowRun: FlowRun & { runtime?: RuntimeConnection | null },
  result: FinishResult
): Promise<void> {
  stopFlowSync(flowRun.id);
  const now = new Date();

  let artifacts: unknown[] = [];
  let logs = '';
  if (flowRun.runtime) {
    const client = createRuntimeClient(flowRun.runtime);
    try {
      artifacts = await client.listRunArtifacts(flowRun.externalRunId);
    } catch (err) {
      console.warn(`flow ${flowRun.id}: artifact fetch failed:`, err instanceof Error ? err.message : String(err));
    }
    try {
      logs = await client.getRunLogs(flowRun.externalRunId);
    } catch {
      // Logs are best-effort.
    }
  }

  const succeeded = result.status === 'SUCCEEDED';
  const cancelled = result.status === 'CANCELLED';
  const summary = JSON.stringify({
    runtime: 'cuttlefish',
    runId: flowRun.externalRunId,
    workflow: flowRun.workflowName,
    status: result.status,
    outputs: result.outputs ?? null,
    artifacts: artifacts.map((a) => {
      if (a && typeof a === 'object' && 'name' in a) return (a as { name?: unknown }).name;
      if (a && typeof a === 'object' && 'path' in a) return (a as { path?: unknown }).path;
      return a;
    }),
  });

  await prisma.flowRun.update({
    where: { id: flowRun.id },
    data: {
      status: result.status,
      outputs: result.outputs ? JSON.stringify(result.outputs) : undefined,
      artifacts: artifacts.length > 0 ? JSON.stringify(artifacts) : undefined,
      error: result.error ?? null,
      completedAt: now,
      lastSyncedAt: now,
    },
  });

  // Close the distributed `flow.run` span with terminal status and counts.
  const flowSpan = activeFlowSpans.get(flowRun.id);
  if (flowSpan) {
    flowSpan.setAttributes({
      'omega.flow.status': result.status,
      'omega.flow.artifacts': artifacts.length,
      'omega.flow.duration_ms': now.getTime() - flowRun.createdAt.getTime(),
    });
    flowSpan.addEvent('cuttlefish.run.finished', {
      status: result.status,
      error: result.error ?? '',
    });
    flowSpan.setStatus({
      code: succeeded ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: result.error,
    });
    flowSpan.end();
    activeFlowSpans.delete(flowRun.id);
  }

  if (!flowRun.taskId) return;

  const task = await prisma.task.findUnique({ where: { id: flowRun.taskId } });
  if (task && !isTerminalFlowStatus(task.status)) {
    if (succeeded) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'done', result: summary, error: null },
      });
    } else if (cancelled) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'failed', error: 'Cancelled', result: summary },
      });
    } else {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          error: result.error ?? `Cuttlefish run ${result.status}`,
          result: summary,
        },
      });
    }
  }

  await prisma.taskStep.updateMany({
    where: { taskId: flowRun.taskId, name: flowStepName(flowRun) },
    data: {
      status: succeeded ? 'done' : 'failed',
      output: summary,
      error: succeeded ? null : result.error ?? result.status,
    },
  });

  const tail = logs.trim().split('\n').slice(-8).join('\n');
  await prisma.taskTrace.create({
    data: {
      taskId: flowRun.taskId,
      role: 'tool',
      content: `Cuttlefish run ${result.status}: ${result.error ?? runReason(result.outputs)}
${tail ? `\nLast logs:\n${tail}` : ''}`.trim(),
    },
  });
}

function runReason(outputs: Record<string, unknown> | undefined): string {
  if (!outputs) return 'run finished';
  return `outputs=${JSON.stringify(outputs).slice(0, 500)}`;
}

function safeTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

async function upsertNodeStep(
  prisma: PrismaClient,
  taskId: string,
  instance: CuttlefishTaskInstance
): Promise<void> {
  const name = `flow.node.${instance.nodeId}`;
  const status = instance.status === 'SUCCEEDED'
    ? 'done'
    : isTerminalFlowStatus(instance.status)
      ? 'failed'
      : 'running';
  const existing = await prisma.taskStep.findFirst({ where: { taskId, name } });
  if (existing) {
    if (existing.status !== status) {
      await prisma.taskStep.update({
        where: { id: existing.id },
        data: { status, output: JSON.stringify(instance) },
      });
    }
    return;
  }
  const idx = await prisma.taskStep.count({ where: { taskId } });
  await prisma.taskStep.create({
    data: {
      taskId,
      idx,
      name,
      status,
      input: JSON.stringify(instance),
    },
  });
}

async function persistAttemptSpan(
  prisma: PrismaClient,
  taskId: string,
  runId: string,
  attempt: CuttlefishAttempt
): Promise<void> {
  const spanId = `cf-${attempt.id}`;
  const startTime = attempt.startedAt
    ? new Date(attempt.startedAt)
    : new Date(attempt.createdAt ?? Date.now());
  const endRaw = attempt.finishedAt ?? (isTerminalFlowStatus(attempt.status) ? attempt.updatedAt : undefined);
  const endTime = endRaw ? new Date(endRaw) : null;
  const attributes = JSON.stringify({
    attemptNum: attempt.attemptNum,
    runnerId: attempt.runnerId,
    status: attempt.status,
    inputs: attempt.inputs,
    outputs: attempt.outputs,
    error: attempt.error,
  });
  const status = attempt.status === 'FAILED' ? 'error' : 'ok';

  const existing = await prisma.traceSpan.findFirst({
    where: { taskId, spanId },
    select: { id: true },
  });
  if (existing) {
    // The first sync usually sees the attempt while it is still queued; update
    // it once it reaches a terminal status so the trace has real timing.
    if (isTerminalFlowStatus(attempt.status)) {
      await prisma.traceSpan.update({
        where: { id: existing.id },
        data: { endTime, status, attributes },
      });
    }
    return;
  }

  await prisma.traceSpan.create({
    data: {
      traceId: `cf-${runId}`,
      spanId,
      parentId: null,
      taskId,
      name: `flow.node.${attempt.nodeId}`,
      startTime,
      endTime,
      status,
      attributes,
      events: JSON.stringify([]),
    },
  });
}

/**
 * Cancels the active flow run for a task (if any) and marks the task failed.
 * Returns false when the task has no non-terminal flow run.
 */
export async function cancelTaskFlow(
  prisma: PrismaClient,
  taskId: string,
  options: { reason?: string } = {}
): Promise<boolean> {
  if (!taskId) return false;
  const flowRun = await prisma.flowRun.findFirst({
    where: { taskId, status: { notIn: [...TERMINAL_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    include: { runtime: true },
  });
  if (!flowRun) return false;

  stopFlowSync(flowRun.id);
  if (flowRun.runtime) {
    try {
      const client = createRuntimeClient(flowRun.runtime);
      await client.cancelRun(flowRun.externalRunId);
    } catch (err) {
      console.error(
        `flow ${flowRun.id}: cuttlefish cancel failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const reason = options.reason ?? 'Cancelled by user';
  const now = new Date();
  await prisma.flowRun.update({
    where: { id: flowRun.id },
    data: { status: 'CANCELLED', completedAt: now, lastSyncedAt: now, error: reason },
  });

  const flowSpan = activeFlowSpans.get(flowRun.id);
  if (flowSpan) {
    flowSpan.setAttribute('omega.flow.status', 'CANCELLED');
    flowSpan.addEvent('cuttlefish.run.cancelled', { reason });
    flowSpan.setStatus({ code: SpanStatusCode.ERROR, message: reason });
    flowSpan.end();
    activeFlowSpans.delete(flowRun.id);
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'failed', error: reason, result: reason },
  });
  await prisma.taskStep.updateMany({
    where: { taskId },
    data: { status: 'failed', error: reason },
  });
  return true;
}
