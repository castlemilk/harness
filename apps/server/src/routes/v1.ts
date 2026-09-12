import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { asyncHandler } from '../lib/async-handler.js';
import { projectRoutes } from './projects.js';
import { taskRoutes } from './tasks.js';
import { providerRoutes } from './providers.js';
import { routerRoutes } from './router.js';
import { traceRoutes } from './traces.js';
import { runtimeRoutes, flowRoutes } from './runtime.js';
import { observabilityRoutes } from './observability.js';

const HARNESS_VERSION = '0.6.11';

/**
 * Versioned "agents API" surface. Resources mirror OpenAI's Agents API
 * vocabulary (agents, runs, steps, events) while keeping harness-native names
 * as aliases (tasks, traces, flows). Existing unversioned routes stay for the
 * web UI; `/v1` is the stable surface for external clients and MCP.
 */
export function v1Routes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json({
      object: 'harness',
      apiVersion: 'v1',
      harnessVersion: HARNESS_VERSION,
      resources: ['projects', 'tasks', 'runs', 'runtimes', 'flows', 'providers', 'router', 'traces'],
      executionModes: ['provider', 'agent', 'orchestrate', 'external', 'cuttlefish'],
      endpoints: {
        mcp: '/mcp',
        taskStream: '/v1/tasks/{id}/stream',
        taskRun: 'POST /v1/tasks/{id}/run',
        runtimes: '/v1/runtimes',
        flows: '/v1/flows',
      },
    });
  });

  r.get('/health', asyncHandler(async (_req, res) => {
    let database = 'ok';
    try {
      await prisma.task.count();
    } catch {
      database = 'error';
    }
    res.json({ ok: database === 'ok', database, version: HARNESS_VERSION, uptimeSeconds: Math.round(process.uptime()) });
  }));

  r.use('/projects', projectRoutes(prisma));
  r.use('/tasks', taskRoutes(prisma));
  r.use('/providers', providerRoutes(prisma));
  r.use('/router', routerRoutes(prisma));
  r.use('/traces', traceRoutes());
  r.use('/observability', observabilityRoutes());
  r.use('/runtimes', runtimeRoutes(prisma));
  r.use('/flows', flowRoutes(prisma));

  r.get('/runs', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const tasks = await prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        flowRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
        agentRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    res.json({
      runs: tasks.map((task) => ({
        id: task.id,
        object: 'run',
        kind: 'task',
        status: task.status,
        projectId: task.projectId,
        title: task.title,
        provider: task.provider,
        model: task.model,
        flow: task.flowRuns[0]
          ? { id: task.flowRuns[0].id, status: task.flowRuns[0].status, externalRunId: task.flowRuns[0].externalRunId }
          : null,
        agentRunId: task.agentRuns[0]?.id ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
    });
  }));

  r.get('/runs/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const task = await prisma.task.findFirst({
      where: { OR: [{ id }, { id: { startsWith: id } }] },
      include: {
        agentRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
        flowRuns: { orderBy: { createdAt: 'desc' } },
        steps: { orderBy: { idx: 'asc' } },
      },
    });
    if (task) {
      res.json({
        id: task.id,
        object: 'run',
        kind: 'task',
        status: task.status,
        task,
        agentRun: task.agentRuns[0] ?? null,
        flows: task.flowRuns,
        steps: task.steps,
      });
      return;
    }
    const flow = await prisma.flowRun.findFirst({
      where: { OR: [{ id }, { externalRunId: id }] },
      include: { task: true, runtime: { select: { id: true, name: true, baseUrl: true } } },
    });
    if (flow) {
      res.json({
        id: flow.id,
        object: 'run',
        kind: 'flow',
        status: flow.status,
        flow,
        task: flow.task,
      });
      return;
    }
    res.status(404).json({ error: 'Run not found' });
  }));

  return r;
}
