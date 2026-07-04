import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { asyncHandler } from '../lib/async-handler.js';

const REPORTS_DIR = path.resolve('.omega/reports');

interface ReportRef {
  file: string;
  type: 'benchmark' | 'ab';
  createdAt: string;
}

async function listReports(): Promise<ReportRef[]> {
  const entries = await fs.readdir(REPORTS_DIR).catch(() => []);
  const files = entries.filter((f) => f.endsWith('.json'));
  const refs: ReportRef[] = [];
  for (const file of files) {
    const type = file.startsWith('ab-') ? 'ab' : file.startsWith('benchmark-') ? 'benchmark' : undefined;
    if (!type) continue;
    const stat = await fs.stat(path.join(REPORTS_DIR, file)).catch(() => undefined);
    refs.push({ file, type, createdAt: stat?.mtime.toISOString() ?? new Date().toISOString() });
  }
  return refs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function reportRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (_req, res) => {
    const refs = await listReports();
    res.json({
      benchmark: refs.filter((r) => r.type === 'benchmark'),
      ab: refs.filter((r) => r.type === 'ab'),
    });
  }));

  r.get('/:file', asyncHandler(async (req, res) => {
    const file = path.basename(req.params.file);
    const filePath = path.join(REPORTS_DIR, file);
    if (!filePath.startsWith(REPORTS_DIR)) {
      res.status(400).json({ error: 'Invalid report file' });
      return;
    }
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
    if (!raw) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json(JSON.parse(raw));
  }));

  return r;
}
