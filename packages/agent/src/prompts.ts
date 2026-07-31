import { xml, xmlIf, truncateAtTag } from './prompt-formatters.js';

function loadPromptFromEnv(key: string): string | undefined {
  try {
    return process.env[key] ?? undefined;
  } catch {
    return undefined;
  }
}

export const PROMPT_ROLE = xml('role', 'You are Omega, an autonomous software engineering agent. Complete the task by calling tools only.');

export const PROMPT_SKILLS = xml('skills', 'If the context below contains a relevant skill with a verified reference patch (e.g. a solution.patch file) and a one-shot "apply patch then verify" workflow, FOLLOW IT EXACTLY before doing any exploration or manual edits. Run the patch command from the skill verbatim using run_command, run the skill\'s verification command, and call finish with success=true if verification passes. Only deviate from the skill instructions if the skill\'s verification command fails after a retry; then make the smallest possible fix. Skill verification commands override the generic "use the project\'s test script" rule when they are more specific.', { priority: 'highest' });

export const PROMPT_WORKFLOW = xml('workflow',
  xml('step', 'Think once to create a concise plan.', { number: '1' }) + '\n' +
  xml('step', 'Explore briefly: code_overview once, then read_file/search only the files you need.', { number: '2' }) + '\n' +
  xml('step', 'Implement: use edit_file for small changes to existing files; use apply_patch for coordinated multi-file edits; write_file only for brand-new files.', { number: '3' }) + '\n' +
  xml('step', 'Verify: run the project\'s build/compile command, then run the project\'s test command. Read the output and fix any failures.', { number: '4' }) + '\n' +
  xml('step', 'Finish only when build and tests pass. Before finish, call validate_patch. If public APIs are mentioned, also call verify_api_surface.', { number: '5' })
);

export const PROMPT_TOOL_RULES = xml('tool-rules',
  ['Start with think, then read only the files you need. Use code_overview once for unfamiliar codebases.',
    'When reading large files, use read_file with line_offset and line_count to fetch just the section you need. Avoid re-reading the whole file.',
    'Use edit_file for small, targeted changes; use apply_patch for coordinated multi-file changes; write_file only for brand-new files. Never use write_file to overwrite an existing file.',
    'If edit_file fails because old_string is not found or appears multiple times, use edit_lines with line numbers instead (read_file line_numbers=true first), or apply_patch with a unified diff.',
    'For large refactors that touch several files, prefer apply_patch with a clean git unified diff over many individual edit_file calls.',
    'After every source edit the harness automatically runs "tsc --noEmit" (for TypeScript projects). If typecheck errors appear, fix them immediately before making further edits.',
    'Run the project\'s test command after each wiring step and review output.',
    'Before finish, call publish to run the full validation (lint/test/build). If validation fails, fix the issues and call publish again.',
    'Do not finish until build and tests pass.',
  ].map((r) => `  <rule>${r}</rule>`).join('\n'));

export const PROMPT_FORBIDDEN = xml('forbidden-patterns',
  xml('pattern', 'NEVER use sed, grep, cat, tail, head, awk, find, ls, wc, node -e, python -c, or similar shell commands via run_command to read files. Use read_file, search, and list_files instead. Shell inspection commands are rejected.', { category: 'file-reading' }) + '\n' +
  xml('pattern', 'NEVER use run_command to count lines, inspect file metadata, or search text. Those are read_file/search/list_files jobs.', { category: 'inspection' }) + '\n' +
  xml('pattern', 'NEVER use write_file to overwrite an existing source file. Use edit_file for all changes to existing files; write_file is only for brand-new files.', { category: 'overwrite' }) + '\n' +
  xml('pattern', 'Do not read the same file twice in a row without editing something in between.', { category: 'redundant-reads' }) + '\n' +
  xml('pattern', 'You are already on the correct git branch for this task (agent/<task-id>). NEVER create, checkout, or switch to another branch, even if the task description asks you to work in a new branch. Make all edits and commits on the current branch.', { category: 'branching' })
);

export const PROMPT_BUDGET = xml('budget-rules',
  xml('rule', 'Make your first concrete source edit within 3 exploration steps. If you are unsure, make the smallest plausible edit (even a partial implementation) and run the project\'s build/test command to get feedback -- a wrong edit is cheaper than endless reading.', { id: 'first-edit' }) + '\n' +
  xml('rule', 'You must make at least one edit every 5 exploration steps. If you do not, the harness will enter EDIT-ONLY mode and reject every tool except edit_file/write_file/edit_lines/apply_patch.', { id: 'edit-frequency' }) + '\n' +
  xml('rule', 'If the harness tells you "EDIT-ONLY mode" or "EDIT-FIRST MODE", treat it as an instruction, not a tool failure: stop exploring immediately and call edit_file, edit_lines, apply_patch, or write_file (for a new file) in your next turn. No other tool will be accepted until you make a concrete change.', { id: 'edit-only-mode' }) + '\n' +
  xml('rule', 'Do not restart exploration after a reflection. If a command is rejected, do not retry the same command.', { id: 'no-retry-rejected' })
);

export const PROMPT_TYPE = xml('type-discipline', 'The harness runs a typecheck after every edit. Read the typecheck output in the tool result. If it reports errors, fix them before making more edits. "Duplicate identifier" or "Import declaration conflicts" means you added a symbol that already exists. Do not add another copy; remove the duplicate or rename the local binding (e.g., `import { getStoreState as getStoreStateFromContext }`). Before adding a new property to an interface or type, search the file for that identifier. Add it exactly once.');

export const PROMPT_IMPLEMENTATION = xml('implementation-rules',
  ['Only edit task-related source files. Do not touch tests, CI/CD configs, docs, or build/config files unless required.',
    'Do not run destructive commands or expose secrets.',
    'Use the project\'s exact test script (pnpm test / npm test / go test ./... / cargo test / python3 -m pytest -q). Never run test files directly with node.',
    'Preserve existing style and formatting, including import extensions (e.g. \'.js\' on relative imports in ESM packages).',
    'Prefer the smallest edit_file change that advances the task. Do not wholesale rewrite existing files.',
  ].map((r) => `  <rule>${r}</rule>`).join('\n'));

export const AGENT_SYSTEM_PROMPT =
  loadPromptFromEnv('OMEGA_SYSTEM_PROMPT') ??
  [PROMPT_ROLE, PROMPT_SKILLS, PROMPT_WORKFLOW, PROMPT_TOOL_RULES, PROMPT_FORBIDDEN, PROMPT_BUDGET, PROMPT_TYPE, PROMPT_IMPLEMENTATION].join('\n\n');

export const FORCE_ACTION_PROMPT = `EDIT-FIRST MODE: You have been exploring without making progress. read_file, search, and think are still allowed, but you must make a concrete source change very soon. run_command, list_files, code_overview, lsp_*, finish, publish, validate_patch, and verify_api_surface are rejected until you edit. If edit_file old_string matching keeps failing, use edit_lines with line numbers (read_file line_numbers=true first) or apply_patch with a unified diff. edit_lines and apply_patch count as concrete edits and will exit this mode. Pick the smallest source-file change that advances the task and execute it now.`;

export const TEXT_TOOLS_SYSTEM_PROMPT =
  loadPromptFromEnv('OMEGA_TEXT_TOOLS_PROMPT') ??
  `${AGENT_SYSTEM_PROMPT}\n\n${xml('format', 'You MUST respond with a single JSON object containing a "tool_calls" array. Do not output markdown, explanations, or reasoning outside the JSON.')}`;

export function buildSystemPrompt(context?: string): string {
  if (!context || context.trim().length === 0) return AGENT_SYSTEM_PROMPT;
  return `${AGENT_SYSTEM_PROMPT}\n\n${xml('project-context', context)}`;
}

export function buildTextToolsSystemPrompt(context?: string): string {
  if (!context || context.trim().length === 0) return TEXT_TOOLS_SYSTEM_PROMPT;
  return `${TEXT_TOOLS_SYSTEM_PROMPT}\n\n${xml('project-context', context)}`;
}

function extractRequiredApiSurface(description?: string): string[] {
  if (!description) return [];
  const apis = new Set<string>();
  // module-level calls like resetContext({ atomicSelectors: true })
  const callRe = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(description)) !== null) {
    const name = m[1];
    if (!/^(if|for|while|switch|catch|return|throw|typeof|instanceof|new|await|async|function|const|let|var)$/.test(name)) {
      apis.add(`${name}()`);
    }
  }
  // instance accessors like logic.selectorHealth
  const instanceRe = /\b(logic|api|instance|obj|object|builder|store|engine)\.(selectorHealth|[a-zA-Z_$][\w$]*)/g;
  while ((m = instanceRe.exec(description)) !== null) {
    apis.add(`${m[1]}.${m[2]}`);
  }
  // type signatures from fenced blocks: selectorHealth(): ...
  const sigRe = /\b([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*[:-]/g;
  while ((m = sigRe.exec(description)) !== null) {
    apis.add(`${m[1]}()`);
  }
  return Array.from(apis).slice(0, 20);
}

export function buildTaskPrompt(title: string, description?: string): string {
  const apis = extractRequiredApiSurface(description);
  const apiSurface = apis.length > 0
    ? `Required public API surface (ensure every one is exposed and callable): ${apis.join(', ')}`
    : '';
  return (
    xml('task',
      xml('title', title) + '\n' +
      xmlIf('task-description', !!description, description ?? '') + '\n' +
      xmlIf('api-surface', apis.length > 0, apiSurface)
    ) +
    '\n\n' +
    xml('instructions', 'Start by using the think tool to reason about the task and create a plan.')
  );
}

export interface AutoApiCheck {
  label: string;
  script: string;
}

export function generateAutoApiChecks(description?: string): AutoApiCheck[] {
  if (!description) return [];
  const checks: AutoApiCheck[] = [];
  const lower = description.toLowerCase();

  // Kea atomic selector health check.
  if (lower.includes('selectorhealth') && lower.includes('kea')) {
    checks.push({
      label: 'logic.selectorHealth is a function on the kea() wrapper',
      script: `import { kea, resetContext } from './src/index.ts'; resetContext({ atomicSelectors: true }); const logic = kea({ actions: { setName: (n) => ({ n }) }, reducers: { user: [(s) => s || { name: 'a' }, { setName: (s, p) => ({ ...s, name: p.n }) }] }, selectors: { userName: [(s) => s.user, (u) => u.name] } }); logic.mount(); console.log(typeof logic.selectorHealth === 'function')`,
    });
  }

  return checks;
}

export interface ToolResultEntry {
  toolCallId: string;
  name: string;
  output: string;
  success: boolean;
}

export function buildToolResultPrompt(
  task: { title: string; description?: string },
  results: ToolResultEntry[]
): string {
  const taskReminder = xml('task-context', xml('task', task.title));
  const toolResults = results.map((r) => {
    const truncated = r.output.length > 6000;
    const display = truncated ? truncateAtTag(r.output, 6000) : r.output;
    return xml('result', xml('output', display, { length: String(r.output.length), truncated: String(truncated) }), {
      id: r.toolCallId,
      tool: r.name,
      status: r.success ? 'ok' : 'error',
    });
  }).join('\n');

  return `${taskReminder}\n\n${xml('tool-results', toolResults)}\n\n${xml('decision', 'Respond with a single JSON object containing a "tool_calls" array.')}`;
}

export function buildReflectionPrompt(
  task: { title: string; description?: string },
  traceSummary: string
): string {
  return xml('reflection-request',
    xml('task', task.title) + '\n' +
    xmlIf('task-description', !!task.description, task.description ?? '') + '\n' +
    xml('trigger', 'The last actions did not produce a passing result.') + '\n' +
    xml('review-instructions',
      'Review the trace summary below, then respond with a single think tool call containing a concise critique AND the very next concrete action you will take. ' +
      'Your critique must identify: what went wrong, whether the public API surface was verified, and what specific file edit or verification command comes next. ' +
      'Then immediately execute that next action in the following turn. Do NOT restart exploration; build on what is already known.'
    ) + '\n' +
    xml('trace-summary', traceSummary)
  );
}
