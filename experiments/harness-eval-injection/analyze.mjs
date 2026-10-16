#!/usr/bin/env node
/**
 * Aggregates the results of the harder-v2 injection sweep.
 *
 * Reads `results/<arm>-run<N>.log`, pulls the report paths the CLI printed, and
 * summarises per-arm and per-task pass rates together with token, duration and
 * cost totals. Results come from the report files themselves, so re-running the
 * analysis never re-runs any inference.
 *
 * Usage: node analyze.mjs [resultsDir]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = process.argv[2] ?? path.join(HERE, 'results');

const ARMS = ['baseline', 'skills', 'kg'];

async function reportPathsFromLogs() {
  const byArm = new Map();
  let logs = [];
  try {
    logs = (await fs.readdir(RESULTS)).filter((f) => f.endsWith('.log')).sort();
  } catch {
    throw new Error(`No logs in ${RESULTS}. Run run-arms.sh first.`);
  }
  for (const log of logs) {
    const arm = log.split('-run')[0];
    const text = await fs.readFile(path.join(RESULTS, log), 'utf-8');
    const files = [...text.matchAll(/Harness eval report written to (.+\.json)/g)].map((m) => m[1].trim());
    if (!byArm.has(arm)) byArm.set(arm, []);
    byArm.get(arm).push(...files);
  }
  return byArm;
}

function pickMetrics(result) {
  const run = result.agentRun ?? {};
  const metrics = result.evaluation?.metrics ?? {};
  const totalTokens = run.totalTokens ?? metrics.totalTokens ?? null;
  const costUsd = run.costUsd ?? metrics.costUsd ?? null;
  return { totalTokens, costUsd };
}

async function main() {
  const reportMap = await reportPathsFromLogs();
  const perArm = new Map();
  const taskIds = new Set();

  for (const arm of ARMS) {
    const files = reportMap.get(arm) ?? [];
    if (files.length === 0) continue;
    const tasks = new Map();
    let tokens = 0;
    let cost = 0;
    let durationMs = 0;

    for (const file of files) {
      let report;
      try {
        report = JSON.parse(await fs.readFile(file, 'utf-8'));
      } catch {
        console.warn(`unreadable report: ${file}`);
        continue;
      }
      for (const model of report.results ?? []) {
        const inner = model.report ?? {};
        durationMs += inner.totalDurationMs ?? 0;
        for (const r of inner.results ?? []) {
          const id = r.task?.id ?? r.task?.name ?? 'unknown';
          taskIds.add(id);
          const passed = Boolean(r.evaluation?.passed);
          if (!tasks.has(id)) tasks.set(id, { runs: 0, passed: 0, tokens: 0, errors: [] });
          const entry = tasks.get(id);
          entry.runs += 1;
          if (passed) entry.passed += 1;
          const m = pickMetrics(r);
          if (typeof m.totalTokens === 'number') {
            entry.tokens += m.totalTokens;
            tokens += m.totalTokens;
          }
          if (typeof m.costUsd === 'number') cost += m.costUsd;
          if (!passed && entry.errors.length < 1) {
            entry.errors.push(String(r.evaluation?.message ?? r.error ?? 'failed').slice(0, 90));
          }
        }
      }
    }
    perArm.set(arm, { tasks, tokens, cost, durationMs, reports: files.length });
  }

  if (perArm.size === 0) throw new Error('No arms found in the logs.');

  const ordered = [...taskIds].sort();
  const pad = (s, n) => String(s).padEnd(n);
  const padl = (s, n) => String(s).padStart(n);

  console.log('\n=== harder-v2 injection sweep ===\n');
  const header = pad('task', 32) + ARMS.filter((a) => perArm.has(a)).map((a) => padl(a, 12)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const id of ordered) {
    let row = pad(id.replace('harder-v2-', ''), 32);
    for (const arm of ARMS) {
      const a = perArm.get(arm);
      if (!a) continue;
      const t = a.tasks.get(id);
      row += padl(t ? `${String(t.passed)}/${String(t.runs)}` : '-', 12);
    }
    console.log(row);
  }

  console.log('-'.repeat(header.length));
  let totalRow = pad('TOTAL', 32);
  for (const arm of ARMS) {
    const a = perArm.get(arm);
    if (!a) continue;
    const passed = [...a.tasks.values()].reduce((s, t) => s + t.passed, 0);
    const runs = [...a.tasks.values()].reduce((s, t) => s + t.runs, 0);
    totalRow += padl(`${String(passed)}/${String(runs)}`, 12);
  }
  console.log(totalRow);

  console.log('\narm      reports  wall-clock   tokens      cost(USD)');
  for (const arm of ARMS) {
    const a = perArm.get(arm);
    if (!a) continue;
    console.log(
      `${pad(arm, 9)}${padl(a.reports, 7)}  ${padl((a.durationMs / 1000).toFixed(0) + 's', 9)}  ${padl(a.tokens || 'n/a', 10)}  ${padl(a.cost.toFixed(4), 9)}`,
    );
  }

  // A failure caused by a quota wall or a dead CLI is not a model failure. It
  // must be visible, because counting it as a failed attempt would silently
  // corrupt the arm comparison.
  const INFRA = /quota|rate.?limit|429|timed out|timeout|no diff patch|ECONNREFUSED|spawn|not found|no changes/i;
  console.log('\ndistinct failure messages (infrastructure failures marked !)');
  for (const arm of ARMS) {
    const a = perArm.get(arm);
    if (!a) continue;
    const seen = new Set();
    for (const [id, t] of a.tasks) {
      for (const e of t.errors) {
        const key = `${e}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`  ${arm}/${id.replace('harder-v2-', '')}: ${INFRA.test(e) ? '! ' : '  '}${e}`);
      }
    }
  }

  const summaryPath = path.join(RESULTS, 'summary.json');
  await fs.writeFile(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    arms: Object.fromEntries([...perArm.entries()].map(([arm, a]) => [arm, {
      reports: a.reports,
      tokens: a.tokens,
      costUsd: a.cost,
      durationMs: a.durationMs,
      tasks: Object.fromEntries([...a.tasks.entries()]),
    }])),
  }, null, 2), 'utf-8');
  console.log(`\nwrote ${summaryPath}`);
}

await main();
