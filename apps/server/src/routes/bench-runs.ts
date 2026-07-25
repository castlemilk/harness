import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import { z } from 'zod';
import { EventEmitter } from 'node:events';
import { startBenchRun, cancelRun, type BenchRunConfig } from '../lib/benchmark-runner.js';
import { asyncHandler } from '../lib/async-handler.js';

const runSchema = z.object({
  suite: z.enum(['synthetic', 'fast', 'harder', 'harder-v2', 'hard-targeting', 'swebench-lite', 'deepswe']),
  models: z.array(z.object({
    provider: z.string(),
    model: z.string(),
  })).optional(),
  strategy: z.enum(['single', 'consensus', 'variance']).default('single'),
  concurrency: z.number().int().min(1).max(10).default(3),
  timeoutMs: z.number().int().positive().default(600_000),
  tokenBudget: z.number().int().positive().optional(),
  projectPrefix: z.string().default('bench'),
  nTasks: z.number().int().positive().optional(),
  taskIds: z.array(z.string()).optional(),
  swebench: z.object({
    datasetPath: z.string().optional(),
    repos: z.array(z.string()).optional(),
    sampleSeed: z.number().optional(),
  }).optional(),
  deepswe: z.object({
    tasksDir: z.string(),
    taskIds: z.array(z.string()).optional(),
    useDocker: z.boolean().optional(),
  }).optional(),
});

// Shared event emitter for all benchmark runs
const runEvents = new EventEmitter();
runEvents.setMaxListeners(100);

export function benchRunRoutes(prisma: PrismaClient): Router {
  const r = Router();

  // Start a new benchmark run
  r.post('/', asyncHandler(async (req, res) => {
    const config: BenchRunConfig = runSchema.parse(req.body);

    // Check if a run is already in progress
    const activeRun = await prisma.benchmarkRun.findFirst({
      where: { status: { in: ['pending', 'running'] } },
    });
    if (activeRun) {
      res.status(409).json({
        error: 'A benchmark run is already in progress',
        activeRunId: activeRun.id,
      });
      return;
    }

    // Create the run record
    const run = await prisma.benchmarkRun.create({
      data: {
        suite: config.suite,
        config: JSON.stringify(config),
        status: 'pending',
      },
    });

    // Start the run in the background
    void startBenchRun(prisma, run.id, config, runEvents);

    res.status(202).json({
      id: run.id,
      status: 'pending',
      suite: config.suite,
    });
  }));

  // List all runs
  r.get('/', asyncHandler(async (req, res) => {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;
    const runs = await prisma.benchmarkRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        suite: true,
        status: true,
        totalTasks: true,
        passed: true,
        failed: true,
        timeouts: true,
        totalDurationMs: true,
        totalCostUsd: true,
        error: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });
    res.json(runs);
  }));

  // Get a specific run
  r.get('/:id', asyncHandler(async (req, res) => {
    const run = await prisma.benchmarkRun.findUnique({
      where: { id: req.params.id },
    });
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json({
      ...run,
      config: JSON.parse(run.config) as BenchRunConfig,
      results: run.results ? JSON.parse(run.results) : null,
    });
  }));

  // Cancel a run
  r.post('/:id/cancel', asyncHandler(async (req, res) => {
    const run = await prisma.benchmarkRun.findUnique({
      where: { id: req.params.id },
    });
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (run.status !== 'pending' && run.status !== 'running') {
      res.status(400).json({ error: `Run is ${run.status}, cannot cancel` });
      return;
    }

    const cancelled = cancelRun(req.params.id);
    await prisma.benchmarkRun.update({
      where: { id: req.params.id },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    res.json({ cancelled });
  }));

  // SSE stream for real-time progress
  r.get('/:id/stream', asyncHandler(async (req, res) => {
    const run = await prisma.benchmarkRun.findUnique({
      where: { id: req.params.id },
    });
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial state
    send('init', {
      id: run.id,
      status: run.status,
      suite: run.suite,
      totalTasks: run.totalTasks,
      passed: run.passed,
      failed: run.failed,
      timeouts: run.timeouts,
    });

    // If already completed, close immediately
    if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
      send('end', { status: run.status });
      res.end();
      return;
    }

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      runEvents.removeListener('run', onEvent);
      clearInterval(heartbeat);
      res.end();
    };

    const onEvent = (event: { runId: string; type: string }) => {
      if (event.runId !== req.params.id) return;
      send(event.type, event);
      if (event.type === 'completed' || event.type === 'failed') {
        close();
      }
    };

    runEvents.on('run', onEvent);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', close);

    // Also poll DB for updates (in case events are missed)
    const poll = setInterval(async () => {
      if (closed) return;
      try {
        const current = await prisma.benchmarkRun.findUnique({
          where: { id: req.params.id },
        });
        if (current && (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled')) {
          send('end', {
            status: current.status,
            passed: current.passed,
            failed: current.failed,
            timeouts: current.timeouts,
            totalDurationMs: current.totalDurationMs,
          });
          close();
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);

    // Clean up poll on close
    req.on('close', () => clearInterval(poll));
  }));

  return r;
}
