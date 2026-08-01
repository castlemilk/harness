# Structured Tool Result Schemas — Design Spec

**Date**: 2026-07-31
**Status**: Draft
**Owner**: Agent (Omega harness)
**Depends on**: Phase 1 (structured prompt architecture, shipped), Phase 2 (model adaptation, shipped)

## Objective

Make tool results machine-precise for the model by giving each tool a declared
output schema and rendering results as typed XML instead of a flat `<output>`
blob. The model currently reads every tool result as a single free-text string;
diagnostics, exit codes, and file ranges are embedded in prose it must parse.
Structured, schema-driven result rendering lets the model act on typed fields
(line numbers, severities, exit codes) directly — the same reliability goal as
Phase 1, applied to the tool-result half of the prompt.

## Scope — Phase 3 Only

Phase 3 adds an *additive structured envelope* on top of tool results. It does
**not** change:

- The provider tool-call `content` messages (stay `output` text)
- The DB, trace, and `taskStep` write paths (stay `output` text)
- Tools whose output is already a one-line confirmation (`edit_file`,
  `edit_lines`, `write_file`, `apply_patch`, `think`, `finish`, `publish`)
- The `ToolResult` shape's existing `success`/`output` fields (unchanged, still
  canonical for all non-model consumers)
- The system prompt, task prompt, or reflection prompt

## Design

### File: `packages/agent/src/tool-types.ts`

`ToolResult` gains one optional field:

```typescript
export interface ToolResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
}
```

`data` is best-effort structured metadata emitted by tools that have it. Every
existing `{ success, output }` return remains valid; tools without schemas never
set `data`.

### File: `packages/agent/src/tool-result-schemas.ts` (new)

Dependency-free, minimal JSON-Schema-shaped registry. No ajv or other runtime
dependency (AGENTS.md rule 5); the shape is small and validated by unit tests.

```typescript
export interface ToolResultSchema {
  properties: Record<string, ToolResultProperty>;
  required: string[];
}

export interface ToolResultProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  items?: ToolResultProperty;         // element shape for arrays
  name?: string;                      // singular element name for array items
  x-attr?: boolean;                   // render as XML attribute (strings only)
  x-large?: boolean;                  // long string: render as element, truncate at 6000
}

export const TOOL_OUTPUT_SCHEMAS: Record<string, ToolResultSchema>;
```

Schemas for the 8 high-value tools:

| Tool | Fields |
|---|---|
| `read_file` | `{ path, startLine, endLine, totalLines, truncated, content }` |
| `run_command` | `{ command, exitCode, stdout, stderr, timedOut }` |
| `lsp_diagnostics` | `{ path, diagnostics: [{ line, character, severity, source, message }] }` |
| `lsp_hover` | `{ path, line, character, content }` |
| `lsp_symbol` | `{ query, symbols: [{ name, kind, path, line }] }` |
| `search` | `{ pattern, matches: [{ path, lineNumber, line }] }` |
| `list_files` | `{ path, recursive, entries: [{ path, type }] }` |
| `code_overview` | `{ path, overview }` |

Design notes:

- `x-attr` marks short string scalars that read better as attributes (`path`,
  `pattern`, `query`, `command`). Plain strings without `x-attr` render as
  child elements. Numbers and booleans always render as attributes.
- `x-large` marks long string payloads (`content`, `stdout`, `stderr`,
  `overview`, `message`) that must be child elements and truncated at the same
  6000-char budget `buildToolResultPrompt` uses today.
- Array items carry `name` for the singular element tag (`diagnostics` →
  `<diagnostic>`, `matches` → `<match>`, `entries` → `<entry>`, `symbols` →
  `<symbol>`). Scalar arrays fall back to `<item>`.
- `severity` is mapped from the LSP numeric `DiagnosticSeverity` to a stable
  string: `1 → error`, `2 → warning`, `3 → information`, `4 → hint`.

### File: `packages/agent/src/prompt-formatters.ts`

Add one pure function:

```typescript
export function xmlFromData(
  data: Record<string, unknown>,
  schema: ToolResultSchema,
  tag: string
): string;
```

Rendering rules (the schema drives every decision — no field-name magic):

1. **number / boolean** property → XML attribute, kebab-cased name
   (`startLine` → `start-line`).
2. **string** property:
   - `x-attr: true` → XML attribute
   - otherwise → child `<field>text</field>` element
   - `x-large: true` → child element, truncated at 6000 chars with `length` and
     `truncated` attributes (same truncation contract as Phase 1's
     `truncateAtTag`)
3. **array** property → repeated child elements:
   - array of objects → `<name>…</name>` per item, item properties rendered by
     the same rules recursively (`<diagnostic line="12" character="3"
     severity="error">Cannot find name 'foo'</diagnostic>`)
   - scalar array → `<item>value</item>` per element
4. **object** property → nested `<field>` element, fields rendered recursively
5. **null / undefined** values → omitted entirely

The result is wrapped in the caller's `<tag>`:

```
<data path="src/index.ts" start-line="1" end-line="120" total-lines="120" truncated="false">
  <content length="4120" truncated="false">…</content>
</data>
```

### File: `packages/agent/src/prompts.ts`

- `ToolResultEntry` gains `data?: Record<string, unknown>`.
- `buildToolResultPrompt(task, results)` renders each `<result>` from
  `data` + `TOOL_OUTPUT_SCHEMAS[r.name]` when both are present; otherwise it
  renders the existing `<output>` text block unchanged:

```
<result id="${toolCallId}" tool="${name}" status="ok|error">
  <data …>…</data>          <!-- when schema + data present -->
  <output …>…</output>      <!-- fallback, unchanged -->
</result>
```

`<task-context>` and `<decision>` wrappers unchanged.

### File: `packages/agent/src/agent-loop.ts`

Each of the 7 `toolResults.push({ toolCallId, name, output, success })` sites
adds `data: result.data` (only where the site has a `result` in scope; the
synthetic stuck-solver/advisory results have no `data` and are omitted).

### Tool emission changes

Each of the 8 tools adds a `data` field to its returns. Concretely:

- **`file-utils.ts` `readFile`** — `data: { path, startLine: offset + 1,
  endLine, totalLines, truncated, content }`. `truncated` reflects whether the
  caller asked for a sub-range (line_offset/line_count), not the 6000-char
  prompt limit.
- **`run-utils.ts` `runCommand`** — `data: { command, exitCode, stdout, stderr,
  timedOut }`. Emitted on **success and failure**; `exitCode` is `0` on success
  (or the process code on failure), `stdout`/`stderr` split instead of merged.
- **`lsp-utils.ts` `lspDiagnostics`** — `data: { path, diagnostics }`, each with
  `line`, `character`, `severity` (mapped string), `source`, `message`.
- **`lsp-utils.ts` `lspHover`** — `data: { path, line, character, content }`.
- **`lsp-utils.ts` `lspSymbol`** — `data: { query, symbols: [{ name, kind, path,
  line }] }` (deduplicated, first 20, same as output).
- **`search-utils.ts` `searchFiles`** — `data: { pattern, matches }`. The rg
  JSON parsing already exists (`rgLine`); extend it to retain structured
  `{ path, lineNumber, line }` matches. Includes the literal-fallback path.
- **`search-utils.ts` `listFiles`** — `data: { path, recursive, entries:
  [{ path, type: 'file' | 'dir' }] }`.
- **`search-utils.ts` `codeOverview`** — `data: { path, overview }` where
  `overview` is the existing text.

## Error Handling

- Tools may emit `data` on failure too (notably `runCommand`:
  `exitCode`/`stderr`). The renderer does not care about `success`; it renders
  whatever `data` is present.
- No `data` (or no schema) → text `<output>` fallback, unchanged behavior.
- `xmlFromData` must never throw on malformed/partial data: unknown fields are
  skipped, `null`/`undefined` omitted, arrays coerced defensively
  (`Array.isArray` check).

## Migration Safety

1. **All non-model consumers unchanged** — provider `content`, DB, traces, and
   `taskStep` records keep `output` text. `data` is model-facing only.
2. **Additive type change** — `ToolResult.data` and `ToolResultEntry.data` are
   optional; no existing constructor or push site breaks.
3. **Text fallback** — tools without schemas render exactly as today.
4. **Phase 1/2 adapters unaffected** — the markdown adapter (`xmlToMarkdown`)
   renders `<data>` blocks as passthrough text via its unknown-tag fallback; no
   changes needed.

## Testing

- `xmlFromData` unit tests: scalar attributes, nested objects, arrays of
  objects, scalar arrays, `x-large` truncation with `length`/`truncated` attrs,
  null/undefined omission, unknown-field skipping, kebab-case names.
- Per-tool unit tests asserting each of the 8 tools' `data` matches its schema
  (direct field/type assertions against `TOOL_OUTPUT_SCHEMAS`; no validator
  dependency).
- `buildToolResultPrompt` unit test: structured rendering when schema + data
  present; identical text fallback when either is missing.
- `pnpm --filter @omega/agent build` + `pnpm lint` (expect 0/0).
- Final validation: one real DeepSWE task per plan (blocked until provider
  credits; see Implementation Order).

## Implementation Order

1. Add `data?` to `ToolResult` (`tool-types.ts`)
2. Create `tool-result-schemas.ts` with the 8 schemas
3. Add `xmlFromData` to `prompt-formatters.ts`
4. Emit `data` in the 8 tools (`file-utils.ts`, `run-utils.ts`, `lsp-utils.ts`,
   `search-utils.ts`)
5. Wire `ToolResultEntry.data` + structured rendering in `prompts.ts`
   (`buildToolResultPrompt`); pass `data` at the agent-loop push sites
6. Unit tests
7. `pnpm -r build` + `pnpm lint`
8. Validation: one DeepSWE task against a known baseline when a provider is
   available (DeepSeek credits or another provider)

## Future Phases (not in scope)

- **Phase 4**: Structured error diagnostics — pattern-based `<diagnostic>` and
  `<next-action>` in tool results, built on the structured `data` this phase
  introduces.
