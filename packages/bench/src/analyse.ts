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

function validationSummary(result: BenchmarkResult): { allPassed?: boolean; lint?: { success?: boolean }; test?: { success?: boolean }; build?: { success?: boolean } } | undefined {
  if (!result.agentRun?.validationSummary) return undefined;
  try {
    return JSON.parse(result.agentRun.validationSummary) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function classifyFailure(result: BenchmarkResult, traceFlow?: TraceFlowInfo): FailureAnalysis {
  const evidence: string[] = [];

  if (result.status === 'timeout') {
    return {
      category: 'timeout',
      rootCause: 'Task did not finish within the timeout window.',
      evidence: [`durationMs: ${String(result.durationMs)}`],
    };
  }

  const validation = validationSummary(result);
  if (validation?.allPassed === false) {
    const failedSteps: string[] = [];
    for (const key of ['lint', 'test', 'build'] as const) {
      const step = validation[key];
      if (step && !step.success) {
        failedSteps.push(key);
      }
    }
    return {
      category: 'validation_failure',
      rootCause: `Validation failed: ${failedSteps.length > 0 ? failedSteps.join(', ') : 'unspecified step'}.`,
      evidence: failedSteps.map((s) => `${s} did not pass`),
    };
  }

  const tools = toolSpans(traceFlow);
  const failedTools = tools.filter((s) => s.status === 'error');
  if (failedTools.length > 0) {
    const first = failedTools[0];
    const toolName = first.name.replace('agent.tool.', '');
    const err = spanError(first) ?? 'unknown error';
    evidence.push(`${toolName} failed: ${err}`);
    if (toolName === 'edit_file' || err.includes('old_string')) {
      return {
        category: 'tool_misuse',
        rootCause: 'edit_file failed because the old_string did not match. The agent may not have read the file first or copied the exact text.',
        evidence,
      };
    }
    return {
      category: 'tool_misuse',
      rootCause: `Tool ${toolName} was invoked but failed.`,
      evidence,
    };
  }

  const providers = providerSpans(traceFlow);
  const failedProviders = providers.filter((s) => s.status === 'error');
  if (failedProviders.length > 0) {
    const err = spanError(failedProviders[0]) ?? 'provider error';
    if (err.includes('JSON') || err.includes('parse') || err.includes('Unexpected token')) {
      return {
        category: 'parse_error',
        rootCause: 'Provider response could not be parsed as the expected format.',
        evidence: [err],
      };
    }
  }

  const plan = planSpan(traceFlow);
  if (plan) {
    const planSteps = plan.attributes?.planSteps;
    const planStepsCount = typeof planSteps === 'number' ? planSteps : 0;
    if (planStepsCount === 0) {
      return {
        category: 'plan_error',
        rootCause: 'The planner produced an empty plan with no actionable steps.',
        evidence: ['planSteps: 0'],
      };
    }
    const providerTurns = providers.length;
    if (providerTurns > 10 && !result.evaluation.passed) {
      return {
        category: 'plan_error',
        rootCause: 'The agent took many turns without finishing; the plan may be stuck or too vague.',
        evidence: [`provider turns: ${String(providerTurns)}`, `plan steps: ${String(planStepsCount)}`],
      };
    }
  }

  const message = result.evaluation.message ?? result.agentRun?.resultStatus ?? 'unknown';
  return {
    category: 'unknown',
    rootCause: `Failure cause could not be classified: ${message}.`,
    evidence: [message],
  };
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
