# omega-bench

Run Omega harness benchmarks, process reports, and drive self-improvement loops.

## When to use

Use this skill when the user asks to:
- Run the Omega e2e test suite or harness
- Run a benchmark (synthetic, DeepSWE, or custom)
- Process a benchmark report, traces, or metrics
- Create a self-improve task from a failed benchmark
- Iterate on prompts using benchmark results

## Workflow

1. Ensure the harness server is running on the configured port (default 4000).
   - If not, start it with no timeout so long benchmarks don't kill it:
     `PORT=4000 GRPC_PORT=50051 DATABASE_URL=postgresql://localhost:5432/omega DATABASE_DIR=./pglite-data node apps/server/dist/index.js`
   - When launching as a background task, pass `disable_timeout=true`.
2. Run the requested benchmark with a timeout long enough for the agent to finish and commit:
   - Synthetic 30-task suite: `npx @castlemilk/omega bench run --suite synthetic`
   - DeepSWE single task (Kea): `pnpm bench:deepswe`
   - DeepSWE 30-task suite: `pnpm bench:deepswe:30`
   - DeepSWE subset: `npx @castlemilk/omega bench run --suite deep-swe --path ./deep-swe/tasks --n-tasks 10 --timeout 1800000 --provider kimi --model kimi-for-coding --docker`
   - Self-improve loop: `npx @castlemilk/omega bench loop --suite synthetic --iterations 3`
3. Wait for completion and collect the report from `.omega/reports/`.
4. Inspect failures by reading the report JSON and, if needed, the trace flow via the web UI or API `/tasks/:id/trace-flow`.
5. For each failure, identify whether it is a prompt issue, an executor bug, or a benchmark task issue.
6. Create a targeted fix, run `pnpm lint` and `pnpm test`, then rebuild and publish the bundle.
7. Re-run the failing task or full suite to verify the fix.
8. Summarize the pass rate, duration, and any changes made.

## Commands reference

- `pnpm test` — unit and e2e tests
- `pnpm lint` — ESLint 9
- `pnpm --filter @omega/agent build && pnpm --filter @omega/cli build` — rebuild changed packages
- `cd packages/bundle && pnpm build && npm publish --access public` — publish update
- `npx @castlemilk/omega --version` — verify published installable version
- `npx @castlemilk/omega bench run --suite synthetic` — full synthetic benchmark
- `npx @castlemilk/omega bench loop --suite synthetic --iterations 3` — self-improve loop
- `npx @castlemilk/omega bench optimise` — create self-improve task from latest report

## Report analysis

A benchmark report is JSON with:
- `total`, `passed`, `failed`, `timeouts`
- `totalDurationMs`
- `results`: array of `{ task, harnessTaskId, durationMs, status, evaluation, agentRun, spanCount }`

For each failed result:
- Read `agentRun.validationSummary` to see which validation step failed.
- Read `agentRun.resultStatus` and task traces to see the agent reasoning.
- For DeepSWE tasks, read `evaluation.metrics` for `f2p_passed`, `p2p_passed`, `partial`, and `verifier_logs`.
- Look for common failure classes: wrong file path, wrong export name, missing edge-case guard, premature finish, validation not retried.

## Publishing updates

Before publishing:
1. Bump `packages/bundle/package.json` version.
2. Ensure `~/.npmrc` has the npm auth token for `@castlemilk`.
3. Run `pnpm lint` and `pnpm test`.
4. Publish from `packages/bundle`.
5. Verify with `npx @castlemilk/omega --version`.
