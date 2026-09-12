import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { formatLedgerEvalSummary, runLedgerEval, writeLedgerEvalReport, type LedgerEvalMode, type LedgerEvalProblem } from '@omega/bench';

const ENV_KEYS: Record<string, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
  generic: process.env.OPENROUTER_API_KEY,
  kimi: process.env.KIMI_API_KEY,
};

interface EvalOptions {
  problems: string;
  model: string;
  kind: string;
  baseUrl?: string;
  apiKey?: string;
  modes: string;
  n: string;
  maxOutput: string;
  maxIters: string;
  timeoutMs: string;
  think?: boolean;
  hidden?: boolean;
  fresh?: boolean;
  out: string;
}

export const ledgerCmd = new Command('ledger')
  .description('Run the ledger (manager-worker) scaffold and compare it against a single call')
  .addCommand(
    new Command('eval')
      .description('Evaluate single vs ledger on a problems JSON file (LCB fixture format)')
      .requiredOption('--problems <file>', 'problems JSON (id/statement/tests/hiddenTests)')
      .requiredOption('--model <model>', 'model id')
      .option('--kind <kind>', 'provider kind (ollama|openai|anthropic|generic|kimi)', 'ollama')
      .option('--base-url <url>', 'provider base URL')
      .option('--api-key <key>', 'provider API key (falls back to the provider env var)')
      .option('--modes <list>', 'comma-separated arms', 'single,ledger')
      .option('--n <count>', 'number of problems to run', '4')
      .option('--max-output <tokens>', 'per-call output cap', '4096')
      .option('--max-iters <count>', 'ledger worker rounds', '6')
      .option('--timeout-ms <ms>', 'per-call timeout', '600000')
      .option('--think', 'enable provider reasoning')
      .option('--hidden', 'grade against hiddenTests when present')
      .option('--fresh', 'run a fresh-perspective worker first')
      .option('--out <file>', 'report path', `/tmp/ledger-eval-${String(Date.now())}.json`)
      .action(async (options: EvalOptions) => {
        const problems = (JSON.parse(await readFile(options.problems, 'utf-8')) as LedgerEvalProblem[]).slice(0, Number(options.n));
        const modes = options.modes.split(',').map((mode) => mode.trim()).filter(Boolean) as LedgerEvalMode[];
        const apiKey = options.apiKey ?? ENV_KEYS[options.kind];
        console.log(
          `ledger eval: ${String(problems.length)} problems, model=${options.model}, modes=${modes.join(',')}, ` +
            `grading=${options.hidden ? 'hidden' : 'public'}`
        );
        const report = await runLedgerEval({
          problems,
          provider: { kind: options.kind, baseUrl: options.baseUrl, apiKey, model: options.model },
          modes,
          maxOutputTokens: Number(options.maxOutput),
          maxIters: Number(options.maxIters),
          timeoutMs: Number(options.timeoutMs),
          think: options.think,
          freshPerspective: options.fresh,
          gradeHidden: options.hidden,
          onCall: (info) => {
            console.log(
              `  [${String(info.index).padStart(3)}] ${info.role} ${(info.durationMs / 1000).toFixed(1)}s ` +
                `finish=${info.finishReason ?? '?'} out=${String(info.completionTokens ?? '?')}`
            );
          },
          onProblem: (row) => {
            const mark = row.error ? 'ERR' : row.correct ? 'PASS' : 'fail';
            console.log(
              `  ${row.problem} ${row.mode.padEnd(6)} ${mark} ${String(row.passed)}/${String(row.total)} ` +
                `calls=${String(row.calls)} truncated=${String(row.truncatedCalls)}`
            );
          },
        });
        console.log(`\n${formatLedgerEvalSummary(report)}`);
        await writeLedgerEvalReport(report, options.out);
        console.log(`\nreport: ${options.out}`);
      })
  );