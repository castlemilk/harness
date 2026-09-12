import { Router } from 'express';
import type { Prisma, PrismaClient } from '@omega/db';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';
import { createRuntimeClient } from '../lib/runtime-connections.js';
import { startTaskFlow } from '../lib/cuttlefish-run.js';
import { buildFlowTrace } from '../lib/observability.js';
import { safeJsonParse } from '../lib/utils.js';

const connectionSchema = z.object({
  name: z.string().min(1).max(100),
  projectId: z.string().uuid().nullish(),
  kind: z.enum(['cuttlefish']).default('cuttlefish'),
  baseUrl: z.string().url(),
  apiToken: z.string().max(1000).nullish(),
  externalProjectId: z.string().max(200).nullish(),
  defaultWorkflowVersionId: z.string().max(100).nullish(),
  workflowTemplate: z.string().max(200_000).nullish(),
  nodeImage: z.string().max(300).nullish(),
  nodeCommand: z.string().max(50_000).nullish(),
  nodeTimeout: z.string().max(50).nullish(),
  nodeRetries: z.number().int().min(0).max(10).nullish(),
  runnerPool: z.string().max(200).nullish(),
  runnerLabels: z.record(z.string()).nullish(),
  runnerCapabilities: z.array(z.string().max(100)).nullish(),
  dispatchMode: z.enum(['manual', 'autopilot']).nullish(),
  intentProfile: z.enum(['balanced', 'low_latency', 'high_capacity']).nullish(),
  candidateLimit: z.number().int().min(1).max(100).nullish(),
  baseInputs: z.record(z.unknown()).nullish(),
  autoRoute: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

type ConnectionInput = z.infer<typeof connectionSchema>;

function serializeConnectionInput(body: Partial<ConnectionInput>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body) as [string, unknown][]) {
    if (value === undefined) continue;
    if (key === 'runnerLabels' || key === 'runnerCapabilities' || key === 'baseInputs') {
      data[key] = value === null ? null : JSON.stringify(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}

function sanitizeConnection<T extends { apiToken?: string | null }>(connection: T): T {
  return { ...connection, apiToken: connection.apiToken ? '***' : null };
}

export function runtimeRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', asyncHandler(async (_req, res) => {
    const connections = await prisma.runtimeConnection.findMany({
      orderBy: { createdAt: 'asc' },
      include: { project: { select: { id: true, name: true } } },
    });
    res.json({ runtimes: connections.map(sanitizeConnection) });
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const body = connectionSchema.parse(req.body);
    const existing = await prisma.runtimeConnection.findUnique({ where: { name: body.name } });
    if (existing) {
      res.status(409).json({ error: `Runtime connection "${body.name}" already exists` });
      return;
    }
    const connection = await prisma.runtimeConnection.create({
      data: serializeConnectionInput(body) as Prisma.RuntimeConnectionUncheckedCreateInput,
    });
    res.status(201).json(sanitizeConnection(connection));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const connection = await prisma.runtimeConnection.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!connection) {
      res.status(404).json({ error: 'Runtime connection not found' });
      return;
    }
    res.json(sanitizeConnection(connection));
  }));

  r.patch('/:id', asyncHandler(async (req, res) => {
    const body = connectionSchema.partial().parse(req.body);
    const connection = await prisma.runtimeConnection.update({
      where: { id: req.params.id },
      data: serializeConnectionInput(body),
    });
    res.json(sanitizeConnection(connection));
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    await prisma.runtimeConnection.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }));

  r.post('/:id/health', asyncHandler(async (req, res) => {
    const connection = await prisma.runtimeConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) {
      res.status(404).json({ error: 'Runtime connection not found' });
      return;
    }
    const client = createRuntimeClient(connection);
    const started = Date.now();
    const ok = await client.health();
    const status = ok ? 'ok' : 'unreachable';
    const updated = await prisma.runtimeConnection.update({
      where: { id: connection.id },
      data: { lastHealthStatus: status, lastHealthAt: new Date() },
    });
    res.json({ ok, status, latencyMs: Date.now() - started, connection: sanitizeConnection(updated) });
  }));

  r.get('/:id/workflows', asyncHandler(async (req, res) => {
    const connection = await prisma.runtimeConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) {
      res.status(404).json({ error: 'Runtime connection not found' });
      return;
    }
    const client = createRuntimeClient(connection);
    const workflows = await client.listWorkflows();
    res.json({ workflows });
  }));

  r.get('/:id/runners', asyncHandler(async (req, res) => {
    const connection = await prisma.runtimeConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) {
      res.status(404).json({ error: 'Runtime connection not found' });
      return;
    }
    const client = createRuntimeClient(connection);
    const runners = await client.listRunners();
    res.json({ runners });
  }));

  r.post('/:id/validate', asyncHandler(async (req, res) => {
    const body = z.object({ workflowYAML: z.string().min(1) }).parse(req.body);
    const connection = await prisma.runtimeConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) {
      res.status(404).json({ error: 'Runtime connection not found' });
      return;
    }
    const client = createRuntimeClient(connection);
    const issues = await client.validateWorkflow(body.workflowYAML);
    res.json({ issues });
  }));

  /**
   * Create-or-update a workflow on the runtime and (by default) publish it.
   * This is how the harness manages the workflows tasks reference with
   * `flow:<name>`.
   */
  r.post('/:id/workflows', asyncHandler(async (req, res) => {
    const body = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(1000).optional(),
      workflowYAML: z.string().min(1).max(500_000),
      updateExisting: z.boolean().optional().default(true),
      publish: z.boolean().optional().default(true),
    }).parse(req.body);
    const connection = await prisma.runtimeConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) {
      res.status(404).json({ error: 'Runtime connection not found' });
      return;
    }
    const client = createRuntimeClient(connection);
    const issues = await client.validateWorkflow(body.workflowYAML);
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      res.status(400).json({ error: 'Workflow validation failed', issues: errors });
      return;
    }

    let workflow = await client.resolveWorkflow(body.name);
    let created = false;
    if (workflow) {
      if (!body.updateExisting) {
        res.status(409).json({ error: `Workflow "${body.name}" already exists`, workflowId: workflow.id });
        return;
      }
      await client.updateWorkflowDraft(workflow.id, body.workflowYAML);
    } else {
      workflow = await client.createWorkflow({
        name: body.name,
        description: body.description,
        draftYAML: body.workflowYAML,
      });
      created = true;
    }

    if (!body.publish) {
      res.status(created ? 201 : 200).json({ workflow, published: false, issues });
      return;
    }
    const workflowVersion = await client.publishWorkflow(workflow.id);
    res.status(created ? 201 : 200).json({
      workflow,
      workflowVersion,
      published: true,
      created,
      issues,
    });
  }));

  r.post('/:id/runs', asyncHandler(async (req, res) => {
    const body = z.object({
      taskId: z.string().min(1),
      workflow: z.string().max(200).optional(),
      workflowVersionId: z.string().max(100).optional(),
    }).parse(req.body);
    const connection = await prisma.runtimeConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) {
      res.status(404).json({ error: 'Runtime connection not found' });
      return;
    }
    const task = await prisma.task.findUnique({ where: { id: body.taskId } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const { flowRun } = await startTaskFlow(prisma, task.id, {
      connection,
      workflowName: body.workflow,
      workflowVersionId: body.workflowVersionId ?? connection.defaultWorkflowVersionId ?? undefined,
    });
    res.status(202).json({ flowRun });
  }));

  return r;
}

export function flowRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 500);
    const flows = await prisma.flowRun.findMany({
      where: {
        ...(taskId ? { taskId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        runtime: { select: { id: true, name: true, baseUrl: true } },
        task: { select: { id: true, title: true, status: true } },
      },
    });
    res.json({ flows, total: flows.length });
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const flow = await prisma.flowRun.findUnique({
      where: { id: req.params.id },
      include: {
        runtime: { select: { id: true, name: true, baseUrl: true } },
        task: { select: { id: true, title: true, status: true } },
      },
    });
    if (!flow) {
      res.status(404).json({ error: 'Flow run not found' });
      return;
    }
    res.json({ flow: decodeFlowJson(flow) });
  }));

  r.get('/:id/run', asyncHandler(async (req, res) => {
    const flow = await prisma.flowRun.findUnique({
      where: { id: req.params.id },
      include: { runtime: true },
    });
    if (!flow?.runtime) {
      res.status(404).json({ error: 'Flow run or runtime not found' });
      return;
    }
    const client = createRuntimeClient(flow.runtime);
    const detail = await client.getRun(flow.externalRunId);
    if (!detail) {
      res.status(404).json({ error: 'Cuttlefish run not found' });
      return;
    }
    res.json(detail);
  }));

  /**
   * Distributed trace for a flow: Tempo spans (harness + cuttlefish) plus the
   * harness database spans and the cuttlefish runner history trace.
   */
  r.get('/:id/trace', asyncHandler(async (req, res) => {
    const result = await buildFlowTrace(prisma, req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Flow run not found' });
      return;
    }
    res.json({
      flowId: result.flowId,
      traceId: result.traceId,
      source: result.source,
      trace: result.trace,
      databaseSpans: result.databaseSpans,
      runnerTrace: result.runnerTrace,
      flow: result.flow,
    });
  }));

  r.get('/:id/events', asyncHandler(async (req, res) => {
    const flow = await prisma.flowRun.findUnique({
      where: { id: req.params.id },
      include: { runtime: true },
    });
    if (!flow?.runtime) {
      res.status(404).json({ error: 'Flow run or runtime not found' });
      return;
    }
    const client = createRuntimeClient(flow.runtime);
    const events = await client.listRunEvents(flow.externalRunId);
    res.json({ events });
  }));

  r.get('/:id/artifacts', asyncHandler(async (req, res) => {
    const flow = await prisma.flowRun.findUnique({
      where: { id: req.params.id },
      include: { runtime: true },
    });
    if (!flow?.runtime) {
      res.status(404).json({ error: 'Flow run or runtime not found' });
      return;
    }
    const client = createRuntimeClient(flow.runtime);
    const artifacts = await client.listRunArtifacts(flow.externalRunId);
    res.json({ artifacts });
  }));

  r.get('/:id/logs', asyncHandler(async (req, res) => {
    const flow = await prisma.flowRun.findUnique({
      where: { id: req.params.id },
      include: { runtime: true },
    });
    if (!flow?.runtime) {
      res.status(404).json({ error: 'Flow run or runtime not found' });
      return;
    }
    const client = createRuntimeClient(flow.runtime);
    const logs = await client.getRunLogs(flow.externalRunId);
    res.json({ logs });
  }));

  r.post('/:id/cancel', asyncHandler(async (req, res) => {
    const flow = await prisma.flowRun.findUnique({
      where: { id: req.params.id },
      include: { runtime: true },
    });
    if (!flow) {
      res.status(404).json({ error: 'Flow run not found' });
      return;
    }
    if (flow.runtime) {
      const client = createRuntimeClient(flow.runtime);
      try {
        await client.cancelRun(flow.externalRunId);
      } catch (err) {
        console.error('cuttlefish cancel failed:', err instanceof Error ? err.message : String(err));
      }
    }
    const updated = await prisma.flowRun.update({
      where: { id: flow.id },
      data: { status: 'CANCELLED', completedAt: new Date(), lastSyncedAt: new Date() },
    });
    if (flow.taskId) {
      await prisma.task.update({
        where: { id: flow.taskId },
        data: { status: 'failed', error: 'Cancelled', result: 'Cancelled' },
      });
    }
    res.status(202).json({ flow: updated, cancelled: true });
  }));

  return r;
}

function decodeFlowJson<T extends { inputs: string | null; outputs: string | null; artifacts: string | null }>(
  flow: T
): T & { inputs: unknown; outputs: unknown; artifacts: unknown } {
  return {
    ...flow,
    inputs: safeJsonParse(flow.inputs, null),
    outputs: safeJsonParse(flow.outputs, null),
    artifacts: safeJsonParse(flow.artifacts, null),
  };
}
