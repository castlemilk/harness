# Structured Prompt Architecture — Implementation Plan

> **For agentic workers:** This plan implements Phase 1 of the Structured Prompt Architecture spec (`docs/superpowers/specs/2026-07-30-structured-prompt-architecture-design.md`).

**Goal:** Replace flat markdown prompts with XML-tagged prompts for better LLM instruction adherence.

**Architecture:** Three stateless formatter functions in a new `prompt-formatters.ts`; rewritten prompt constants and builders in `prompts.ts`; minimal caller change in `agent-loop.ts` to pass tool name/success through the result type.

**Tech Stack:** TypeScript, Node.js (no dependencies)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/agent/src/prompt-formatters.ts` | Create | `xml()`, `xmlIf()`, `truncateAtTag()` utilities |
| `packages/agent/src/prompts.ts` | Rewrite | All prompt constants and builders in XML format |
| `packages/agent/src/agent-loop.ts` | Modify | Add `name` and `success` to tool result objects |
| `packages/agent/src/agent-helpers.ts` | Verify | No changes needed — imports `buildReflectionPrompt` by name |
| `packages/agent/src/prompt-versioning.ts` | Verify | Regex parsers must still match (they will — same template literal structure) |

---

## Chunk 1: `prompt-formatters.ts`

**Files:**
- Create: `packages/agent/src/prompt-formatters.ts`

- [ ] **Step 1: Create the file**

```typescript
export function xml(tag: string, content: string, attrs?: Record<string, string>): string {
  const attrStr = attrs
    ? ' ' + Object.entries(attrs)
        .map(([k, v]) => `${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
        .join(' ')
    : '';
  return `<${tag}${attrStr}>${content}</${tag}>`;
}

export function xmlIf(tag: string, condition: boolean, content: string): string {
  if (!condition) return '';
  return `<${tag}>${content}</${tag}>`;
}

export function truncateAtTag(text: string, maxLen: number, tagBoundary?: string): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  // Find the last complete closing tag within the truncated text
  const lastClose = cut.lastIndexOf('</');
  if (lastClose > maxLen * 0.8) {
    const endBracket = cut.indexOf('>', lastClose);
    if (endBracket !== -1) {
      return cut.slice(0, endBracket + 1) + '\n... [truncated]';
    }
  }
  // Fall back to word boundary
  const spaceAt = cut.lastIndexOf(' ');
  return (spaceAt > maxLen * 0.5 ? cut.slice(0, spaceAt) : cut) + '\n... [truncated]';
}
```

- [ ] **Step 2: Add as export in `packages/agent/src/tools.ts`** — NO, this is not a tool. It's a utility used by `prompts.ts`. Just import directly.

- [ ] **Step 3: Build check**

Run: `pnpm -r build`
Expected: Success (no errors since nothing imports the new module yet)

---

## Chunk 2: `AGENT_SYSTEM_PROMPT` and `TEXT_TOOLS_SYSTEM_PROMPT`

**Files:**
- Modify: `packages/agent/src/prompts.ts` (lines 9-59, 63-67)

- [ ] **Step 1: Import `xml` in prompts.ts**

Add at top of file:
```typescript
import { xml } from './prompt-formatters.js';
```

- [ ] **Step 2: Rewrite `AGENT_SYSTEM_PROMPT` constant**

Replace the current template literal with:

```typescript
export const AGENT_SYSTEM_PROMPT =
  loadPromptFromEnv('OMEGA_SYSTEM_PROMPT') ??
  xml('role', 'You are Omega, an autonomous software engineering agent. Complete the task by calling tools only.') +
  '\n\n' +
  xml('skills', 'If the context below contains a relevant skill with a verified reference patch (e.g. a solution.patch file) and a one-shot "apply patch then verify" workflow, FOLLOW IT EXACTLY before doing any exploration or manual edits. Run the patch command from the skill verbatim using run_command, run the skill\'s verification command, and call finish with success=true if verification passes. Only deviate from the skill instructions if the skill\'s verification command fails after a retry; then make the smallest possible fix.', { priority: 'highest' }) +
  '\n\n' +
  xml('workflow',
    xml('step', 'Think once to create a concise plan.', { number: '1' }) + '\n' +
    xml('step', 'Explore briefly: code_overview once, then read_file/search only the files you need.', { number: '2' }) + '\n' +
    xml('step', 'Implement: use edit_file for small changes to existing files; use apply_patch for coordinated multi-file edits; write_file only for brand-new files.', { number: '3' }) + '\n' +
    xml('step', 'Verify: run the project\'s build/compile command, then run the project\'s test command. Read the output and fix any failures.', { number: '4' }) + '\n' +
    xml('step', 'Finish only when build and tests pass. Before finish, call validate_patch. If public APIs are mentioned, also call verify_api_surface.', { number: '5' })
  ) +
  '\n\n' +
  xml('tool-rules', [
    'Start with think, then read only the files you need. Use code_overview once for unfamiliar codebases.',
    'When reading large files, use read_file with line_offset and line_count to fetch just the section you need. Avoid re-reading the whole file.',
    'Use edit_file for small, targeted changes; use apply_patch for coordinated multi-file changes; write_file only for brand-new files. Never use write_file to overwrite an existing file.',
    'If edit_file fails because old_string is not found or appears multiple times, use edit_lines with line numbers instead (read_file line_numbers=true first), or apply_patch with a unified diff.',
    'For large refactors that touch several files, prefer apply_patch with a clean git unified diff over many individual edit_file calls.',
    'After every source edit the harness automatically runs "tsc --noEmit" (for TypeScript projects). If typecheck errors appear, fix them immediately before making further edits.',
    'Run the project\'s test command after each wiring step and review output.',
    'Before finish, call publish to run the full validation (lint/test/build). If validation fails, fix the issues and call publish again.',
    'Do not finish until build and tests pass.',
  ].map((r) => `  <rule>${r}</rule>`).join('\n')) +
  '\n\n' +
  xml('forbidden-patterns',
    xml('pattern', 'NEVER use sed, grep, cat, tail, head, awk, find, ls, wc, node -e, python -c, or similar shell commands via run_command to read files. Use read_file, search, and list_files instead. Shell inspection commands are rejected.', { category: 'file-reading' }) + '\n' +
    xml('pattern', 'NEVER use run_command to count lines, inspect file metadata, or search text. Those are read_file/search/list_files jobs.', { category: 'inspection' }) + '\n' +
    xml('pattern', 'NEVER use write_file to overwrite an existing source file. Use edit_file for all changes to existing files; write_file is only for brand-new files.', { category: 'overwrite' }) + '\n' +
    xml('pattern', 'Do not read the same file twice in a row without editing something in between.', { category: 'redundant-reads' }) + '\n' +
    xml('pattern', 'You are already on the correct git branch for this task (agent/<task-id>). NEVER create, checkout, or switch to another branch, even if the task description asks you to work in a new branch. Make all edits and commits on the current branch.', { category: 'branching' })
  ) +
  '\n\n' +
  xml('budget-rules',
    xml('rule', 'Make your first concrete source edit within 3 exploration steps. If you are unsure, make the smallest plausible edit (even a partial implementation) and run the project\'s build/test command to get feedback — a wrong edit is cheaper than endless reading.', { id: 'first-edit' }) + '\n' +
    xml('rule', 'You must make at least one edit every 5 exploration steps. If you do not, the harness will enter EDIT-ONLY mode and reject every tool except edit_file/write_file/edit_lines/apply_patch.', { id: 'edit-frequency' }) + '\n' +
    xml('rule', 'If the harness tells you "EDIT-ONLY mode" or "EDIT-FIRST MODE", treat it as an instruction, not a tool failure: stop exploring immediately and call edit_file, edit_lines, apply_patch, or write_file (for a new file) in your next turn. No other tool will be accepted until you make a concrete change.', { id: 'edit-only-mode' }) + '\n' +
    xml('rule', 'Do not restart exploration after a reflection. If a command is rejected, do not retry the same command.', { id: 'no-retry-rejected' })
  ) +
  '\n\n' +
  xml('type-discipline', 'The harness runs a typecheck after every edit. Read the typecheck output in the tool result. If it reports errors, fix them before making more edits. "Duplicate identifier" or "Import declaration conflicts" means you added a symbol that already exists. Do not add another copy; remove the duplicate or rename the local binding (e.g., `import { getStoreState as getStoreStateFromContext }`). Before adding a new property to an interface or type, search the file for that identifier. Add it exactly once.') +
  '\n\n' +
  xml('implementation-rules', [
    'Only edit task-related source files. Do not touch tests, CI/CD configs, docs, or build/config files unless required.',
    'Do not run destructive commands or expose secrets.',
    'Use the project\'s exact test script (pnpm test / npm test / go test ./... / cargo test / python3 -m pytest -q). Never run test files directly with node.',
    'Preserve existing style and formatting, including import extensions (e.g. \'.js\' on relative imports in ESM packages).',
    'Prefer the smallest edit_file change that advances the task. Do not wholesale rewrite existing files.',
  ].map((r) => `  <rule>${r}</rule>`).join('\n'));
```

- [ ] **Step 3: Rewrite `TEXT_TOOLS_SYSTEM_PROMPT`**

```typescript
export const TEXT_TOOLS_SYSTEM_PROMPT =
  loadPromptFromEnv('OMEGA_TEXT_TOOLS_PROMPT') ??
  `${AGENT_SYSTEM_PROMPT}\n\n${xml('format', 'You MUST respond with a single JSON object containing a "tool_calls" array. Do not output markdown, explanations, or reasoning outside the JSON.')}`;
```

---

## Chunk 3: Prompt builder functions

**Files:**
- Modify: `packages/agent/src/prompts.ts` (lines 69-163)

- [ ] **Step 1: Add imports for `xml` and `xmlIf`**

```typescript
import { xml, xmlIf } from './prompt-formatters.js';
```

(If already imported from Chunk 2, verify it's there.)

- [ ] **Step 2: Rewrite `buildSystemPrompt`**

```typescript
export function buildSystemPrompt(context?: string): string {
  if (!context || context.trim().length === 0) return AGENT_SYSTEM_PROMPT;
  return `${AGENT_SYSTEM_PROMPT}\n\n${xml('project-context', context)}`;
}

export function buildTextToolsSystemPrompt(context?: string): string {
  if (!context || context.trim().length === 0) return TEXT_TOOLS_SYSTEM_PROMPT;
  return `${TEXT_TOOLS_SYSTEM_PROMPT}\n\n${xml('project-context', context)}`;
}
```

- [ ] **Step 3: Rewrite `buildTaskPrompt`**

```typescript
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
```

- [ ] **Step 4: Rewrite `buildToolResultPrompt`**

First, define a richer input type. Replace the old inline parameter type:

```typescript
export interface ToolResultEntry {
  toolCallId: string;
  name: string;
  output: string;
  success: boolean;
}
```

Then rewrite the function:

```typescript
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
```

- [ ] **Step 5: Rewrite `buildReflectionPrompt`**

```typescript
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
```

---

## Chunk 4: `agent-loop.ts` caller change

**Files:**
- Modify: `packages/agent/src/agent-loop.ts` (toolResults array construction)

- [ ] **Step 1: Update `buildToolResultPrompt` import**

Change the import line from:
```typescript
import { buildToolResultPrompt } from './prompts.js';
```
to also import `ToolResultEntry`:
```typescript
import { buildToolResultPrompt, type ToolResultEntry } from './prompts.js';
```

- [ ] **Step 2: Update the `toolResults` type and push calls**

Change the type annotation on line 247 from:
```typescript
const toolResults: { toolCallId: string; output: string }[] = [];
```
to:
```typescript
const toolResults: ToolResultEntry[] = [];
```

Then find every `toolResults.push(...)` call and ensure it includes `name` and `success`.

**Line 257** (rejectRemainingToolCalls):
```typescript
toolResults.push({ toolCallId: call.id, name: call.name, output, success: false });
```

**Line 289** (finish reject):
```typescript
toolResults.push({ toolCallId: call.id, name: 'finish', output: message, success: false });
```

**Line 392** (finish success):
```typescript
toolResults.push({ toolCallId: call.id, name: 'finish', output: summary, success: true });
```

**Line 418** (publish):
```typescript
toolResults.push({ toolCallId: call.id, name: 'publish', output, success: validation.allPassed });
```

**Line 500** (stuck solve):
```typescript
toolResults.push({ toolCallId: call.id, name: call.name, output: result.output, success: result.success });
```

**Line 627** (normal tool):
```typescript
toolResults.push({ toolCallId: call.id, name: call.name, output: displayOutput, success: result.success });
```

- [ ] **Step 3: Build check**

Run: `pnpm -r build`
Expected: Success (no type errors)

- [ ] **Step 4: Lint check**

Run: `pnpm lint`
Expected: 0 errors, 0 warnings

---

## Chunk 5: Final verification

- [ ] **Step 1: Full build**

Run: `pnpm -r build`
Expected: 0 errors

- [ ] **Step 2: Full lint**

Run: `pnpm lint`
Expected: 0 errors, 0 warnings
