import type { Provider, ToolDefinition, SendOptions } from '@omega/core';
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

export const PLAN_PROMPT = `You are a planning assistant. Given a task, produce a concise step-by-step plan.

Respond with strict JSON in this exact shape (no markdown):
{
  "reasoning": "brief reasoning",
  "plan": [
    { "name": "step name", "tool": "optional tool name", "input": { optional tool args } }
  ]
}

Available tools:
${toolDescriptions}

If a step does not need a tool, omit tool/input. Use edit_file for small file changes. When planning run_command steps, use only simple single commands without pipes (|), &&, ;, redirects, unquoted globs, or $(). Quote literal globs in arguments if needed, e.g., find . -name "*.ts".

When the task involves a test suite or failing tests, the first steps must be: (1) run the focused test command to identify failures, (2) read the failing test files, and only then (3) implement the smallest fix. Detect the language from the build files (go.mod/Cargo.toml/pyproject.toml/package.json) and use the matching build and test command. The plan MUST end with a verification step that runs the project's build/compile command and existing-test command and confirms both pass before finish — a broken build scores zero. If the task adds new behavior, the verification step must also run the new feature tests (f2p) and fix every failure; passing existing tests (p2p) alone is insufficient. If the task adds a public API to an existing framework, include a step to wire it into the existing entry point/builder and a verify_api_surface check.

If the project context contains a detailed skill with exact edit_file/write_file blocks and verification commands, base the plan on that skill. Treat the skill as the reference implementation: perform the exact edits in order, run the skill's verification commands, and do not invent alternative approaches unless a skill step fails.`;

export async function createPlan(
  provider: Provider,
  taskTitle: string,
  taskDescription?: string,
  context?: string,
  onUsage?: SendOptions['onUsage']
): Promise<PlannerResult> {
  const contextBlock = context ? `\n\nProject context:\n${context}` : '';
  const prompt = `${PLAN_PROMPT}${contextBlock}\n\nTask: ${taskTitle}\n${taskDescription ? `Description: ${taskDescription}\n` : ''}`;
  // Try tool-aware path first, fall back to plain send.
  // Skips sendWithTools for providers known to 429 on tool endpoints (GLM/Z.AI).
  let raw: string;
  const providerConfig = 'config' in provider ? (provider as { config: { name: string } }).config : undefined;
  if (providerConfig?.name !== 'glm' && 'sendWithTools' in provider && typeof provider.sendWithTools === 'function') {
    raw = await provider.sendWithTools(prompt, PLANNING_TOOLS, {
      system: PLAN_PROMPT,
      temperature: 0.2,
      onUsage,
    });
  } else {
    raw = await provider.send(prompt, { system: PLAN_PROMPT, temperature: 0.2, onUsage });
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
        { name: 'Explore package and entry files', tool: 'read_file', input: { path: 'package.json' } },
        { name: 'Explore source layout', tool: 'list_files', input: { path: '.', recursive: true } },
        { name: 'Read relevant source files', tool: 'think', input: { thought: 'Read the source files most relevant to the task.' } },
        { name: 'Implement change', tool: 'think', input: { thought: 'Make the smallest edits that satisfy the task requirements.' } },
        { name: 'Validate', tool: 'run_command', input: { command: 'npm test' } },
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
