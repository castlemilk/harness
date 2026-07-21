import type { BenchmarkResult, FailureAnalysis, FailureCategory, TraceFlowInfo, TraceSpanNode } from './types.js';

function walkSpans(traceFlow?: TraceFlowInfo, callback?: (span: TraceSpanNode) => void): void {
  if (!traceFlow) return;
  function visit(span: TraceSpanNode): void {
    callback?.(span);
    for (const child of span.children) {
      visit(child);
    }
  }
  for (const span of traceFlow.spans) {
    visit(span);
  }
}

function findSpans(traceFlow: TraceFlowInfo | undefined, predicate: (span: TraceSpanNode) => boolean): TraceSpanNode[] {
  const matches: TraceSpanNode[] = [];
  walkSpans(traceFlow, (span) => {
    if (predicate(span)) matches.push(span);
  });
  return matches;
}

function spanError(span: TraceSpanNode): string | undefined {
  if (span.status !== 'error') return undefined;
  const err = span.attributes?.error;
  return typeof err === 'string' ? err : undefined;
}

function toolSpans(traceFlow: TraceFlowInfo | undefined): TraceSpanNode[] {
  return findSpans(traceFlow, (s) => s.name.startsWith('agent.tool.'));
}

function providerSpans(traceFlow: TraceFlowInfo | undefined): TraceSpanNode[] {
  return findSpans(traceFlow, (s) => s.name === 'provider.send');
}

function planSpan(traceFlow: TraceFlowInfo | undefined): TraceSpanNode | undefined {
  return findSpans(traceFlow, (s) => s.name === 'agent.plan').shift();
}

function validationSummary(result: BenchmarkResult): { allPassed?: boolean; lint?: { passed?: boolean }; test?: { passed?: boolean }; build?: { passed?: boolean } } | undefined {
  if (!result.agentRun?.validationSummary) return undefined;
  try {
    return JSON.parse(result.agentRun.validationSummary) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

interface CategoryRule {
  category: FailureCategory;
  rootCause: string;
  pattern: RegExp;
}

// Order matters: more specific infrastructure failures are matched first.
const EVIDENCE_RULES: CategoryRule[] = [
  {
    category: 'install_failure',
    pattern: /npm err|pnpm (err|install.*fail)|yarn (install.*fail|error)|failed to install (dependencies|packages)/i,
    rootCause: 'Dependency installation failed during setup or verification.',
  },
  {
    category: 'dependency_error',
    pattern: /cannot find module|module_not_found|err_module_not_found|modulenotfounderror|no module named|importerror|unresolved dependency|missing dependency/i,
    rootCause: 'A required module or dependency could not be resolved.',
  },
  {
    category: 'patch_apply_failed',
    pattern: /patch.*(failed|does not apply)|failed to apply (the )?(patch|diff)|git apply|hunks? failed|corrupt patch/i,
    rootCause: 'The generated patch could not be applied to the working tree.',
  },
  {
    category: 'verifier_timeout',
    pattern: /verif\w*.*timed?\s?out|timed?\s?out.*verif/i,
    rootCause: 'The verifier did not finish within its time limit.',
  },
  {
    category: 'compile_error',
    pattern: /syntaxerror|ts\d{4}|compilation failed|cannot compile|unexpected token/i,
    rootCause: 'The code failed to compile or parse.',
  },
  {
    category: 'build_failure',
    pattern: /build failed|build error|error during build|make: \*\*\*/i,
    rootCause: 'The project build step failed.',
  },
  {
    category: 'test_failure',
    pattern: /assertionerror|tests? failed|failing tests?|failed \d+ tests?|\bFAIL\b/i,
    rootCause: 'One or more tests failed.',
  },
  {
    category: 'model_error',
    pattern: /rate limit|\b429\b|context length|maximum context|model error|api error|invalid api key|quota exceeded|overloaded/i,
    rootCause: 'The model/provider returned an error.',
  },
];

function collectEvidenceText(result: BenchmarkResult): string[] {
  const evidence: string[] = [];
  if (result.evaluation.message) evidence.push(result.evaluation.message);
  const verifierLogs = result.evaluation.metrics?.verifier_logs;
  if (typeof verifierLogs === 'string') evidence.push(verifierLogs);
  for (const err of result.traceSummary?.topErrors ?? []) {
    evidence.push(err.tool ? `${err.tool}: ${err.message}` : err.message);
  }
  return evidence;
}

function matchEvidence(
  result: BenchmarkResult,
  categories?: FailureCategory[]
): { category: FailureCategory; rootCause: string; evidence: string[] } | undefined {
  const text = collectEvidenceText(result);
  for (const rule of EVIDENCE_RULES) {
    if (categories && !categories.includes(rule.category)) continue;
    const matched = text.filter((line) => rule.pattern.test(line));
    if (matched.length > 0) {
      return { category: rule.category, rootCause: rule.rootCause, evidence: matched.slice(0, 5) };
    }
  }
  return undefined;
}

function verifierLogFile(result: BenchmarkResult): string | undefined {
  const metrics = result.evaluation.metrics;
  if (!metrics) return undefined;
  for (const [key, value] of Object.entries(metrics)) {
    if (/log.*(file|path)|verifier_log/i.test(key) && typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function withLog(result: BenchmarkResult, analysis: FailureAnalysis): FailureAnalysis {
  const logFile = verifierLogFile(result);
  return logFile ? { ...analysis, verifierLogFile: logFile } : analysis;
}

export function classifyFailure(result: BenchmarkResult, traceFlow?: TraceFlowInfo): FailureAnalysis {
  const evidence: string[] = [];

  if (result.status === 'timeout') {
    const verifierTimeout = matchEvidence(result, ['verifier_timeout']);
    if (verifierTimeout) {
      return withLog(result, verifierTimeout);
    }
    return withLog(result, {
      category: 'timeout',
      rootCause: 'Task did not finish within the timeout window.',
      evidence: [`durationMs: ${String(result.durationMs)}`],
    });
  }

  const validation = validationSummary(result);
  if (validation?.allPassed === false) {
    const failedSteps: string[] = [];
    for (const key of ['lint', 'test', 'build'] as const) {
      const step = validation[key];
      if (step && !step.passed) {
        failedSteps.push(key);
      }
    }
    // Map failed validation steps onto the richer taxonomy where possible.
    if (failedSteps.includes('build')) {
      const buildMatch = matchEvidence(result, ['install_failure', 'dependency_error', 'compile_error', 'build_failure']);
      if (buildMatch) return withLog(result, buildMatch);
      return withLog(result, {
        category: 'build_failure',
        rootCause: 'The build validation step failed.',
        evidence: ['build did not pass'],
      });
    }
    if (failedSteps.includes('test')) {
      const testMatch = matchEvidence(result, ['dependency_error', 'compile_error', 'test_failure']);
      if (testMatch) return withLog(result, testMatch);
      return withLog(result, {
        category: 'test_failure',
        rootCause: 'The test validation step failed.',
        evidence: ['test did not pass'],
      });
    }
    return withLog(result, {
      category: 'validation_failure',
      rootCause: `Validation failed: ${failedSteps.length > 0 ? failedSteps.join(', ') : 'unspecified step'}.`,
      evidence: failedSteps.map((s) => `${s} did not pass`),
    });
  }

  // Infrastructure/environment failures show up in the evaluation message,
  // verifier logs or trace errors even when validation never ran.
  const envMatch = matchEvidence(result);
  if (envMatch) {
    return withLog(result, envMatch);
  }

  const tools = toolSpans(traceFlow);
  const failedTools = tools.filter((s) => s.status === 'error');
  if (failedTools.length > 0) {
    const first = failedTools[0];
    const toolName = first.name.replace('agent.tool.', '');
    const err = spanError(first) ?? 'unknown error';
    evidence.push(`${toolName} failed: ${err}`);
    if (toolName === 'edit_file' || err.includes('old_string')) {
      return withLog(result, {
        category: 'tool_misuse',
        rootCause: 'edit_file failed because the old_string did not match. The agent may not have read the file first or copied the exact text.',
        evidence,
      });
    }
    return withLog(result, {
      category: 'tool_misuse',
      rootCause: `Tool ${toolName} was invoked but failed.`,
      evidence,
    });
  }

  const providers = providerSpans(traceFlow);
  const failedProviders = providers.filter((s) => s.status === 'error');
  if (failedProviders.length > 0) {
    const err = spanError(failedProviders[0]) ?? 'provider error';
    if (err.includes('JSON') || err.includes('parse') || err.includes('Unexpected token')) {
      return withLog(result, {
        category: 'parse_error',
        rootCause: 'Provider response could not be parsed as the expected format.',
        evidence: [err],
      });
    }
    return withLog(result, {
      category: 'model_error',
      rootCause: 'The provider request failed.',
      evidence: [err],
    });
  }

  const plan = planSpan(traceFlow);
  if (plan) {
    const planSteps = plan.attributes?.planSteps;
    const planStepsCount = typeof planSteps === 'number' ? planSteps : 0;
    if (planStepsCount === 0) {
      return withLog(result, {
        category: 'plan_error',
        rootCause: 'The planner produced an empty plan with no actionable steps.',
        evidence: ['planSteps: 0'],
      });
    }
    const providerTurns = providers.length;
    if (providerTurns > 10 && !result.evaluation.passed) {
      return withLog(result, {
        category: 'plan_error',
        rootCause: 'The agent took many turns without finishing; the plan may be stuck or too vague.',
        evidence: [`provider turns: ${String(providerTurns)}`, `plan steps: ${String(planStepsCount)}`],
      });
    }
  }

  const message = result.evaluation.message ?? result.agentRun?.resultStatus ?? 'unknown';
  return withLog(result, {
    category: 'unknown',
    rootCause: `Failure cause could not be classified: ${message}.`,
    evidence: [message],
  });
}

export function pickFocusResult(results: BenchmarkResult[], traceFlows: Map<string, TraceFlowInfo | undefined>): BenchmarkResult | undefined {
  const failed = results.filter((r) => !r.evaluation.passed);
  if (failed.length === 0) return undefined;

  const seenCategories = new Set<FailureCategory>();
  for (const result of failed) {
    const analysis = result.failureAnalysis ?? classifyFailure(result, traceFlows.get(result.harnessTaskId));
    if (!seenCategories.has(analysis.category)) {
      seenCategories.add(analysis.category);
      return result;
    }
  }

  return failed[0];
}

export function summariseFailures(results: BenchmarkResult[], traceFlows: Map<string, TraceFlowInfo | undefined>): { category: FailureCategory; count: number; examples: string[] }[] {
  const counts = new Map<FailureCategory, { count: number; examples: string[] }>();
  for (const result of results) {
    if (result.evaluation.passed) continue;
    const analysis = result.failureAnalysis ?? classifyFailure(result, traceFlows.get(result.harnessTaskId));
    const entry = counts.get(analysis.category) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 3) {
      entry.examples.push(`${result.task.name}: ${analysis.rootCause}`);
    }
    counts.set(analysis.category, entry);
  }
  return Array.from(counts.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.count - a.count);
}

export interface PromptVersionScore {
  promptVersionId?: string;
  promptHash?: string;
  runs: number;
  passed: number;
  failed: number;
  averageScore: number;
  averageDurationMs: number;
}

export function scoreByPromptVersion(reports: { promptVersionId?: string; promptHash?: string; results: BenchmarkResult[] }[]): PromptVersionScore[] {
  const byVersion = new Map<string, PromptVersionScore>();
  for (const report of reports) {
    for (const result of report.results) {
      const key = result.promptHash ?? report.promptHash ?? 'unknown';
      const existing = byVersion.get(key) ?? {
        promptVersionId: result.promptVersionId ?? report.promptVersionId,
        promptHash: result.promptHash ?? report.promptHash,
        runs: 0,
        passed: 0,
        failed: 0,
        averageScore: 0,
        averageDurationMs: 0,
      };
      existing.runs++;
      if (result.evaluation.passed) existing.passed++;
      else existing.failed++;
      existing.averageScore += result.evaluation.score ?? 0;
      existing.averageDurationMs += result.durationMs;
      byVersion.set(key, existing);
    }
  }
  return Array.from(byVersion.values()).map((v) => ({
    ...v,
    averageScore: v.runs > 0 ? v.averageScore / v.runs : 0,
    averageDurationMs: v.runs > 0 ? v.averageDurationMs / v.runs : 0,
  }));
}
