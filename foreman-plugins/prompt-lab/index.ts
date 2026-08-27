/**
 * The Prompt Lab use-case shell — the harness's own self-improvement surface.
 *
 * Every agent run is stamped with a `PromptVersion` (a content hash of the
 * system, text-tools, planning and skill-context prompts), and every benchmark
 * result carries that hash back. That ledger IS the self-improvement loop's
 * memory: an optimise task edits `prompts.ts`, the next run lands under a new
 * hash, and benchmark scores per hash say whether the edit helped. Until now
 * that ledger was only reachable through `curl /prompt-versions`. This shell
 * puts it in the Foreman chrome, beside the objectives it belongs to.
 *
 * It is first-party but it lives in `foreman-plugins/`, wired in through the
 * same seam as any out-of-tree shell: pure export, discovered by
 * `foreman-plugins.json`, registered by the roster. It reads the harness API
 * through its OWN data-source client — the guest contract gives a view six
 * props and none of them is Foreman's fetch.
 *
 * Unlike Polymarket this shell has a real backend: the harness server itself,
 * which is guaranteed to exist wherever Foreman does. The health dot on this
 * source is therefore meaningful, not aspirational.
 */
import type { UseCaseShell } from '@omega-harness/usecase-kit';
import { HARNESS_API_SOURCE } from './source.js';
import { PromptVersionsView } from './views/PromptVersions.js';
import { BenchReportsView } from './views/BenchReports.js';

/** Distinct from every status colour (green/amber/yellow/red) and from the two domain accents already taken (Victoria's green, Polymarket's violet). */
export const PROMPT_LAB_ACCENT = '#4da3ff';

export const promptLabUseCase: UseCaseShell = {
  id: 'prompt-lab',
  name: 'Prompt Lab — self-improvement',
  version: '0.1.0',
  description:
    'The harness improving itself — prompt versions with their benchmark scores, and the bench reports behind them. Read-only.',
  accent: PROMPT_LAB_ACCENT,
  // No vocabulary renames: "harness", "pulse" and "objective" are exactly the
  // words this shell talks about — it IS about the harness.
  views: [
    { id: 'prompt-lab-versions', label: 'Prompts', order: 10, component: PromptVersionsView },
    { id: 'prompt-lab-bench', label: 'Benchmarks', order: 20, component: BenchReportsView },
  ],
  dataSources: [HARNESS_API_SOURCE],
};
