import type { PrismaClient } from '@omega/db';

export interface PromptContextSummary {
  text: string;
  runsAnalysed: number;
  topFailure?: string;
}

interface ValidationSummary {
  lint?: { success: boolean };
  test?: { success: boolean };
  build?: { success: boolean };
  allPassed?: boolean;
}

function parseValidationSummary(raw: string | null | undefined): ValidationSummary | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ValidationSummary;
  } catch {
    return undefined;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function extractTaskKeywords(description?: string | null): string[] {
  if (!description) return [];
  const keywords: string[] = [];
  const lower = description.toLowerCase();
  const patterns: Record<string, string[]> = {
    async: ['async', 'await', 'promise', 'callback', 'queue', 'event loop', 'timers'],
    validation: ['throw', 'error', 'invalid', 'validate', 'constructor'],
    geometry: ['intersection', 'observer', 'viewport', 'rect', 'margin'],
    slicing: ['slice', 'range', 'index', 'array', 'string'],
    parsing: ['parse', 'token', 'lexer', 'ast', 'grammar'],
    types: ['typescript', 'type', 'generic', 'interface'],
    frontend: ['react', 'component', 'dom', 'css', 'html'],
    testing: ['test', 'mock', 'stub', 'jest', 'vitest'],
  };
  for (const [hint, terms] of Object.entries(patterns)) {
    if (terms.some((t) => lower.includes(t))) {
      keywords.push(hint);
    }
  }
  return [...new Set(keywords)];
}

function buildTaskSpecificHints(keywords: string[]): string {
  if (keywords.length === 0) return '';
  const hints: Record<string, string> = {
    async:
      'Async behaviour: ensure callbacks are deferred (setImmediate/nextTick), never invoked synchronously. Verify timers are cleaned up.',
    validation:
      'Validation: throw explicit errors for invalid constructor arguments, out-of-range values, and wrong types. Check error messages match specs exactly.',
    geometry:
      'Geometry: compute rectangles deterministically. Handle zero-area targets, rootMargin expansion, and viewport vs element roots.',
    slicing:
      'Slicing: preserve two-part range behaviour while adding three-part step support. Handle negative step and omitted components.',
    parsing:
      'Parsing: keep grammar changes minimal. Update both parser and AST stringification. Add targeted parser tests.',
    types:
      'Types: prefer incremental type changes. Run tsc after edits to catch inference regressions.',
    frontend:
      'Frontend: preserve component contracts. Verify with component tests and visual/layout assertions.',
    testing:
      'Testing: run the relevant focused test suite first, then the full suite. Read failing test output carefully.',
  };
  return keywords
    .map((k) => hints[k])
    .filter(Boolean)
    .join('\n');
}

export async function buildPromptContext(
  prisma: PrismaClient,
  projectId: string,
  options: { lookbackRuns?: number; taskDescription?: string | null } = {}
): Promise<PromptContextSummary> {
  const lookback = options.lookbackRuns ?? 5;

  const recentRuns = await prisma.agentRun.findMany({
    where: { task: { projectId } },
    orderBy: { createdAt: 'desc' },
    take: lookback,
    include: { task: { select: { id: true, description: true, title: true } } },
  });

  if (recentRuns.length === 0) {
    const hints = buildTaskSpecificHints(extractTaskKeywords(options.taskDescription));
    return {
      text: hints ? `Task-specific guidance:\n${hints}` : '',
      runsAnalysed: 0,
    };
  }

  const taskIds = recentRuns.map((r) => r.task.id);

  const [toolSpans, failedSteps, recentFailedTasks] = await Promise.all([
    prisma.traceSpan.groupBy({
      by: ['name', 'status'],
      where: {
        taskId: { in: taskIds },
        name: { startsWith: 'agent.tool.' },
      },
      _count: { status: true },
    }),
    prisma.taskStep.findMany({
      where: {
        taskId: { in: taskIds },
        status: 'failed',
      },
      select: { name: true, error: true, taskId: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        id: { in: taskIds },
        status: 'failed',
      },
      select: { id: true, title: true, result: true, error: true },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    }),
  ]);

  // Aggregate tool success/error counts by tool name.
  const toolStats: Record<string, { ok: number; error: number; total: number; avgMs?: number }> = {};
  for (const row of toolSpans) {
    const tool = row.name.replace('agent.tool.', '');
    const entry = toolStats[tool] ?? { ok: 0, error: 0, total: 0 };
    const count = row._count.status;
    if (row.status === 'ok') entry.ok += count;
    else if (row.status === 'error') entry.error += count;
    entry.total += count;
    toolStats[tool] = entry;
  }

  // Compute average duration per tool from spans with start/end times.
  const durationRows = await prisma.traceSpan.findMany({
    where: {
      taskId: { in: taskIds },
      name: { startsWith: 'agent.tool.' },
      endTime: { not: null },
    },
    select: { name: true, startTime: true, endTime: true },
  });
  const durationAccum: Record<string, { total: number; count: number }> = {};
  for (const row of durationRows) {
    if (!row.endTime) continue;
    const tool = row.name.replace('agent.tool.', '');
    const ms = row.endTime.getTime() - row.startTime.getTime();
    const entry = durationAccum[tool] ?? { total: 0, count: 0 };
    entry.total += ms;
    entry.count += 1;
    durationAccum[tool] = entry;
  }
  for (const [tool, acc] of Object.entries(durationAccum)) {
    const stats = toolStats[tool] ?? { ok: 0, error: 0, total: 0 };
    if (acc.count > 0) {
      stats.avgMs = Math.round(acc.total / acc.count);
    }
    toolStats[tool] = stats;
  }

  // Determine most common validation failure.
  const failureCounts: Record<string, number> = {};
  for (const run of recentRuns) {
    const summary = parseValidationSummary(run.validationSummary);
    if (!summary || summary.allPassed) continue;
    for (const key of ['lint', 'test', 'build'] as const) {
      const step = summary[key];
      if (step && !step.success) {
        failureCounts[key] = (failureCounts[key] ?? 0) + 1;
      }
    }
  }
  const topFailure = Object.entries(failureCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Collect recent edit_file misses.
  const editMisses = failedSteps
    .filter((s) => s.name.includes('edit_file') || s.error?.includes('old_string'))
    .slice(0, 3)
    .map((s) => s.error?.split('\n')[0] ?? s.name);

  // Build failure pattern summary from failed task results and last failed steps.
  const failurePatterns: string[] = [];
  for (const task of recentFailedTasks) {
    const lastFailedSteps = failedSteps
      .filter((s) => s.taskId === task.id)
      .slice(0, 2)
      .map((s) => s.name)
      .join(', ');
    const detail = task.error ?? task.result ?? 'no detail';
    failurePatterns.push(`- ${task.title}: ${detail.slice(0, 160)}${detail.length > 160 ? '...' : ''} (failed steps: ${lastFailedSteps || 'unknown'})`);
  }

  const lines: string[] = [];
  lines.push('Recent project context (last few runs):');
  lines.push(`- Agent runs analysed: ${String(recentRuns.length)}`);
  if (topFailure) {
    lines.push(`- Most common validation failure: ${topFailure}. Run ${topFailure} early and carefully.`);
  }

  const toolLines = Object.entries(toolStats)
    .filter(([, s]) => s.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([tool, s]) => {
      const errRate = s.total > 0 ? Math.round((s.error / s.total) * 100) : 0;
      const avg = s.avgMs ? `, avg ${formatDuration(s.avgMs)}` : '';
      return `- ${tool}: ${String(s.total)} calls, ${String(errRate)}% error${avg}`;
    });
  if (toolLines.length > 0) {
    lines.push('- Tool usage:');
    lines.push(...toolLines);
  }

  if (failurePatterns.length > 0) {
    lines.push('- Recent failures to avoid repeating:');
    lines.push(...failurePatterns);
  }

  if (editMisses.length > 0) {
    lines.push('- Recent edit_file misses:');
    for (const miss of editMisses) {
      lines.push(`  * ${miss}`);
    }
    lines.push('  When using edit_file, read the file first and copy the exact old_string.');
  }

  const taskHints = buildTaskSpecificHints(extractTaskKeywords(options.taskDescription));
  if (taskHints) {
    lines.push('- Task-specific guidance:');
    lines.push(taskHints);
  }

  lines.push('Use this context to avoid repeating failures and to prioritise high-impact edits.');

  return {
    text: lines.join('\n'),
    runsAnalysed: recentRuns.length,
    topFailure,
  };
}
