import { Router } from 'express';
import type { PrismaClient } from '@omega/db';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { asyncHandler } from '../lib/async-handler.js';

const root = process.cwd();
const reportsDir = path.join(root, '.omega', 'reports');
const statusFile = path.join(root, '.omega', 'bench-run-status.json');

const runSchema = z.object({
  suite: z.enum(['synthetic', 'deep-swe']).optional(),
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

async function readStatus(): Promise<RunStatus> {
  try {
    const raw = await fs.readFile(statusFile, 'utf-8');
    return JSON.parse(raw) as RunStatus;
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
    if (!resolved.startsWith(resolvedReportsDir + path.sep) && resolved !== resolvedReportsDir) {
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
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
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

  return r;
}
