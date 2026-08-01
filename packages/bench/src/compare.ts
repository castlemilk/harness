import fs from 'node:fs/promises';
import type { BenchmarkReport, BenchmarkResult } from './types.js';

interface CompareOptions {
  baseline: string; // path to first report JSON
  candidate: string; // path to second report JSON
  taskId?: string; // optional filter to a single task name
}

interface CompareRow {
  task: string;
  baselineStatus: string;
  baselinePass: boolean;
  baselineTokens: number;
  baselinePatchBytes: number;
  baselineWallMs: number;
  candidateStatus: string;
  candidatePass: boolean;
  candidateTokens: number;
  candidatePatchBytes: number;
  candidateWallMs: number;
  passFlip?: 'gained' | 'lost' | 'same';
  tokenDelta?: number;
  wallDeltaMs?: number;
}

async function loadReport(path: string): Promise<BenchmarkReport> {
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw) as BenchmarkReport;
}

function rowFromResult(r: BenchmarkResult, fallbackTokens: number): {
  status: string;
  pass: boolean;
  tokens: number;
  patchBytes: number;
  wallMs: number;
} {
  const patchBytes = r.diffs && r.diffs.length > 0 ? r.diffs.reduce((a, d) => a + d.patch.length, 0) : 0;
  return {
    status: r.status,
    pass: r.evaluation.passed,
    tokens: r.agentRun?.totalTokens ?? fallbackTokens,
    patchBytes,
    wallMs: r.durationMs,
  };
}

function formatNum(n: number | undefined): string {
  if (n === undefined) return '-';
  return n.toLocaleString('en-US');
}

function formatDelta(n: number | undefined, suffix = ''): string {
  if (n === undefined) return '-';
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNum(n)}${suffix}`;
}

export async function compareReports(opts: CompareOptions): Promise<string> {
  const baselineReport = await loadReport(opts.baseline);
  const candidateReport = await loadReport(opts.candidate);

  const baseByName = new Map(baselineReport.results.map((r) => [r.task.name, r]));
  const candByName = new Map(candidateReport.results.map((r) => [r.task.name, r]));
  const names = new Set([...baseByName.keys(), ...candByName.keys()]);
  const filtered = opts.taskId ? [...names].filter((n) => n === opts.taskId) : [...names];

  const rows: CompareRow[] = filtered.map((name) => {
    const b = baseByName.get(name);
    const c = candByName.get(name);
    const baseData = b ? rowFromResult(b, 0) : undefined;
    const candData = c ? rowFromResult(c, 0) : undefined;
    const row: CompareRow = {
      task: name,
      baselineStatus: baseData?.status ?? 'missing',
      baselinePass: baseData?.pass ?? false,
      baselineTokens: baseData?.tokens ?? 0,
      baselinePatchBytes: baseData?.patchBytes ?? 0,
      baselineWallMs: baseData?.wallMs ?? 0,
      candidateStatus: candData?.status ?? 'missing',
      candidatePass: candData?.pass ?? false,
      candidateTokens: candData?.tokens ?? 0,
      candidatePatchBytes: candData?.patchBytes ?? 0,
      candidateWallMs: candData?.wallMs ?? 0,
    };
    if (baseData && candData) {
      row.passFlip = baseData.pass === candData.pass
        ? 'same'
        : candData.pass
          ? 'gained'
          : 'lost';
      row.tokenDelta = candData.tokens - baseData.tokens;
      row.wallDeltaMs = candData.wallMs - baseData.wallMs;
    }
    return row;
  });

  const lines: string[] = [];
  lines.push(`# Bench report comparison`);
  lines.push('');
  lines.push(`Baseline:  ${opts.baseline}`);
  lines.push(`Candidate: ${opts.candidate}`);
  if (opts.taskId) lines.push(`Filter:    ${opts.taskId}`);
  lines.push('');

  // Aggregate stats
  const basePass = rows.filter((r) => r.baselinePass).length;
  const candPass = rows.filter((r) => r.candidatePass).length;
  const baseTokens = rows.reduce((a, r) => a + r.baselineTokens, 0);
  const candTokens = rows.reduce((a, r) => a + r.candidateTokens, 0);
  const gained = rows.filter((r) => r.passFlip === 'gained').length;
  const lost = rows.filter((r) => r.passFlip === 'lost').length;
  const same = rows.filter((r) => r.passFlip === 'same').length;

  lines.push(`Pass rate: baseline ${String(basePass)}/${String(rows.length)} → candidate ${String(candPass)}/${String(rows.length)} (gained ${String(gained)}, lost ${String(lost)}, same ${String(same)})`);
  lines.push(`Tokens:    baseline ${formatNum(baseTokens)} → candidate ${formatNum(candTokens)} (delta ${formatDelta(candTokens - baseTokens)})`);
  lines.push('');

  // Per-task table
  const headers = ['task', 'b_status', 'b_pass', 'b_tokens', 'b_patch', 'c_status', 'c_pass', 'c_tokens', 'c_patch', 'flip', 'tok_delta', 'wall_delta_s'];
  const widths = headers.map((h) => h.length);
  const cells = rows.map((r) => [
    r.task,
    r.baselineStatus,
    r.baselinePass ? 'PASS' : 'fail',
    formatNum(r.baselineTokens),
    formatNum(r.baselinePatchBytes),
    r.candidateStatus,
    r.candidatePass ? 'PASS' : 'fail',
    formatNum(r.candidateTokens),
    formatNum(r.candidatePatchBytes),
    r.passFlip ?? '-',
    formatDelta(r.tokenDelta),
    formatDelta(r.wallDeltaMs !== undefined ? Math.round(r.wallDeltaMs / 1000) : undefined, 's'),
  ]);
  for (let i = 0; i < headers.length; i++) {
    widths[i] = Math.max(widths[i], ...cells.map((row) => (row[i] ?? '').length));
  }
  const formatRow = (row: string[]) =>
    row.map((c, i) => c.padEnd(widths[i])).join('  ');
  lines.push(formatRow(headers));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of cells) lines.push(formatRow(row));
  lines.push('');

  return lines.join('\n');
}

export async function writeCompareReport(opts: CompareOptions): Promise<string> {
  const text = await compareReports(opts);
  const outPath = opts.candidate.replace(/\.json$/, '.compare.md');
  await fs.writeFile(outPath, text, 'utf-8');
  return outPath;
}