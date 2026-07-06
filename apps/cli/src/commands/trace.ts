import { Command } from 'commander';
import { apiFetch } from '../api.js';

interface ToolSummary {
  tool: string;
  total: number;
  success: number;
  failure: number;
  successRate: number;
  sampleErrors: string[];
}

interface TraceAnalysis {
  taskId: string;
  agentRunId?: string;
  totalSpans: number;
  totalDurationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  toolSummary: ToolSummary[];
  topErrors: { tool?: string; message: string; time: string }[];
  phaseDurations: Record<string, number>;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, ' ');
}

function suggestSkillGaps(analysis: TraceAnalysis): string[] {
  const gaps: string[] = [];
  const byTool = new Map(analysis.toolSummary.map((t) => [t.tool, t]));

  const readFile = byTool.get('read_file');
  const editFile = byTool.get('edit_file');
  const codeOverview = byTool.get('code_overview');
  const lsp = byTool.get('lsp') ?? byTool.get('lsp_call');

  if (!codeOverview || codeOverview.total === 0) {
    gaps.push('The agent never used code_overview. Add a project-structure skill or prompt rule requiring a structural overview before editing.');
  }

  if (!lsp || lsp.total === 0) {
    gaps.push('The agent never used LSP tools. Add language-specific LSP skills (TypeScript, Go) and require symbol lookup before renames or wiring.');
  }

  if (editFile && editFile.failure > editFile.total * 0.3) {
    gaps.push('edit_file failure rate is high. Add a skill for safe multi-file edits, apply edits via AST/transform, and verify with read_file after editing.');
  }

  if (readFile && readFile.total > 20 && (!editFile || editFile.total < 5)) {
    gaps.push('High read_file count with few edits suggests analysis paralysis. Add a planner skill that caps exploration and forces an implementation plan.');
  }

  const missingSelectorHealth = analysis.topErrors.some(
    (e) => e.message.includes('selectorHealth') || e.message.includes('is not a function')
  );
  if (missingSelectorHealth) {
    gaps.push('Implementation gap: required API (e.g. logic.selectorHealth) is missing. Add a domain skill with a concrete checklist for wiring new APIs into Kea build/selectors.');
  }

  if (analysis.totalSpans < 10) {
    gaps.push('Trace span count is very low; verify tracing is enabled and spans are flushed before the process exits.');
  }

  return gaps;
}

const analyzeCmd = new Command('analyze')
  .description('Analyze task trace and suggest skill gaps')
  .argument('<id>', 'task id')
  .action(async (id: string) => {
    const data = (await apiFetch(`/tasks/${id}/trace-analysis`)) as TraceAnalysis;

    console.log(`Trace analysis for task ${data.taskId}`);
    if (data.agentRunId) {
      console.log(`Agent run: ${data.agentRunId}`);
    }
    console.log(
      `Spans: ${String(data.totalSpans)} | Duration: ${formatMs(data.totalDurationMs)} | Tokens: ${
        data.totalTokens === undefined ? 'n/a' : String(data.totalTokens)
      }`
    );

    console.log('\nPhase durations:');
    const phaseEntries = Object.entries(data.phaseDurations).sort((a, b) => b[1] - a[1]);
    if (phaseEntries.length === 0) {
      console.log('  (none)');
    } else {
      const max = phaseEntries[0]?.[1] ?? 1;
      for (const [name, ms] of phaseEntries) {
        const barLen = max > 0 ? Math.round((ms / max) * 30) : 0;
        const bar = '█'.repeat(barLen);
        console.log(`  ${name.padEnd(18)} ${formatMs(ms).padStart(8)} ${bar}`);
      }
    }

    console.log('\nTool summary:');
    if (data.toolSummary.length === 0) {
      console.log('  (none)');
    } else {
      const maxTotal = Math.max(...data.toolSummary.map((t) => t.total), 1);
      const totalWidth = String(maxTotal).length;
      for (const t of data.toolSummary) {
        const barLen = Math.round((t.total / maxTotal) * 20);
        const bar = '█'.repeat(barLen);
        console.log(
          `  ${t.tool.padEnd(18)} ${pad(t.success, totalWidth)}/${pad(t.total, totalWidth)} success (${
            String(t.successRate)
          }) ${bar}`
        );
        for (const err of t.sampleErrors.slice(0, 2)) {
          const snippet = err.length > 90 ? `${err.slice(0, 90)}…` : err;
          console.log(`      ⚠ ${snippet}`);
        }
      }
    }

    if (data.topErrors.length > 0) {
      console.log('\nTop errors:');
      for (const err of data.topErrors.slice(0, 5)) {
        const tool = err.tool ? `[${err.tool}] ` : '';
        const snippet = err.message.length > 100 ? `${err.message.slice(0, 100)}…` : err.message;
        console.log(`  ${tool}${snippet}`);
      }
    }

    const gaps = suggestSkillGaps(data);
    if (gaps.length > 0) {
      console.log('\nSuggested skill gaps:');
      for (const gap of gaps) {
        console.log(`  • ${gap}`);
      }
    }
  });

const flowCmd = new Command('flow')
  .description('Show hierarchical trace flow for a task')
  .argument('<id>', 'task id')
  .action(async (id: string) => {
    const data = (await apiFetch(`/tasks/${id}/trace-flow`)) as {
      traceId?: string;
      spans: {
        spanId: string;
        name: string;
        status: string;
        startTime: string;
        endTime?: string;
        children?: unknown[];
      }[];
    };
    console.log(`Trace flow for task ${id} (${data.traceId ?? 'no trace id'})`);

    function printSpan(span: typeof data.spans[number], depth = 0) {
      const start = new Date(span.startTime).toISOString().slice(11, 19);
      const indent = '  '.repeat(depth);
      const status = span.status === 'error' ? '✗' : '•';
      console.log(`${indent}${status} [${start}] ${span.name}`);
      for (const child of span.children ?? []) {
        printSpan(child as typeof span, depth + 1);
      }
    }

    for (const span of data.spans) {
      printSpan(span);
    }
  });

export const traceCmd = new Command('trace')
  .description('Trace and observability commands')
  .addCommand(analyzeCmd)
  .addCommand(flowCmd);
