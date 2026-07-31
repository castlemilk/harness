---
name: auto-build-a-task-queue-with-retry-support
description: Auto-generated skill for: Build a task queue with retry support
---

# Auto-generated skill: Build a task queue with retry support

Create src/task-queue.ts with a generic TaskQueue class that supports: enqueue with priority, max concurrency, retry with exponential backoff, and a drain() method. Write comprehensive tests in test-queue.ts. Export all public APIs from index.ts.

## Correctness strategy

A verified patch from a successful run is available at:

```
/Users/benebsworth/projects/omega/harness/apps/server/skills/omega/auto-build-a-task-queue-with-retry-support/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/apps/server/skills/omega/auto-build-a-task-queue-with-retry-support/solution.patch
```

After applying, run the project's build/test command and confirm it passes, then call `finish` with success=true.
