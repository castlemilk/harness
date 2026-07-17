---
name: meriyah-explicit-resource-management
description: Guidance for adding explicit resource management (`using` / `await using`) declarations to the meriyah JavaScript parser.
tags: [meriyah, parser, javascript, typescript]
---

# Adding `using` / `await using` to meriyah

Use this when the task is to implement explicit resource management declarations in meriyah (the JS parser).

## Required files and changes

1. **Token enum** — `src/token.ts`
   - Add `UsingKeyword` (and optionally `AwaitUsingKeyword`) to the `Token` enum with appropriate flags (`IsExpressionStart`, `FutureReserved`, `IsIdentifier`).
   - Add `using: Token.UsingKeyword` to `descKeywordTable` (around line 247). This is the critical step; without it the lexer never emits the keyword and every downstream parser change is dead code.

2. **AST types** — `src/estree.ts`
   - Ensure `VariableDeclaration` `kind` allows `'using' | 'await using'`.

3. **Error codes** — `src/errors.ts`
   - Add error messages containing exactly these substrings:
     - "not allowed in the global scope"
     - "only allowed inside async"
     - "must have an initializer"
     - "not allowed for-in" (or "not allowed in for-in")
     - "cannot have destructuring"

4. **Parser** — `src/parser.ts`
   - In `parseStatementListItem` and similar dispatch, add cases for `Token.UsingKeyword` and `Token.AwaitKeyword` + `using`.
   - Reuse `parseLexicalDeclaration` with new `BindingKind.Using` / `BindingKind.AwaitUsing` values.
   - Add `BindingKind.Using` and `BindingKind.AwaitUsing` to `src/common.ts`.
   - Enforce scope/context rules from the task instruction (script global, async/module context, for-in, destructuring, initializer).

5. **For-of heads** — search for `parseForStatement` / `parseForInStatement` / `parseForOfStatement` and allow `using` / `await using` in for-of/for-await-of heads.

## Verification order

1. After editing, run `npx tsc --noEmit` to confirm the project compiles.
2. Run the focused new-feature test file if it exists in the repo: `npx vitest run test/parser/declarations/using.ts`.
3. If that file does not exist in the repo, run the project's test command (`npm test` or `pnpm test`) and confirm no regressions.
4. Only as a final step run the full test suite once.

## Common pitfalls

- Forgetting the `descKeywordTable` entry is the #1 reason this task fails with `Unexpected token: 'using'`.
- `await using` at script top-level must report the async-context error, not the script-global error.
- Do not modify test files; the verifier supplies its own.
