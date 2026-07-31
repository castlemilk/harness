import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { omegaReportsDir } from '@omega/core';
import { asyncHandler } from '../lib/async-handler.js';

const root = process.cwd();
const reportsDir = omegaReportsDir();
const statusFile = path.join(omegaReportsDir(), 'bench-run-status.json');

const runSchema = z.object({
  suite: z.enum(['synthetic', 'fast', 'deep-swe']).optional(),
  nTasks: z.number().int().positive().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  timeout: z.number().int().positive().optional(),
});

interface RunStatus {
  running: boolean;
  pid?: number;
  output?: string;
}

interface BenchmarkResultData {
  task: { id: string; name: string };
  durationMs: number;
  evaluation: { passed: boolean; score?: number };
  agentRun?: { totalTokens?: number };
}

interface BenchmarkReportData {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  results: BenchmarkResultData[];
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readStatus(): Promise<RunStatus> {
  try {
    const raw = await fs.readFile(statusFile, 'utf-8');
    const status = JSON.parse(raw) as RunStatus;
    if (status.running && typeof status.pid === 'number' && !isPidAlive(status.pid)) {
      // Stale status: the recorded process is gone (e.g. server restarted
      // while a run was in flight). Clear it so new runs are not blocked.
      const cleared: RunStatus = { running: false, output: status.output };
      await writeStatus(cleared);
      return cleared;
    }
    return status;
  } catch {
    return { running: false };
  }
}

async function writeStatus(status: RunStatus): Promise<void> {
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(statusFile, JSON.stringify(status, null, 2), 'utf-8');
}

function isReportFile(name: string, prefix: string): boolean {
  return name.startsWith(prefix) && name.endsWith('.json');
}

async function listReports(prefix: string): Promise<string[]> {
  try {
    const files = await fs.readdir(reportsDir);
    return files
      .filter((f) => isReportFile(f, prefix))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function benchmarkRoutes(_prisma: PrismaClient): Router {
  const r = Router();

  r.get('/reports', asyncHandler(async (_req, res) => {
    const [benchmark, ab] = await Promise.all([
      listReports('benchmark-'),
      listReports('ab-'),
    ]);
    res.json({ benchmark, ab });
  }));

  r.get('/reports/:file', asyncHandler(async (req, res) => {
    const file = req.params.file;
    if (!isReportFile(file, 'benchmark-') && !isReportFile(file, 'ab-')) {
      res.status(400).json({ error: 'Invalid report file' });
      return;
    }
    const filePath = path.join(reportsDir, file);
    const resolved = path.resolve(filePath);
    const resolvedReportsDir = path.resolve(reportsDir);
    if (!resolved.startsWith(resolvedReportsDir + path.sep)) {
      res.status(400).json({ error: 'Invalid report path' });
      return;
    }
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as unknown;
      res.json(data);
    } catch {
      res.status(404).json({ error: 'Report not found' });
    }
  }));

  r.post('/run', asyncHandler(async (req, res) => {
    const body = runSchema.parse(req.body);
    const status = await readStatus();
    if (status.running) {
      res.status(409).json({ error: 'Benchmark run already in progress', pid: status.pid });
      return;
    }

    const args = ['apps/cli/dist/index.js', 'bench', 'run'];
    if (body.suite) {
      args.push('--suite', body.suite);
    }
    if (body.nTasks) {
      args.push('--n-tasks', String(body.nTasks));
    }
    if (body.timeout) {
      args.push('--timeout', String(body.timeout));
    }
    if (body.provider) {
      args.push('--provider', body.provider);
    }
    if (body.model) {
      args.push('--model', body.model);
    }

    const child = spawn('node', args, {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const MAX_OUTPUT = 1_000_000; // 1MB cap to prevent memory exhaustion
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString();
    });

    child.on('exit', () => {
      void (async () => {
        const current = await readStatus();
        if (current.pid === child.pid) {
          await writeStatus({ running: false, output });
        }
      })();
    });

    child.unref();

    await writeStatus({ running: true, pid: child.pid, output: '' });
    res.status(202).json({ pid: child.pid, status: 'started' });
  }));

  r.get('/run-status', asyncHandler(async (_req, res) => {
    const status = await readStatus();
    res.json(status);
  }));

  const baselineFile = 'benchmark-baseline.json';
  const baselinePath = path.join(reportsDir, baselineFile);

  async function readReport(file: string): Promise<BenchmarkReportData | undefined> {
    try {
      const raw = await fs.readFile(path.join(reportsDir, file), 'utf-8');
      return JSON.parse(raw) as BenchmarkReportData;
    } catch {
      return undefined;
    }
  }

  function resolveReportFile(file: string): string | undefined {
    if (!isReportFile(file, 'benchmark-') || file.includes('/') || file.includes('\\')) {
      return undefined;
    }
    const resolved = path.resolve(reportsDir, file);
    if (!resolved.startsWith(path.resolve(reportsDir) + path.sep)) {
      return undefined;
    }
    return file;
  }

  r.get('/baseline', asyncHandler(async (_req, res) => {
    const report = await readReport(baselineFile);
    if (!report) {
      res.json({ file: null });
      return;
    }
    res.json({ file: baselineFile, report });
  }));

  r.post('/baseline', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { file?: string };
    let file = body.file;
    if (file) {
      if (!resolveReportFile(file)) {
        res.status(400).json({ error: 'Invalid report file' });
        return;
      }
    } else {
      const reports = await listReports('benchmark-');
      file = reports.find((f) => f !== baselineFile);
      if (!file) {
        res.status(404).json({ error: 'No benchmark report found to use as baseline' });
        return;
      }
    }
    const report = await readReport(file);
    if (!report) {
      res.status(404).json({ error: `Report not found: ${file}` });
      return;
    }
    await fs.mkdir(reportsDir, { recursive: true });
    await fs.writeFile(baselinePath, JSON.stringify(report, null, 2), 'utf-8');
    res.json({ file: baselineFile, report });
  }));

  r.get('/baseline/compare', asyncHandler(async (req, res) => {
    const baseline = await readReport(baselineFile);
    if (!baseline) {
      res.status(404).json({ error: 'No baseline set. POST /benchmarks/baseline first.' });
      return;
    }

    let candidateFile = typeof req.query.candidate === 'string' ? req.query.candidate : undefined;
    if (candidateFile) {
      if (!resolveReportFile(candidateFile)) {
        res.status(400).json({ error: 'Invalid candidate report file' });
        return;
      }
    } else {
      const reports = await listReports('benchmark-');
      candidateFile = reports.find((f) => f !== baselineFile);
      if (!candidateFile) {
        res.status(404).json({ error: 'No benchmark report found to compare' });
        return;
      }
    }
    const candidate = await readReport(candidateFile);
    if (!candidate) {
      res.status(404).json({ error: `Report not found: ${candidateFile}` });
      return;
    }

    const taskKey = (result: BenchmarkResultData): string => result.task.id || result.task.name;
    const baselineByTask = new Map(baseline.results.map((r) => [taskKey(r), r]));
    const candidateByTask = new Map(candidate.results.map((r) => [taskKey(r), r]));

    const regressions: string[] = [];
    const improvements: string[] = [];
    const results: {
      taskId: string;
      taskName: string;
      baselinePassed: boolean;
      candidatePassed: boolean;
      baselineScore?: number;
      candidateScore?: number;
      durationDeltaMs?: number;
      tokenDelta?: number;
    }[] = [];

    for (const [key, candidateResult] of candidateByTask) {
      const baselineResult = baselineByTask.get(key);
      const baselinePassed = baselineResult?.evaluation.passed ?? false;
      const candidatePassed = candidateResult.evaluation.passed;
      if (baselinePassed && !candidatePassed) regressions.push(key);
      if (!baselinePassed && candidatePassed) improvements.push(key);
      const baselineTokens = baselineResult?.agentRun?.totalTokens;
      const candidateTokens = candidateResult.agentRun?.totalTokens;
      results.push({
        taskId: candidateResult.task.id,
        taskName: candidateResult.task.name,
        baselinePassed,
        candidatePassed,
        baselineScore: baselineResult?.evaluation.score,
        candidateScore: candidateResult.evaluation.score,
        durationDeltaMs: baselineResult ? candidateResult.durationMs - baselineResult.durationMs : undefined,
        tokenDelta:
          typeof baselineTokens === 'number' && typeof candidateTokens === 'number'
            ? candidateTokens - baselineTokens
            : undefined,
      });
    }

    const passRate = (report: BenchmarkReportData): number =>
      report.total > 0 ? report.passed / report.total : 0;

    res.json({
      baseline: { file: baselineFile, timestamp: baseline.timestamp },
      candidate: { file: candidateFile, timestamp: candidate.timestamp },
      summary: {
        passedDelta: candidate.passed - baseline.passed,
        failedDelta: candidate.failed - baseline.failed,
        passRateBaseline: passRate(baseline),
        passRateCandidate: passRate(candidate),
        regressions,
        improvements,
      },
      results,
    });
  }));

  return r;
}
