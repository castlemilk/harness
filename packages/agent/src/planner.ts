import type { Provider, ToolDefinition } from '@omega/core';
import { AGENT_TOOLS } from './tool-definitions.js';

export interface PlanStep {
  name: string;
  tool?: string;
  input?: Record<string, unknown>;
}

export interface PlannerResult {
  plan: PlanStep[];
  reasoning: string;
}

const PLANNING_TOOLS: ToolDefinition[] = [
  {
    name: 'think',
    description: 'Record a planning thought.',
    parameters: {
      type: 'object',
      properties: { thought: { type: 'string' } },
      required: ['thought'],
    },
  },
];

const toolDescriptions = AGENT_TOOLS.map(
  (t) => `- ${t.name}: ${t.description}`
).join('\n');

const PLAN_PROMPT = `You are a planning assistant. Given a task, produce a concise step-by-step plan.

Respond with strict JSON in this exact shape (no markdown):
{
  "reasoning": "brief reasoning",
  "plan": [
    { "name": "step name", "tool": "optional tool name", "input": { optional tool args } }
  ]
}

Available tools:
${toolDescriptions}

If a step does not need a tool, omit tool/input. Use edit_file for small file changes.`;

export async function createPlan(provider: Provider, taskTitle: string, taskDescription?: string): Promise<PlannerResult> {
  const prompt = `${PLAN_PROMPT}\n\nTask: ${taskTitle}\n${taskDescription ? `Description: ${taskDescription}\n` : ''}`;
  // Try tool-aware path first, fall back to plain send.
  let raw: string;
  if ('sendWithTools' in provider && typeof provider.sendWithTools === 'function') {
    raw = await provider.sendWithTools(prompt, PLANNING_TOOLS, {
      system: PLAN_PROMPT,
      temperature: 0.2,
    });
  } else {
    raw = await provider.send(prompt, { system: PLAN_PROMPT, temperature: 0.2 });
  }

  try {
    const parsed = JSON.parse(stripMarkdown(raw)) as PlannerResult;
    if (!Array.isArray(parsed.plan)) {
      throw new Error('plan is not an array');
    }
    return parsed;
  } catch {
    // Fallback: treat the whole response as reasoning and create a generic plan.
    return {
      reasoning: raw,
      plan: [
        { name: 'Explore codebase', tool: 'run_command', input: { command: 'find . -type f -name "*.ts"' } },
        { name: 'Implement change', tool: 'think', input: { thought: 'Implement the requested change.' } },
        { name: 'Validate', tool: 'run_command', input: { command: 'pnpm lint' } },
        { name: 'Finish', tool: 'finish', input: { summary: 'Task complete.', success: true } },
      ],
    };
  }
}

function stripMarkdown(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
  }
  return trimmed;
}
