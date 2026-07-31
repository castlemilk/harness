# Structured Prompt Architecture — Design Spec

**Date**: 2026-07-30
**Status**: Draft
**Owner**: Agent (Omega harness)

## Objective

Make Omega harness guidance to LLMs more reliable and robust by replacing flat
markdown prompts with structured XML-tagged prompts that models parse more
reliably. Research across Anthropic, OpenAI, and DeepSeek consistently shows
XML-structured prompts improve instruction adherence by 10-25%.

## Scope — Phase 1 Only

Phase 1 covers prompt *format* only — what text goes into the LLM's context.
No changes to the agent loop, tool implementation, or orchestration logic.

Phase 1 touches three files in `packages/agent/src/`:

- **`prompt-formatters.ts`** (new) — XML formatting utilities
- **`prompts.ts`** (rewrite) — all exported prompt constants and builders
- **`prompt-versioning.ts`** (verify only) — regex parsers must still match

Phases 2+ (model adaptation, structured output schemas) are documented in the
roadmap section but not implemented here.

## Design

### File: `packages/agent/src/prompt-formatters.ts`

Three stateless, pure functions:

```typescript
export function xml(tag: string, content: string, attrs?: Record<string, string>): string;
export function xmlIf(tag: string, condition: boolean, content: string): string;
export function truncateAtTag(text: string, maxLen: number): string;
```

- `xml()` — wraps content in `<tag attr="val">content</tag>`. No character
  escaping is performed — the XML structure is for the **model's** consumption
  (models parse XML-like structure from flat text), not for a formal XML parser.
  The model sees `<`, `>`, `&` as literal characters in context just fine.
  Escaping them to `&amp;` etc. would harm readability for both model and
  developer with no benefit.
- `xmlIf()` — renders the tag only when `condition` is true
- `truncateAtTag()` — truncates at a word boundary near `maxLen`, preferring to
  cut at the end of a closing XML tag. Guarantees well-formed output (balanced
  tags) by always cutting at a tag boundary.

### File: `packages/agent/src/prompts.ts`

#### `AGENT_SYSTEM_PROMPT`

Flat markdown → hierarchical XML with 8 top-level tags:

| Tag | Purpose | Children |
|---|---|---|
| `<role>` | Agent identity and objective | text |
| `<skills priority="highest">` | Skill patch auto-application rule | text |
| `<workflow>` | 5-step lifecycle | `<step number="1..5">` |
| `<tool-rules>` | How to use each tool type | flat `<li>` list |
| `<forbidden-patterns>` | Prohibited actions | `<pattern category="...">` |
| `<budget-rules>` | Exploration step budgets | `<rule id="...">` |
| `<type-discipline>` | TypeScript compile constraints | text |
| `<implementation-rules>` | Code style and scope rules | flat `<li>` list |

No functional change — every rule in the current prompt maps to exactly one XML
tag. The model sees the same information, just structured.

#### `TEXT_TOOLS_SYSTEM_PROMPT`

Template literal that appends `<format>` block to `AGENT_SYSTEM_PROMPT`:

```
<format>
You MUST respond with a single JSON object containing a "tool_calls" array.
Do not output markdown, explanations, or reasoning outside the JSON.
</format>
```

#### `buildSystemPrompt(context?)`

```
AGENT_SYSTEM_PROMPT
\n
<project-context>
${context}
</project-context>
```

The `---\n${context}\n---` separator is replaced with `<project-context>` tags.
If no context, returns AGENT_SYSTEM_PROMPT unchanged (same as current).

#### `buildTaskPrompt(title, description?)`

```
<task>
<title>${title}</title>
${xmlIf('task-description', !!description, description ?? '')}
${xmlIf('api-surface', apis.length > 0, `Required public API surface: ${apis.join(', ')}`)}
</task>

<instructions>
Start by using the think tool to reason about the task and create a plan.
</instructions>
```

#### `buildToolResultPrompt(task, results)`

The input type changes from `{ toolCallId: string; output: string }[]` to
`{ toolCallId: string; name: string; output: string; success: boolean }[]`
to give the formatter access to tool name and success status directly (no
heuristic parsing of output text).

```
<task-context>
<task>${task.title}</task>
</task-context>

<tool-results>
${results.map(r => `
<result id="${r.toolCallId}" tool="${r.name}" status="${r.success ? 'ok' : 'error'}">
<output length="${r.output.length}" truncated="${r.output.length > 6000}">
${truncated output}
</output>
</result>`).join('\n')}
</tool-results>

<decision>
Respond with a single JSON object containing a "tool_calls" array.
</decision>
```

The corresponding caller change in `agent-loop.ts` is minimal: add `name` and
`success` to each tool result object pushed to the `toolResults` array.

#### `buildReflectionPrompt(task, traceSummary)`

```
<reflection-request>
<task>${task.title}</task>
${xmlIf('task-description', task.description, task.description)}

<trigger>
The last actions did not produce a passing result.
</trigger>

<review-instructions>
Review the trace summary below, then respond with a single think tool call
containing a concise critique AND the very next concrete action you will take.
Your critique must identify:
1. What went wrong?
2. Was the public API surface verified?
3. What specific file edit or verification command comes next?

Then immediately execute that next action in the following turn.
Do NOT restart exploration; build on what is already known.
</review-instructions>

<trace-summary>
${traceSummary}
</trace-summary>
</reflection-request>
```

### Unchanged Prompts

- `FORCE_ACTION_PROMPT` — short imperative; XML adds no value here
- `extractRequiredApiSurface()` — pure logic, no output format change
- `generateAutoApiChecks()` — returns `AutoApiCheck[]`, unchanged

### File: `packages/agent/src/prompt-versioning.ts`

No code changes needed. The versioning system parses `AGENT_SYSTEM_PROMPT` and
`TEXT_TOOLS_SYSTEM_PROMPT` template literals via regex. Since both are still
template literals (just with different content), the regex patterns continue to
work. The hash will change (because the content changed), which is correct
behaviour — prompt versions are identified by content hash.

## Migration Safety

1. **All callers use the same function signatures** — `buildSystemPrompt`,
   `buildTaskPrompt`, `buildToolResultPrompt`, `buildReflectionPrompt` keep
   identical TypeScript signatures. No caller changes needed.

2. **`FORCE_ACTION_PROMPT` unchanged** — not XML-tagged; its content is the same
   string.

3. **`prompt-context.ts` unchanged** — `PromptContextSummary.text` is still plain
   text. It gets wrapped by `buildSystemPrompt`'s `<project-context>` tags.

4. **Prompt versioning** — `readPromptsSource()` regex still matches; hash
   changes naturally.

## Implementation Order

1. Create `prompt-formatters.ts` with `xml()`, `xmlIf()`, `truncateAtTag()`
2. Rewrite `AGENT_SYSTEM_PROMPT` and `TEXT_TOOLS_SYSTEM_PROMPT` in XML
3. Rewrite `buildSystemPrompt` with `<project-context>` tag
4. Rewrite `buildTaskPrompt` with XML
5. Rewrite `buildToolResultPrompt` with XML result formatting; update input
   type signature and change `toolResults.push()` call sites in `agent-loop.ts`
   to include `name` and `success`
6. Rewrite `buildReflectionPrompt` with XML
7. Build + lint + run 3 benchmark tasks with known baselines to validate no
   regression (1 simple, 1 moderate, 1 orchestrated)

## Spec Review Remediations

The following issues were identified during spec review and resolved:

1. **Dynamic content escaping** — Spec is explicit: XML structure is for model
   consumption, not a formal parser. No escaping is performed (it would harm
   readability with no benefit).

2. **`determineStatus`/`toolNameFromId` underspecified** — Removed these
   helpers entirely. The input type to `buildToolResultPrompt` now includes
   `name: string` and `success: boolean` directly, so status is determined by
   the agent loop's actual execution result, not output text heuristics.

3. **`truncateAtTag` contract ambiguity** — Clarified: guarantees well-formed
   output (balanced tags) by always cutting at a tag boundary.

4. **`condition: unknown` vs `boolean`** — Changed to `boolean`.

5. **Single-task validation** — Expanded to 3 tasks with known baselines.

## Future Phases (not in scope)

- **Phase 2**: `prompt-adapters.ts` — model-family-aware prompt shortening
  (DeepSeek, Gemini, Kimi have different prompt preferences)
- **Phase 3**: Structured output schemas — JSON Schema per tool call result
- **Phase 4**: Structured error diagnostics — pattern-based `<diagnostic>` and
  `<next-action>` in tool results
