import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { runTask } from '../lib/run-task.js';
import { getNextStrategy, executeRetry, type RetryContext, type RetryRecord } from '../lib/retry-strategies.js';
import { asyncHandler } from '../lib/async-handler.js';
import { safeJsonParse } from '../lib/utils.js';

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(100_000).optional(),
  complexity: z.enum(['simple', 'medium', 'complex']).default('simple'),
  tags: z.array(z.string().max(200)).max(20).default([]),
});

const updateSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done', 'failed']).optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(100_000).optional(),
  complexity: z.enum(['simple', 'medium', 'complex']).optional(),
  tags: z.array(z.string().max(200)).max(20).optional(),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
});

const runSchema = z.object({
  tokenBudget: z.number().optional(),
  maxSubtasks: z.number().int().min(1).max(20).optional(),
  maxIterations: z.number().int().min(1).max(10).optional(),
  concurrency: z.number().int().min(1).max(5).optional(),
});

async function resolveTaskId(prisma: PrismaClient, partial: string): Promise<string | null> {
  if (partial.length === 36) return partial;
  const matches = await prisma.task.findMany({
    where: { id: { startsWith: partial } },
    select: { id: true },
    take: 2,
  });
  if (matches.length !== 1) return null;
  return matches[0] === undefined ? null : matches[0].id;
}

export function taskRoutes(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where: projectId ? { projectId } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.task.count({ where: projectId ? { projectId } : undefined }),
    ]);
    res.json({ tasks, total, limit, offset });
  }));

  r.get('/stream', asyncHandler(async (_req, res) => {
    // Snapshot current task updatedAt values before opening the stream so
    // errors here still surface through the JSON error handler.
    const initial = await prisma.task.findMany();
    const lastUpdated = new Map<string, number>(initial.map((t) => [t.id, t.updatedAt.getTime()]));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      res.end();
    };

    const tick = async (): Promise<void> => {
      if (closed) return;
      try {
        const tasks = await prisma.task.findMany();
        for (const task of tasks) {
          const updated = task.updatedAt.getTime();
          if (lastUpdated.get(task.id) !== updated) {
            lastUpdated.set(task.id, updated);
            send('task', {
              id: task.id,
              status: task.status,
              result: task.result ?? undefined,
              error: task.error ?? undefined,
              provider: task.provider ?? undefined,
              model: task.model ?? undefined,
            });
          }
        }
      } catch (err) {
        console.error('SSE task stream poll error', err);
      }
    };

    const poll = setInterval(() => {
      void tick();
    }, 1000);
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);
    _req.on('close', close);
  }));

  r.get('/:id/stream', asyncHandler(async (req, res) => {
    const taskId = await resolveTaskId(prisma, req.params.id);
    if (!taskId) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const [traces, spans, diffs, agentRun] = await Promise.all([
      prisma.taskTrace.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }),
      prisma.traceSpan.findMany({ where: { taskId }, orderBy: { startTime: 'asc' } }),
      prisma.taskDiff.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }),
      prisma.agentRun.findFirst({ where: { taskId }, orderBy: { createdAt: 'desc' } }),
    ]);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const seenTraces = new Set<string>(traces.map((t) => t.id));
    const seenSpans = new Set<string>(spans.map((s) => s.id));
    const seenDiffs = new Set<string>(diffs.map((d) => d.id));
    let lastTaskUpdated = task.updatedAt.getTime();
    let lastRunKey = agentRun
      ? `${agentRun.resultStatus}:${String(agentRun.totalTokens ?? '')}:${String(agentRun.updatedAt.getTime())}`
      : '';

    send('init', {
      task: {
        id: task.id,
        status: task.status,
        result: task.result ?? undefined,
        error: task.error ?? undefined,
        provider: task.provider ?? undefined,
        model: task.model ?? undefined,
      },
      traces,
      spans,
      diffs,
      agentRun,
    });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      res.end();
    };

    const tick = async (): Promise<void> => {
      if (closed) return;
      try {
        const [current, newTraces, newSpans, newDiffs, run] = await Promise.all([
          prisma.task.findUnique({ where: { id: taskId } }),
          prisma.taskTrace.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }),
          prisma.traceSpan.findMany({ where: { taskId }, orderBy: { startTime: 'asc' } }),
          prisma.taskDiff.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }),
          prisma.agentRun.findFirst({ where: { taskId }, orderBy: { createdAt: 'desc' } }),
        ]);

        for (const trace of newTraces) {
          if (seenTraces.has(trace.id)) continue;
          seenTraces.add(trace.id);
          const toolCalls = safeJsonParse(trace.toolCalls, null);
          send('trace', {
            id: trace.id,
            role: trace.role,
            content: trace.content ?? undefined,
            toolCalls,
            createdAt: trace.createdAt,
            stepId: trace.stepId ?? undefined,
          });
        }

        for (const span of newSpans) {
          if (seenSpans.has(span.id)) continue;
          seenSpans.add(span.id);
          const attributes = safeJsonParse(span.attributes, null);
          const events = safeJsonParse(span.events, null);
          send('span', {
            id: span.id,
            name: span.name,
            spanId: span.spanId,
            parentId: span.parentId ?? undefined,
            startTime: span.startTime,
            endTime: span.endTime ?? undefined,
            status: span.status,
            attributes,
            events,
          });
        }

        for (const diff of newDiffs) {
          if (seenDiffs.has(diff.id)) continue;
          seenDiffs.add(diff.id);
          send('diff', {
            id: diff.id,
            branch: diff.branch,
            patch: diff.patch,
            createdAt: diff.createdAt,
          });
        }

        if (run) {
          const key = `${run.resultStatus}:${String(run.totalTokens ?? '')}:${String(run.updatedAt.getTime())}`;
          if (key !== lastRunKey) {
            lastRunKey = key;
            send('agent-run', {
              id: run.id,
              resultStatus: run.resultStatus,
              branch: run.branch,
              baseCommit: run.baseCommit,
              promptTokens: run.promptTokens ?? undefined,
              completionTokens: run.completionTokens ?? undefined,
              totalTokens: run.totalTokens ?? undefined,
              promptVersionId: run.promptVersionId ?? undefined,
            });
          }
        }

        if (current) {
          const updated = current.updatedAt.getTime();
          if (updated !== lastTaskUpdated) {
            lastTaskUpdated = updated;
            send('task', {
              id: current.id,
              status: current.status,
              result: current.result ?? undefined,
              error: current.error ?? undefined,
              provider: current.provider ?? undefined,
              model: current.model ?? undefined,
            });
          }
          if (current.status === 'done' || current.status === 'failed') {
            send('end', { id: current.id, status: current.status });
            close();
          }
        }
      } catch (err) {
        console.error('SSE task stream poll error', err);
      }
    };

    const poll = setInterval(() => {
      void tick();
    }, 500);
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);
    req.on('close', close);
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const taskId = await resolveTaskId(prisma, req.params.id);
    if (!taskId) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  }));

  r.post('/', asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const task = await prisma.task.create({
      data: {
        projectId: body.projectId,
        title: body.title,
        description: body.description,
        complexity: body.complexity,
        tags: JSON.stringify(body.tags),
      },
    });
    res.status(201).json(task);
  }));

  r.patch('/:id', asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.tags) data.tags = JSON.stringify(body.tags);
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data,
    });
    res.json(task);
  }));

  r.post('/:id/run', asyncHandler(async (req, res) => {
    try {
      const body = runSchema.parse(req.body ?? {});
      const result = await runTask(prisma, req.params.id, {
        detached: true,
        tokenBudget: body.tokenBudget,
        maxSubtasks: body.maxSubtasks,
        maxIterations: body.maxIterations,
        concurrency: body.concurrency,
      });
      res.status(202).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }));

  r.post('/:id/retry', asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    if (task.status !== 'failed') { res.status(400).json({ error: 'Only failed tasks can be retried' }); return; }

    const tags = safeJsonParse<string[]>(task.tags, []);
    const retryHistory = safeJsonParse<RetryRecord[]>(task.retryHistory, []);
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
    if (!attempt) {
      res.status(400).json({ error: 'No more retry strategies available', retryCount: task.retryCount });
      return;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'in_progress', error: null },
    });

    void executeRetry(prisma, task.id, attempt, {
      projectPath: task.project.path,
      projectName: task.project.name,
      autoPublish: tags.includes('publish'),
    });

    res.status(202).json({
      status: 'in_progress',
      strategy: attempt.strategy,
      retryCount: task.retryCount + 1,
    });
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    // Atomic delete: only delete if not in_progress (prevents TOCTOU race)
    const deleted = await prisma.task.deleteMany({
      where: { id: req.params.id, status: { not: 'in_progress' } },
    });
    if (deleted.count === 0) {
      const task = await prisma.task.findUnique({ where: { id: req.params.id } });
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
      } else {
        res.status(409).json({ error: 'Cannot delete task in progress. Cancel it first.' });
      }
      return;
    }
    res.status(204).send();
  }));

  r.get('/:id/steps', asyncHandler(async (req, res) => {
    const steps = await prisma.taskStep.findMany({
      where: { taskId: req.params.id },
      orderBy: { idx: 'asc' },
    });
    res.json(steps);
  }));

  r.get('/:id/traces', asyncHandler(async (req, res) => {
    const traces = await prisma.taskTrace.findMany({
      where: { taskId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(traces);
  }));

  r.get('/:id/diffs', asyncHandler(async (req, res) => {
    const diffs = await prisma.taskDiff.findMany({
      where: { taskId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(diffs);
  }));

  r.get('/:id/agent-run', asyncHandler(async (req, res) => {
    const run = await prisma.agentRun.findFirst({
      where: { taskId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      res.status(404).json({ error: 'Agent run not found' });
      return;
    }
    res.json(run);
  }));

  r.get('/:id/trace-flow', asyncHandler(async (req, res) => {
    const spans = await prisma.traceSpan.findMany({
      where: { taskId: req.params.id },
      orderBy: { startTime: 'asc' },
    });

    const byParent: Record<string, typeof spans> = {};
    for (const span of spans) {
      const parent = span.parentId ?? '__root__';
      byParent[parent] = byParent[parent] ?? [];
      byParent[parent].push(span);
    }

    function buildTree(parentId: string | null, depth = 0): unknown[] {
      if (depth > 50) return []; // prevent infinite recursion from cyclic data
      const key = parentId ?? '__root__';
      const children = byParent[key] ?? [];
      return children.map((s) => {
        const attributes = safeJsonParse(s.attributes, null);
        const events = safeJsonParse(s.events, null);
        return {
          ...s,
          attributes,
          events,
          children: buildTree(s.spanId, depth + 1),
        };
      });
    }

    res.json({
      traceId: spans[0]?.traceId,
      spans: buildTree(null),
    });
  }));

  r.get('/:id/trace-analysis', asyncHandler(async (req, res) => {
    const spans = await prisma.traceSpan.findMany({
      where: { taskId: req.params.id },
      orderBy: { startTime: 'asc' },
    });

    const run = await prisma.agentRun.findFirst({
      where: { taskId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });

    const toolSpans = spans.filter((s) => s.name === 'agent.tool' || s.name.startsWith('agent.tool.'));
    const toolCounts: Record<string, { total: number; success: number; errors: string[] }> = {};
    const errors: { tool?: string; message: string; time: string }[] = [];

    for (const span of toolSpans) {
      const attrs = span.attributes ? safeJsonParse<Record<string, unknown>>(span.attributes, {}) : {};
      const toolName =
        span.name === 'agent.tool'
          ? typeof attrs.tool === 'string'
            ? attrs.tool
            : 'unknown'
          : span.name.slice('agent.tool.'.length);
      const success = span.status !== 'error' && Boolean(attrs.success);
      const entry = toolCounts[toolName] ?? { total: 0, success: 0, errors: [] };
      entry.total++;
      if (success) entry.success++;
      if (span.status === 'error' || !success) {
        const message =
          attrs.error === undefined
            ? 'unknown error'
            : typeof attrs.error === 'string'
              ? attrs.error
              : JSON.stringify(attrs.error);
        entry.errors.push(message);
        errors.push({ tool: toolName, message, time: span.startTime.toISOString() });
      }
      toolCounts[toolName] = entry;
    }

    const firstSpan = spans.at(0);
    const lastSpan = spans.at(-1);
    const totalDurationMs =
      firstSpan && lastSpan
        ? (lastSpan.endTime ?? lastSpan.startTime).getTime() - firstSpan.startTime.getTime()
        : 0;

    const phaseSpans = spans.filter(
      (s) =>
        ['agent.plan', 'provider.send', 'agent.reflect'].includes(s.name) ||
        s.name === 'agent.tool' ||
        s.name.startsWith('agent.tool.')
    );
    const phaseDurations: Record<string, number> = {};
    for (const span of phaseSpans) {
      const duration = (span.endTime ?? span.startTime).getTime() - span.startTime.getTime();
      phaseDurations[span.name] = (phaseDurations[span.name] ?? 0) + duration;
    }

    res.json({
      taskId: req.params.id,
      agentRunId: run?.id,
      totalSpans: spans.length,
      totalDurationMs,
      promptTokens: run?.promptTokens,
      completionTokens: run?.completionTokens,
      totalTokens: run?.totalTokens,
      toolSummary: Object.entries(toolCounts).map(([tool, stats]) => ({
        tool,
        total: stats.total,
        success: stats.success,
        failure: stats.total - stats.success,
        successRate: stats.total > 0 ? Number((stats.success / stats.total).toFixed(2)) : 0,
        sampleErrors: stats.errors.slice(0, 3),
      })),
      topErrors: errors.slice(0, 10),
      phaseDurations,
    });
  }));

  // ─── Replay ───────────────────────────────────────────────────────────────
  // Re-run a completed or failed task with optional provider/model override.
  // Creates a NEW task (original is preserved) and returns the new task + trace.
  const replaySchema = z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    description: z.string().optional(),
  });

  r.post('/:id/replay', asyncHandler(async (req, res) => {
    const original = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });
    if (!original) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const body = replaySchema.parse(req.body);
    const tags = safeJsonParse<string[]>(original.tags, []);
    const replayTags = [...tags.filter((t) => !t.startsWith('replay:')), `replay:of-${original.id.slice(0, 8)}`];

    // When overriding provider, use its default model unless model is also overridden
    let replayModel = body.model ?? original.model;
    if (body.provider && !body.model) {
      const providerConfig = await prisma.providerConfig.findFirst({ where: { name: body.provider } });
      if (providerConfig) replayModel = providerConfig.defaultModel;
    }

    const newTask = await prisma.task.create({
      data: {
        projectId: original.projectId,
        title: original.title,
        description: body.description ?? original.description,
        complexity: original.complexity,
        tags: JSON.stringify(replayTags),
        provider: body.provider ?? original.provider,
        model: replayModel,
        status: 'todo',
      },
    });

    // Run it immediately
    const { runTask } = await import('../lib/run-task.js');
    await runTask(prisma, newTask.id, { detached: false });

    // Fetch the final task state
    const finalTask = await prisma.task.findUnique({ where: { id: newTask.id } });
    const trace = (await import('../lib/trace-log.js')).getTrace(newTask.id);

    res.json({
      original: {
        id: original.id,
        title: original.title,
        provider: original.provider,
        model: original.model,
        status: original.status,
        result: original.result,
        error: original.error,
      },
      replay: finalTask,
      trace: trace ?? null,
    });
  }));

  return r;
}
