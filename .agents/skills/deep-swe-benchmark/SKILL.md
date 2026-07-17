---
name: deep-swe-benchmark
description: DeepSWE benchmark tasks with f2p (feature-to-patch) and p2p (patch-to-patch) test verification.
---

# DeepSWE Benchmark Skill

Use this skill when the task is a DeepSWE benchmark item or when the description mentions `f2p`, `p2p`, `verifier`, or `DeepSWE`.

## What matters

- **p2p (patch-to-patch)** tests are the existing tests from the repository. They must keep passing.
- **f2p (feature-to-patch)** tests are added by the task and exercise the new behavior. Passing p2p is not enough — the f2p tests must also pass.
- The final verifier runs the project's test suite inside Docker and reports `f2p_passed/f2p_total` and `p2p_passed/p2p_total`.

## Workflow

1. **Read the task description twice.** Identify the exact new behavior, public API, or formatting rule being requested.
2. **Explore the codebase.** Use `code_overview`, then `search` for the relevant modules and existing tests.
3. **Read the new tests first.** Find the test file(s) added by the task. They usually contain `f2p` in their names or are clearly marked in the task description. Read them to understand the expected behavior and edge cases.
4. **Implement the smallest source change** that satisfies both the new tests and the existing tests.
5. **Run the project's test command** after every edit. Do not just run a focused single test — run the command that executes the full relevant suite (e.g. `npm test`, `pnpm test`, `pytest`, `go test ./...`, `cargo test`).
6. **If f2p tests fail, diagnose and fix.** Parse the failure output, read the failing test, edit the source, and re-run. Do not finish while any f2p test is failing.
7. **Run the build/compile command** and confirm it succeeds with zero errors.
8. **Call `validate_patch`** before `finish`.

## Common failure patterns to avoid

- **Only running existing tests.** The patch can pass p2p and still score 0 if f2p fails.
- **Missing edge cases in the description.** DeepSWE tasks often include precise formatting, parsing, or API rules. Read them carefully.
- **Changing test files.** Do not create, modify, or delete test files. The verifier supplies its own tests.
- **Large refactors.** Make the minimal source change; extra changes can break p2p tests.
- **Ignoring the project language's idioms.** Use the build/test commands native to the repo (go test, pytest, cargo test, npm test, etc.).
