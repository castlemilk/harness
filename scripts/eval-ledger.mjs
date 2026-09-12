#!/usr/bin/env node
/**
 * Basic eval: single call vs ledger (manager-worker) scaffold on coding problems.
 *
 *   node scripts/eval-ledger.mjs \
 *     --problems scripts/fixtures/lcb-hard-sample.json \
 *     --model qwen3.8:27b-mlx-64k --base-url http://localhost:11434 \
 *     --max-output 4096 --max-iters 6 --n 4 --out /tmp/ledger-eval.json
 *
 * Problems are graded with the ledger sample-test verifier (stdin/stdout tests).
 * Both arms see the same problems and the same grader; the only difference is
 * the scaffold. Prints a per-problem table and writes a JSON report.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import * as agent from '../packages/agent/dist/index.js';
import { createProvider } from '../packages/providers/dist/index.js';
import { estimateCostUsd } from '../packages/core/dist/index.js';
import { discordantCounts, mcnemarExact, meanCi95, signFlipPermutation } from '../packages/bench/dist/index.js';

const DEFAULT_SOLVER_SYSTEM =
  'You are an elite competitive programmer. Solve the given problem in Python. ' +
  'Think carefully about algorithmic complexity and edge cases. Output EXACTLY ONE ' +
  'complete, self-contained Python program inside a single ```python ...``` fenced ' +
  'block, and nothing else after it.';

function parseArgs(argv) {
  const args = {
    problems: 'scripts/fixtures/lcb-hard-sample.json',
    model: 'qwen3.8:27b-mlx-64k',
    baseUrl: 'http://localhost:11434',
    kind: 'ollama',
    modes: 'single,ledger',
    n: 4,
    maxOutput: 4096,
    hidden: false,
    fresh: false,
    maxIters: 6,
    contextTokens: 65536,
    timeoutMs: 600000,
    think: false,
    apiKey: '',
    out: `/tmp/ledger-eval-${Date.now()}.json`,
  };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    const take = () => (inline === undefined ? ++i : i);
    switch (key) {
      case '--problems': args.problems = value; take(); break;
      case '--model': args.model = value; take(); break;
      case '--base-url': args.baseUrl = value; take(); break;
      case '--kind': args.kind = value; take(); break;
      case '--modes': args.modes = value; take(); break;
      case '--n': args.n = Number(value); take(); break;
      case '--max-output': args.maxOutput = Number(value); take(); break;
      case '--max-iters': args.maxIters = Number(value); take(); break;
      case '--context-tokens': args.contextTokens = Number(value); take(); break;
      case '--timeout-ms': args.timeoutMs = Number(value); take(); break;
      case '--think': args.think = true; break;
      case '--hidden': args.hidden = true; break;
      case '--fresh': args.fresh = true; break;
      case '--api-key': args.apiKey = value; take(); break;
      case '--out': args.out = value; take(); break;
      default: break;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const modes = args.modes.split(',').map((m) => m.trim()).filter(Boolean);
const solverSystem = agent.DEFAULT_SOLVER_SYSTEM ?? DEFAULT_SOLVER_SYSTEM;
const spec = { kind: 'code', solverSystem };

const provider = createProvider({
  id: 'eval',
  name: `${args.kind}-eval`,
  kind: args.kind,
  baseUrl: args.baseUrl,
  apiKey: args.apiKey || undefined,
  defaultModel: args.model,
  capabilities: [],
  enabled: true,
});

let callSeq = 0;
const send = async ({ system, user, temperature, maxOutputTokens }) => {
  const id = ++callSeq;
  const started = Date.now();
  let finishReason;
  let usage;
  const text = await provider.send(user, {
    system,
    model: args.model,
    temperature,
    maxOutputTokens,
    thinking: args.think,
    contextTokens: args.contextTokens,
    timeoutMs: args.timeoutMs,
    onFinishReason: (reason, u) => { finishReason = reason; if (u) usage = u; },
    onUsage: (u) => { usage = u; },
  });
  const costUsd = estimateCostUsd(args.model, usage) ?? undefined;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const tokens = usage?.completionTokens ?? '?';
  console.log(
    `    [call ${String(id).padStart(3)}] t=${temperature} ${secs}s finish=${finishReason ?? '?'} out=${tokens}${costUsd ? ` $${costUsd.toFixed(3)}` : ''}`
  );
  return { text, finishReason, usage, costUsd };
};

const execFileAsync = promisify(execFile);

async function grade(workspaceDir, solution, tests) {
  if (!solution || solution.trim().length === 0) {
    return { passed: 0, total: tests?.length ?? 0, correct: false, emitted: false, reason: 'no solution' };
  }
  await mkdir(workspaceDir, { recursive: true });
  const solutionPath = path.join(workspaceDir, 'solution.py');
  await writeFile(solutionPath, solution, 'utf-8');
  let emitted = false;
  try {
    await execFileAsync('python3', ['-m', 'py_compile', solutionPath], { timeout: 10000 });
    emitted = true;
  } catch {
    emitted = false;
  }
  if (!tests || tests.length === 0) {
    return { passed: 0, total: 0, correct: false, emitted, reason: 'no tests' };
  }
  const verdict = await agent.runSampleTests(workspaceDir, tests);
  return {
    passed: verdict.passed,
    total: verdict.total,
    correct: verdict.ran && verdict.total > 0 && verdict.passed === verdict.total,
    emitted,
    firstFail: verdict.fail ?? null,
  };
}

const root = path.join(os.homedir(), '.omega', 'evals', 'ledger', String(Date.now()));
await mkdir(root, { recursive: true });

const problems = JSON.parse(await readFile(args.problems, 'utf-8')).slice(0, args.n);
console.log(`loaded ${problems.length} problems from ${args.problems}`);
console.log(
  `model=${args.model} modes=${modes.join(',')} maxOutput=${args.maxOutput} maxIters=${args.maxIters} ` +
    `think=${args.think} grading=${args.hidden ? 'hidden' : 'public'}`
);

const report = { startedAt: new Date().toISOString(), model: args.model, config: args, results: [] };

for (const problem of problems) {
  const gradeTests = args.hidden && problem.hiddenTests?.length > 0 ? problem.hiddenTests : problem.tests;
  console.log(
    `\n=== ${problem.id} (${gradeTests.length} ${args.hidden ? 'hidden' : 'public'} tests, ${problem.contestDate?.slice(0, 10)}) ===`
  );
  for (const mode of modes) {
    const workspaceDir = path.join(root, mode, problem.id);
    const started = Date.now();
    const row = { problem: problem.id, mode, tests: gradeTests.length, grading: args.hidden ? 'hidden' : 'public' };
    try {
      if (mode === 'single') {
        const result = await agent.runSingleCall(send, problem, spec, { maxOutputTokens: args.maxOutput });
        row.calls = 1;
        row.truncatedCalls = result.finishReason === 'length' ? 1 : 0;
        row.usage = result.usage ?? null;
        const verdict = await grade(path.join(workspaceDir, 'grade'), result.code, gradeTests);
        Object.assign(row, verdict);
        row.durationMs = Date.now() - started;
      } else if (mode === 'ledger') {
        const result = await agent.runLedgerLoop(send, problem, spec, {
          workspaceDir,
          maxIters: args.maxIters,
          maxOutputTokens: args.maxOutput,
          freshPerspective: args.fresh,
        });
        row.calls = result.calls.length;
        row.truncatedCalls = result.truncatedCalls;
        row.usage = result.usage;
        row.status = result.status;
        const roleStats = {};
        for (const call of result.calls) {
          const entry = (roleStats[call.role] ??= { calls: 0, truncated: 0, completionTokens: 0, totalDurationMs: 0, maxDurationMs: 0 });
          entry.calls += 1;
          if (call.truncated) entry.truncated += 1;
          entry.completionTokens += call.usage?.completionTokens ?? 0;
          entry.totalDurationMs += call.durationMs ?? 0;
          entry.maxDurationMs = Math.max(entry.maxDurationMs, call.durationMs ?? 0);
        }
        row.roles = roleStats;
        Object.assign(row, await grade(path.join(workspaceDir, 'grade'), result.solution, gradeTests));
        row.durationMs = Date.now() - started;
      } else {
        throw new Error(`unknown mode ${mode}`);
      }
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
    }
    const mark = row.error ? 'ERR' : row.correct ? 'PASS' : 'fail';
    console.log(
      `  ${mode.padEnd(6)} ${mark} tests=${row.passed ?? 0}/${row.total ?? gradeTests.length}` +
        ` calls=${row.calls ?? 0} truncated=${row.truncatedCalls ?? 0} tokens=${row.usage?.completionTokens ?? '?'}` +
        ` ${(((row.durationMs ?? 0) / 1000)).toFixed(1)}s${row.error ? ` error=${row.error}` : ''}`
    );
    report.results.push(row);
  }
}

const summary = {};
for (const mode of modes) {
  const rows = report.results.filter((r) => r.mode === mode);
  const correct = rows.filter((r) => r.correct).length;
  summary[mode] = {
    problems: rows.length,
    correct,
    passRate: rows.length > 0 ? correct / rows.length : 0,
    calls: rows.reduce((s, r) => s + (r.calls ?? 0), 0),
    truncatedCalls: rows.reduce((s, r) => s + (r.truncatedCalls ?? 0), 0),
    completionTokens: rows.reduce((s, r) => s + (r.usage?.completionTokens ?? 0), 0),
    avgDurationMs: rows.length > 0 ? rows.reduce((s, r) => s + (r.durationMs ?? 0), 0) / rows.length : 0,
  };
}
report.summary = summary;
report.finishedAt = new Date().toISOString();
await writeFile(args.out, JSON.stringify(report, null, 2), 'utf-8');

console.log('\n=== summary ===');
for (const [mode, s] of Object.entries(summary)) {
  console.log(
    `${mode.padEnd(6)} pass@1=${(s.passRate * 100).toFixed(0)}% (${s.correct}/${s.problems})` +
      ` calls=${s.calls} truncated=${s.truncatedCalls} tokens=${s.completionTokens} avg=${(s.avgDurationMs / 1000).toFixed(1)}s`
  );
}

const ledgerRows = report.results.filter((r) => r.mode === 'ledger' && r.roles);if (ledgerRows.length > 0) {
  const totals = {};
  for (const row of ledgerRows) {
    for (const [role, entry] of Object.entries(row.roles)) {
      const agg = (totals[role] ??= { calls: 0, truncated: 0, completionTokens: 0, totalDurationMs: 0, maxDurationMs: 0 });
      agg.calls += entry.calls;
      agg.truncated += entry.truncated;
      agg.completionTokens += entry.completionTokens;
      agg.totalDurationMs += entry.totalDurationMs;
      agg.maxDurationMs = Math.max(agg.maxDurationMs, entry.maxDurationMs);
    }
  }
  console.log('\nledger by role:');
  console.log(`${'role'.padEnd(18)} ${'calls'.padStart(5)} ${'trunc'.padStart(5)} ${'out tok'.padStart(8)} ${'avg'.padStart(7)} ${'max'.padStart(7)}`);
  for (const [role, agg] of Object.entries(totals)) {
    console.log(
      `${role.padEnd(18)} ${String(agg.calls).padStart(5)} ${String(agg.truncated).padStart(5)} ` +
        `${String(agg.completionTokens).padStart(8)} ${(agg.totalDurationMs / agg.calls / 1000).toFixed(1).padStart(6)}s ` +
        `${(agg.maxDurationMs / 1000).toFixed(1).padStart(6)}s`
    );
  }
}

if (modes.includes('single') && modes.includes('ledger')) {
  const problemIds = [...new Set(report.results.map((r) => r.problem))];
  const singleVec = problemIds.map((id) => Boolean(report.results.find((r) => r.problem === id && r.mode === 'single')?.correct));
  const ledgerVec = problemIds.map((id) => Boolean(report.results.find((r) => r.problem === id && r.mode === 'ledger')?.correct));
  const deltas = problemIds.map((_, index) => (ledgerVec[index] ? 1 : 0) - (singleVec[index] ? 1 : 0));
  const flip = signFlipPermutation(deltas);
  const disc = discordantCounts(singleVec, ledgerVec);
  const singleCi = meanCi95(singleVec.map(Number));
  const ledgerCi = meanCi95(ledgerVec.map(Number));
  console.log(`\npaired comparison (n=${problemIds.length} problems, ${args.hidden ? 'hidden' : 'public'} grading):`);
  console.log(`  single pass@1 = ${(singleCi.mean * 100).toFixed(1)}% [${(singleCi.low * 100).toFixed(1)}, ${(singleCi.high * 100).toFixed(1)}]`);
  console.log(`  ledger pass@1 = ${(ledgerCi.mean * 100).toFixed(1)}% [${(ledgerCi.low * 100).toFixed(1)}, ${(ledgerCi.high * 100).toFixed(1)}]`);
  console.log(`  mean delta = ${(flip.meanDelta * 100).toFixed(1)} pp, sign-flip p=${flip.pValue.toFixed(4)} (${flip.method})`);
  console.log(
    `  discordants: single-only ${disc.a}, ledger-only ${disc.b}, both ${disc.both}, neither ${disc.neither}` +
      ` (McNemar p=${mcnemarExact(disc.a, disc.b).toFixed(4)})`
  );
}
console.log(`\nreport: ${args.out}`);
