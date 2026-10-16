#!/usr/bin/env node
/**
 * Aggregates a harder-v2 injection sweep from its manifest.
 *
 * results/manifest.jsonl names every run the sweep made. This reads those
 * report files — no inference is re-run — and reports, per arm:
 *
 *   - pass rate over *real* model runs. Runs the provider circuit skipped, and
 *     runs that died on infrastructure, are excluded and surfaced separately:
 *     counting them as model failures would silently corrupt the comparison.
 *   - token economy: mean tokens per run and tokens per solved task.
 *   - the per-task matrix and a paired comparison against baseline.
 *
 * Usage: node analyze.mjs [manifest.jsonl]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = process.argv[2] ?? path.join(HERE, 'results', 'manifest.jsonl');
const ARM_ORDER = ['baseline', 'skills', 'kg'];

/** The breaker skipped the run before the CLI started. */
const SKIPPED = /circuit is open/i;
/** Do not blame the model for these. The last two are the CLI's own crash
 *  shape: an internal statement error and a non-zero exit, observed live on
 *  2026-10-16 when the free tier's session store failed mid-run. */
const INFRA = /rate.?limit|quota|429|ECONNREFUSED|timed out|timeout|ENOENT|no such file|spawn|Failed to execute statement|exited with code/i;

function readManifest(file) {
  if (!fs.existsSync(file)) throw new Error(`No manifest at ${file} — run run-arms.sh first.`);
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function totalToolCalls(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  try {
    return Object.values(JSON.parse(raw)).reduce((sum, n) => sum + Number(n), 0);
  } catch {
    return 0;
  }
}

function classify(entry) {
  const run = { ...entry, kind: 'model', passed: false, detail: '' };
  if (!entry.report || !fs.existsSync(entry.report)) {
    return { ...run, kind: 'skipped', detail: 'no report written' };
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(entry.report, 'utf8'));
  } catch {
    return { ...run, kind: 'skipped', detail: 'unreadable report' };
  }
  const model = (report.results ?? [])[0] ?? {};
  const inner = model.report ?? {};
  const result = (inner.results ?? [])[0];
  run.label = `${model.provider ?? ''}/${model.model ?? ''}`;
  if (!result) return { ...run, kind: 'skipped', detail: 'report has no task result' };

  const taskError = String(result.taskError ?? '');
  const agentRun = result.agentRun ?? {};
  run.task = result.task?.id ?? entry.task;
  run.durationMs = Number(result.durationMs ?? 0);
  run.tokens = Number(agentRun.totalTokens ?? 0);
  run.turns = Number(agentRun.turnCount ?? 0);
  run.toolCalls = totalToolCalls(agentRun.toolCalls);

  if (SKIPPED.test(taskError)) return { ...run, kind: 'skipped', detail: 'circuit open' };
  if (INFRA.test(taskError)) return { ...run, kind: 'infra', detail: taskError.slice(0, 90) };
  if (!result.agentRun) return { ...run, kind: 'infra', detail: 'no agent run recorded' };

  run.passed = result.evaluation?.passed === true;
  run.detail = run.passed ? '' : String(result.evaluation?.message ?? 'failed').slice(0, 90);
  return run;
}

/** One entry per (arm, iteration, task): the last attempt recorded for it. */
function latestPerRun(runs) {
  const map = new Map();
  for (const run of runs) {
    const key = `${run.arm}|${String(run.iter)}|${run.task}`;
    const prev = map.get(key);
    if (!prev || Number(run.attempt) >= Number(prev.attempt)) map.set(key, run);
  }
  return [...map.values()];
}

const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
const pct = (n, d) => (d === 0 ? '—' : `${String(Math.round((n / d) * 100))}%`);
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

function main() {
  const entries = readManifest(MANIFEST);
  const runs = entries.map(classify);
  const arms = ARM_ORDER.filter((arm) => runs.some((run) => run.arm === arm));
  if (arms.length === 0) throw new Error('No arms in the manifest.');

  const tasks = [...new Set(runs.map((run) => run.task))].sort();
  const short = (id) => id.replace(/^harder-v2-/, '');

  console.log('\n=== harder-v2 context-injection sweep ===');
  const skipped = runs.filter((run) => run.kind === 'skipped').length;
  const infra = runs.filter((run) => run.kind === 'infra').length;
  console.log(
    `recorded ${String(runs.length)} run(s): ${String(skipped)} skipped by the circuit, ${String(infra)} infrastructure-only`,
  );

  console.log('\narm summary (real model runs only)');
  console.log(
    `  ${pad('arm', 10)}${padl('real', 5)}${padl('solved', 7)}${padl('rate', 6)}${padl('mean tok', 10)}${padl('tok/solved', 12)}${padl('mean dur', 10)}${padl('turns', 7)}${padl('tools', 7)}`,
  );
  const iterations = [...new Set(runs.map((run) => Number(run.iter)))].sort((a, b) => a - b);
  const summary = {};
  for (const arm of arms) {
    const runsForArm = latestPerRun(runs.filter((run) => run.arm === arm));
    const real = runsForArm.filter((run) => run.kind === 'model');
    const solved = real.filter((run) => run.passed);
    const tokens = real.reduce((sum, run) => sum + run.tokens, 0);
    /**
     * The same reduction, one iteration at a time. A second pass exists to check
     * variance, and folding it into the first would hide exactly that.
     */
    const perIteration = (it) => {
      const forIter = latestPerRun(
        runs.filter((run) => run.arm === arm && Number(run.iter) === it),
      ).filter((run) => run.kind === 'model');
      return {
        real: forIter.length,
        solved: forIter.filter((run) => run.passed).length,
        meanTokens: Math.round(mean(forIter.map((run) => run.tokens))),
      };
    };
    summary[arm] = {
      real: real.length,
      solved: solved.length,
      skipped: runsForArm.filter((run) => run.kind === 'skipped').length,
      infra: runsForArm.filter((run) => run.kind === 'infra').length,
      meanTokens: Math.round(mean(real.map((run) => run.tokens))),
      tokensPerSolved: solved.length > 0 ? Math.round(tokens / solved.length) : null,
      meanDurationMs: Math.round(mean(real.map((run) => run.durationMs))),
      meanTurns: Number(mean(real.map((run) => run.turns)).toFixed(2)),
      meanToolCalls: Number(mean(real.map((run) => run.toolCalls)).toFixed(2)),
      iterations: Object.fromEntries(iterations.map((it) => [String(it), perIteration(it)])),
      tasks: Object.fromEntries(tasks.map((task) => {
        const forTask = real.filter((run) => run.task === task);
        return [task, { passed: forTask.filter((run) => run.passed).length, real: forTask.length }];
      })),
    };
    const s = summary[arm];
    console.log(
      `  ${pad(arm, 10)}${padl(s.real, 5)}${padl(s.solved, 7)}${padl(pct(s.solved, s.real), 6)}${padl(k(s.meanTokens), 10)}${padl(s.tokensPerSolved === null ? '—' : k(s.tokensPerSolved), 12)}${padl(`${String(Math.round(s.meanDurationMs / 1000))}s`, 10)}${padl(s.meanTurns, 7)}${padl(s.meanToolCalls, 7)}`,
    );
  }

  if (iterations.length > 1) {
    console.log('\nper iteration (solved / real, mean tokens)');
    console.log(`  ${pad('iter', 8)}${arms.map((arm) => padl(arm, 22)).join('')}`);
    for (const it of iterations) {
      let row = `  ${pad(`i${String(it)}`, 8)}`;
      for (const arm of arms) {
        const s = summary[arm].iterations[String(it)] ?? { real: 0, solved: 0, meanTokens: 0 };
        row += padl(s.real === 0 ? '—' : `${String(s.solved)}/${String(s.real)} (${k(s.meanTokens)} tok)`, 22);
      }
      console.log(row);
    }
  }

  console.log('\nper task (solved / real runs)');
  console.log(`  ${pad('task', 26)}${arms.map((arm) => padl(arm, 11)).join('')}`);
  for (const task of tasks) {
    let row = `  ${pad(short(task), 26)}`;
    for (const arm of arms) {
      const t = summary[arm].tasks[task] ?? { passed: 0, real: 0 };
      row += padl(t.real === 0 ? '—' : `${String(t.passed)}/${String(t.real)}`, 11);
    }
    console.log(row);
  }

  // Pairing is not a significance test: ten tiny repairs cannot separate arms
  // that differ by one task. It shows *which* tasks moved, which is the honest
  // way to read a sweep this small.
  const baseline = summary.baseline;
  if (baseline) {
    console.log('\npaired against baseline (majority of real runs per task)');
    for (const arm of arms.filter((a) => a !== 'baseline')) {
      const gained = [];
      const lost = [];
      for (const task of tasks) {
        const b = baseline.tasks[task] ?? { passed: 0, real: 0 };
        const a = summary[arm].tasks[task] ?? { passed: 0, real: 0 };
        if (a.real === 0 || b.real === 0) continue;
        const bPass = b.passed * 2 > b.real;
        const aPass = a.passed * 2 > a.real;
        if (aPass && !bPass) gained.push(short(task));
        if (bPass && !aPass) lost.push(short(task));
      }
      console.log(
        `  ${pad(arm, 9)} +${String(gained.length)} / -${String(lost.length)}   gained: ${gained.join(', ') || 'none'}   lost: ${lost.join(', ') || 'none'}`,
      );
    }
  }

  const failures = runs.filter((run) => run.kind !== 'model' || !run.passed);
  if (failures.length > 0) {
    console.log('\nrun outcomes other than a pass');
    for (const run of failures) {
      console.log(
        `  ${pad(run.arm, 9)} ${pad(short(run.task), 22)} i${String(run.iter)}a${String(run.attempt)}  ${pad(run.kind, 8)} ${run.detail}`,
      );
    }
  }

  const outPath = path.join(HERE, 'results', 'summary.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      manifest: MANIFEST,
      summary,
      runs: runs.map(({ report, ...rest }) => ({ ...rest, report: path.basename(String(report ?? '')) })),
    }, null, 2),
    'utf8',
  );
  console.log(`\nwrote ${outPath}`);
}

main();
