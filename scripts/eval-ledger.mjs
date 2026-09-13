#!/usr/bin/env node
/**
 * Basic eval: single call vs ledger (manager-worker) scaffold on coding problems.
 *
 *   node scripts/eval-ledger.mjs \
 *     --problems scripts/fixtures/lcb-hard-sample.json \
 *     --model qwen/qwen3.8-27b --kind generic \
 *     --base-url https://openrouter.ai/api/v1 --api-key "$OPENROUTER_API_KEY" \
 *     --max-output 8192 --max-iters 4 --think --hidden \
 *     --out /tmp/ledger-eval.json
 *
 * The runner lives in @omega/bench (`runLedgerEval`); this script is the CLI
 * wrapper that prints progress and writes the JSON report.
 */
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { formatLedgerEvalSummary, runLedgerEval, writeLedgerEvalReport } from '../packages/bench/dist/index.js';

function parseArgs(argv) {
  const args = {
    problems: 'scripts/fixtures/lcb-hard-sample.json',
    model: 'qwen3.8:27b-mlx-64k',
    baseUrl: 'http://localhost:11434',
    kind: 'ollama',
    apiKey: '',
    modes: 'single,ledger',
    n: 4,
    maxOutput: 4096,
    maxIters: 6,
    timeoutMs: 600_000,
    think: false,
    hidden: false,
    fresh: false,
    out: `/tmp/ledger-eval-${Date.now()}.json`,
  };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    const take = () => { if (inline === undefined) i += 1; };
    switch (key) {
      case '--problems': args.problems = value; take(); break;
      case '--model': args.model = value; take(); break;
      case '--base-url': args.baseUrl = value; take(); break;
      case '--kind': args.kind = value; take(); break;
      case '--api-key': args.apiKey = value; take(); break;
      case '--modes': args.modes = value; take(); break;
      case '--n': args.n = Number(value); take(); break;
      case '--max-output': args.maxOutput = Number(value); take(); break;
      case '--max-iters': args.maxIters = Number(value); take(); break;
      case '--timeout-ms': args.timeoutMs = Number(value); take(); break;
      case '--think': args.think = true; break;
      case '--hidden': args.hidden = true; break;
      case '--fresh': args.fresh = true; break;
      case '--out': args.out = value; take(); break;
      default: break;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const modes = args.modes.split(',').map((mode) => mode.trim()).filter(Boolean);
const envKey = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
  generic: process.env.OPENROUTER_API_KEY,
  kimi: process.env.KIMI_API_KEY,
}[args.kind];

const problems = JSON.parse(await readFile(args.problems, 'utf-8')).slice(0, args.n);
console.log(`loaded ${problems.length} problems from ${args.problems}`);
console.log(
  `model=${args.model} kind=${args.kind} modes=${modes.join(',')} maxOutput=${args.maxOutput} ` +
    `maxIters=${args.maxIters} think=${args.think} fresh=${args.fresh} grading=${args.hidden ? 'hidden' : 'public'}`
);

const report = await runLedgerEval({
  problems,
  provider: { kind: args.kind, baseUrl: args.baseUrl, apiKey: args.apiKey || envKey, model: args.model },
  modes,
  maxOutputTokens: args.maxOutput,
  maxIters: args.maxIters,
  timeoutMs: args.timeoutMs,
  think: args.think,
  freshPerspective: args.fresh,
  gradeHidden: args.hidden,
  onCall: (info) => {
    console.log(
      `    [call ${String(info.index).padStart(3)}] ${info.role} ${(info.durationMs / 1000).toFixed(1)}s ` +
        `finish=${info.finishReason ?? '?'} out=${info.completionTokens ?? '?'}` +
        `${info.costUsd ? ` $${info.costUsd.toFixed(4)}` : ''}`
    );
  },
  onProblem: (row) => {
    const mark = row.error ? 'ERR' : row.correct ? 'PASS' : 'fail';
    console.log(
      `  ${row.mode.padEnd(6)} ${mark} tests=${row.passed}/${row.total} calls=${row.calls} ` +
        `truncated=${row.truncatedCalls} ${(row.durationMs / 1000).toFixed(1)}s${row.error ? ` error=${row.error}` : ''}`
    );
  },
});

console.log('\n=== summary ===');
console.log(formatLedgerEvalSummary(report));
await writeLedgerEvalReport(report, args.out);
console.log(`\nreport: ${args.out}`);