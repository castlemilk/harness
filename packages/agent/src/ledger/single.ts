import { extractPython, stripThink } from './parse.js';
import { DEFAULT_SOLVER_SYSTEM } from './prompts.js';
import type { LedgerCallResult, LedgerProblem, LedgerSend, LedgerSpec, LedgerUsage } from './types.js';

export interface SingleCallResult {
  text: string;
  code: string;
  finishReason?: string;
  usage?: LedgerUsage;
  costUsd?: number;
}

export async function runSingleCall(
  send: LedgerSend,
  problem: LedgerProblem,
  spec: LedgerSpec,
  opts: { maxOutputTokens?: number } = {},
): Promise<SingleCallResult> {
  const response: LedgerCallResult = await send({
    role: 'single',
    system: spec.solverSystem || DEFAULT_SOLVER_SYSTEM,
    user: problem.statement,
    temperature: 0.2,
    ...(opts.maxOutputTokens === undefined ? {} : { maxOutputTokens: opts.maxOutputTokens }),
  });
  const text = response.text;
  return {
    text,
    code: extractPython(stripThink(text)),
    finishReason: response.finishReason,
    usage: response.usage,
    costUsd: response.costUsd,
  };
}