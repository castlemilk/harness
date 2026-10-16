#!/usr/bin/env node
/**
 * Move sweep reports out of ~/.omega/reports so the site's ingestion sees
 * exactly the run we intend to publish — and only that run.
 *
 * `scripts/gen-harness-eval.mjs` in benebsworth.com reads *every*
 * `model-eval-*.json` in ~/.omega/reports, newest first, and merges it into the
 * site's accumulated results.json. Two consequences follow, and both are the
 * reason this script exists:
 *
 *   1. A model the site has never seen is appended *without* per-task dedupe,
 *      so two iterations of the same suite/task publish as two records — the
 *      model page then reports 20 tasks for a 10-task suite.
 *   2. A later build re-reads whatever is still in the reports directory. If
 *      those duplicates are still there when the model *is* in the baseline,
 *      the merge collapses them and the shrink guard refuses to write.
 *
 * So the published arm is archived deliberately: iteration 1 of the baseline
 * arm stays in place (the pre-registered sweep, and re-ingesting it is a no-op),
 * and everything else — later iterations, the treatment arms — is moved under
 * results/reports/not-ingested/ as evidence. Unreferenced reports are *listed*,
 * never moved: they may belong to another experiment.
 *
 * Usage:
 *   node archive-reports.mjs                 # dry run, prints the plan
 *   node archive-reports.mjs --apply         # performs the moves
 *   node archive-reports.mjs --keep-iter 2 --keep-arms baseline,skills --apply
 *
 * Env/flags:
 *   --keep-iter <n>    iteration that stays in the reports directory (default 1)
 *   --keep-arms <list> arms that stay (default baseline)
 *   --reports-dir <p>  reports directory (default ~/.omega/reports)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const keepIter = Number(flag('--keep-iter', '1'));
const keepArms = flag('--keep-arms', 'baseline')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const reportsDir = flag('--reports-dir', path.join(os.homedir(), '.omega', 'reports'));

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, 'results', 'manifest.jsonl');
const archiveRoot = path.join(here, 'results', 'reports', 'not-ingested');

if (!fs.existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath} — run the sweep first.`);
  process.exit(1);
}
if (!fs.existsSync(reportsDir)) {
  console.error(`No reports directory at ${reportsDir}.`);
  process.exit(1);
}

const entries = fs
  .readFileSync(manifestPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const keep = [];
const move = [];
const missing = [];
const referenced = new Set();

for (const e of entries) {
  if (!e.report) continue;
  const json = e.report;
  const base = path.basename(json).replace(/\.json$/, '');
  referenced.add(`${base}.json`);
  if (!fs.existsSync(json)) {
    missing.push(base);
    continue;
  }
  const kept = e.iter === keepIter && keepArms.includes(e.arm);
  if (kept) {
    keep.push(`${e.arm}/i${e.iter}/${base}`);
    continue;
  }
  const subdir = e.iter !== keepIter ? `iter${e.iter}` : 'arms';
  move.push({ from: json, to: path.join(archiveRoot, subdir, path.basename(json)), arm: e.arm, iter: e.iter });
}

const unreferenced = fs
  .readdirSync(reportsDir)
  .filter((f) => f.startsWith('model-eval-') && f.endsWith('.json') && !f.includes('latest') && !referenced.has(f));

console.log(`${entries.length} manifest entr${entries.length === 1 ? 'y' : 'ies'}`);
console.log(`  keep in ${reportsDir}: ${String(keep.length)} report(s)`);
for (const k of keep) console.log(`    ${k}`);
console.log(`  archive: ${String(move.length)} report(s)`);
const byDir = new Map();
for (const m of move) {
  const rel = path.relative(archiveRoot, path.dirname(m.to));
  byDir.set(rel, (byDir.get(rel) ?? 0) + 1);
}
for (const [dir, n] of byDir) console.log(`    ${dir}: ${String(n)}`);
if (missing.length > 0) {
  console.log(`  already gone: ${String(missing.length)} (moved by an earlier run?)`);
}
if (unreferenced.length > 0) {
  console.log(`  NOT TOUCHED — ${String(unreferenced.length)} report(s) in the directory that this manifest does not name:`);
  for (const f of unreferenced) console.log(`    ${f}`);
  console.log('    (another experiment, or a validation run: decide by hand)');
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to move.');
  process.exit(0);
}

let moved = 0;
for (const m of move) {
  fs.mkdirSync(path.dirname(m.to), { recursive: true });
  fs.renameSync(m.from, m.to);
  moved++;
  const md = `${m.from.replace(/\.json$/, '')}.md`;
  if (fs.existsSync(md)) fs.renameSync(md, m.to.replace(/\.json$/, '.md'));
}
console.log(`\nArchived ${String(moved)} report(s) (+.md siblings) under ${archiveRoot}.`);
