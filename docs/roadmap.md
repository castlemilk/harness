# Omega Harness Roadmap / TODO

This is the working TODO list for improving the harness across CLI, UI, agent
orchestration, measurability, memory/learning, platform, and research. It draws
inspiration from [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
(self-improving skills, persistent memory, messaging gateway, cron, subagent
delegation, TUI) and [earendil-works/pi](https://github.com/earendil-works/pi)
(unified LLM API, agent runtime, TUI, permissions/containerization,
supply-chain hardening, public session data). See `docs/references.md` for the
full reference corpus and architectural guidance behind this list.

Priorities: **P0** = do next, **P1** = high value, **P2** = later/background.

---

## 1. CLI

- [x] P0 Orchestration knobs: `omega task create --orchestrate --max-subtasks N --max-iterations N --concurrency N --token-budget N` and `omega orchestrate <taskId>` shortcut.
- [x] P0 UI orchestration view: task detail shows sub-agents (model/status/diff) and the orchestrator trace.
- [x] P0 Watch mode: `omega task run <id> --watch` streams the SSE trace (spans, subtask status, diffs) to the terminal.
- [x] P0 Deep eval suite: 10 deeper tasks (debugging, refactor, API design, async, multi-file) for quicker capability evals.
- [x] P0 Model eval: `omega bench eval --suite deep --models "kimi/moonshot-v1-128k,kimi/moonshot-v1-32k,kimi/moonshot-v1-8k"` runs a suite across models and writes a comparison report.
- [x] P0 Bench baselines: `omega bench run --suite fast|hard --baseline`, `omega bench compare --baseline <file>`, `omega bench trend` for pass-rate over time.
- [ ] P1 Smoke subset: `--suite smoke` (3 fast tasks) for <2-minute loops.
- [ ] P1 Config profiles: `--profile cheap|balanced|premium` mapping to model tiers, concurrency, and token budgets.
- [ ] P1 Task templates: `omega task create --template bugfix|feature|refactor|orchestrate` with prefilled description/checklist.
- [ ] P1 Better output: `--json`/`--yaml` output, distinct exit codes for infra vs. task failure, `--quiet` progress for CI.
- [ ] P2 Slash-command TUI (hermes-style): interactive console with `/model`, `/skills`, `/retry`, `/compress`, `/usage`, interrupt-and-redirect, streaming tool output.
- [ ] P2 `omega doctor` diagnostics for provider keys, tools, DB, and environment.

## 2. Web UI

 - [x] P0 Orchestration view: planner → subtasks → reviews tree/timeline with per-subtask model, status, tokens, and diff; click into each sub-agent’s trace.
- [ ] P0 Cost & model dashboard: tokens/duration/cost per model, task type, and suite; budget alerts.
- [ ] P0 Benchmark explorer: baseline comparison, regression/improvement highlights, pass-rate trend, failure-taxonomy filters.
- [ ] P1 Live trace waterfall: real-time span tree for `orchestrator.*` and `agent.tool.*`, with replay for finished runs.
- [ ] P1 Provider health: latency/error rate per provider, capability coverage, one-click “route around this provider”.
- [ ] P1 Task templates & bulk ops: create from template, retry failed, cancel running, bulk re-run a suite.
- [ ] P2 Model/prompt version comparison: A/B results, prompt-version leaderboard, and per-version cost.
- [ ] P2 Notifications: web/desktop alerts on task completion, failure, or budget exceeded.

## 3. Agent orchestration

- [x] P0 Orchestrator core: plan with high-tier model, delegate to smaller sub-agents, review/feedback loop, integrate diff. (See `docs/orchestration.md`.)
- [x] P0 Non-isolated execution mode for sub-agents.
- [x] P0 Model-tier routing (`pickModelForTier`).
- [x] P0 External agent harnesses: control Codex/Claude Code/Gemini CLI/OpenCode/Cursor CLI/Aider via `external:<cli>` task tags. (See `docs/external-agents.md`.)
- [x] P0 Review-with-verification: run the project build/test command before the reviewer marks `done`.
- [x] P0 Model escalation: retry a failed subtask on a higher tier after N failures.
- [ ] P1 Parallel sub-agents with isolation + merge: independent subtasks in separate worktrees, auto-merge patches, escalate conflicts to high-tier.
- [ ] P1 Planner artifacts: persist the planner’s JSON plan and each review decision for audit/replay.
- [x] P1 Skill auto-generation: save successful unsolved tasks as reusable skills (prompt + patch) so future runs are cheaper.
- [x] P1 Persistent memory recall: planner recalls relevant past skills/patterns when decomposing a task.
- [ ] P1 Stuck-solver tuning: use the solver only when it produces a compiling patch, else discard and escalate.
- [ ] P2 Ensemble voting: run 2–3 models on critical subtasks and pick the best diff via a high-tier judge.
- [ ] P2 RPC/script collapse (hermes-style): let sub-agents emit small scripts that call tools via RPC, collapsing multi-step pipelines into zero-context-cost turns.

## 4. Measurability / improvement loop

- [x] P0 Core metrics: pass rate, tokens per solved task, cost per solved task, duration, failure taxonomy per model/task type/suite.
- [x] P0 Baselines & regressions: pin a known-good benchmark report; alert on dropped tasks or cost/latency regression.
- [x] P0 Cost dashboard: `/lab/cost-dashboard/` with per-model cost, tokens, duration, budget alerts. Cost estimated from tokens using static pricing table.
- [x] P0 Consensus runner: `omega bench consensus --suite harder --models "..."` — best-of-N patch selection across models.
- [x] P0 Strategy eval: `omega bench strategy --suite hard-targeting --strategies "default,verify-before-finish,research-first"` — multi-strategy evaluation to measure which prompt strategies help which task types.
- [x] P0 Hard-targeting suite: 10 adversarial tasks with hidden spec tests that catch naive fixes (event listener leaks, refactor breaking consumers, async races, config drift, spec ambiguity, adversarial fixes).
- [x] P0 Internal model providers: MiniMax-M3, DeepSeek V4 Pro, Qwen 3.8 Max, GLM-5.2 configured as generic providers.
- [x] P0 Kimi K3 provider: configured as `kind: kimi` on `api.kimi.com/coding/v1`, supports tools, reasoning model. All 10/10 on hard-targeting suite.
- [x] P0 Strategy eval bug fixes: four bugs fixed (applyLatestPatch index stripping, taskType missing, metrics on wrong output, taskType dedup) — previously masked 0% performance on two tasks.
- [x] P0 Hard-targeting 100% baseline: DeepSeek V4 Pro, Qwen 3.8 Max, Kimi K3 all score 10/10 (100%) on hard-targeting suite.
- [x] P0 Consensus across 3 models: DeepSeek + Qwen + Kimi = 10/10 (100%) on hard-targeting (individually also 100%).
- [x] P1 Adversarial test generation: `omega bench adversarial --suite hard-targeting --task-id <id> --count 3` generates hidden tests by asking a model "what wrong fix passes visible tests?"
- [ ] P0 Benchmark CI: scheduled `omega bench run --suite fast|hard` with a posted report and failure on regression.
- [ ] P1 A/B testing: run the same suite against prompt/model/orchestration variants and auto-compare; surface in UI.
- [ ] P1 Trace-driven optimization: use trace/error taxonomy to auto-open optimisation tasks for top failure classes.
- [ ] P1 SLOs: e.g. "fast suite < 2 min, hard suite 100%, p95 task < 5 min, cost < $X per solved task"; show current vs. target.
- [ ] P1 Variance tracking: run each task N times, measure output variance across runs to detect fragile strategies.
- [ ] P2 Public session data (pi-style): opt-in publishing of anonymized OSS task trajectories to improve the agent.

## 5. Memory & learning (hermes-inspired)

- [ ] P1 Persistent agent memory: searchable store of past tasks, diffs, failures, and fixes, used to bias planning and avoid repeats.
- [ ] P1 Skill self-improvement: skills update from verifier outcomes and usage; periodic “nudge” to persist new knowledge.
- [ ] P1 Cross-session recall: FTS5/vector search over past conversations and diffs, with LLM summarization.
- [ ] P2 User/project modeling: profile of project conventions, preferred models, and common failure patterns across sessions.
- [ ] P2 Skills Hub integration: publish/consume skills via an open standard (agentskills.io-style).

## 6. Platform, security & packaging

- [ ] P1 Command approval policy: allowlist/denylist for `run_command`, with per-project overrides and audit log.
- [ ] P1 Containerization/sandboxing (pi-style): optional Docker/micro-VM isolation for agent runs; document patterns.
- [ ] P1 Supply-chain hardening: pin direct deps, shrinkwrap for the published CLI, `npm audit`/signatures in CI, `--ignore-scripts` for installs.
- [ ] P2 Messaging gateway: Telegram/Discord/Slack/WhatsApp/Signal/Email control plane for task creation, status, and approvals.
- [ ] P2 Cron scheduler: natural-language scheduled tasks with delivery to any platform.
- [ ] P2 MCP integration: expose/consume MCP servers for extra tools.

## 7. Research & training

- [ ] P2 Trajectory generation: batch generation of task trajectories for analysis and training.
- [ ] P2 Trajectory compression: compress successful runs into reusable prompt/skill material.
- [ ] P2 Benchmark corpus expansion: keep DeepSWE 30-task + hard suite green; add more unsolved tasks as skills are generated.

---

## Near-term execution plan (next 2–3 iterations)

1. **CLI orchestration knobs + watch mode** — make the orchestrator usable day-to-day.
2. **UI orchestration view + cost dashboard** — observability for multi-agent runs.
3. **Review-with-verification + model escalation** — improve orchestration quality.
4. **Baselines/regressions + benchmark CI** — guard improvements and make them measurable.
5. **Skill auto-generation + persistent memory** — start the self-improvement loop.

---

## Done / verified

- Multi-agent orchestration core (`docs/orchestration.md`).
- Hard-suite skills + environment fixes (corepack, Deno, PnP, pnpm, Python editable installs).
- Live SSE task streams, error taxonomy, diff viewer, benchmark baseline/compare API.
- Fast benchmark suite (10/10) and DeepSWE seed-0 30/30 baseline.
- Strategy eval framework (`bench strategy`): 5 strategies, per-task winner, trace summaries, failure analysis.
- Cost dashboard (`/lab/cost-dashboard/`): per-model cost, tokens, duration, consensus budget.
- Hard-targeting suite: 10 adversarial tasks with hidden spec tests; all 3 internal models 10/10.
- Consensus runner: best-of-N patch selection; DeepSeek+Qwen+Kimi = 10/10.
- Kimi K3 provider: `kind: kimi`, `api.kimi.com/coding/v1`, tools supported, reasoning model.
- Strategy eval bug fixes: applyLatestPatch index stripping, taskType missing, metrics on wrong output, taskType dedup.
- Adversarial test generation: `bench adversarial` generates hidden tests from model self-critique.
- **Key finding**: strategy eval bugs masked 0% performance on 2 tasks; after fixes, all models pass 10/10.
