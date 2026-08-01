# Agent Harness Reference Corpus

A curated set of agent harnesses, orchestration frameworks, eval harnesses, and
supporting infrastructure, distilled into architectural guidance we can
incorporate into Omega. Sources were reviewed from public docs/repos (linked).
Where a project was not reviewed in depth, it is marked as **notable**.

---

## 1. Orchestration frameworks

| Project | What it is | Useful patterns for Omega |
|---|---|---|
| [LangGraph](https://github.com/langchain-ai/langgraph) | Low-level orchestration for stateful, long-running agents (graph/state-machine). | Durable execution, checkpointing, human-in-the-loop state inspection, short/long-term memory, LangSmith tracing. |
| [Microsoft AutoGen](https://github.com/microsoft/autogen) (maintenance) / Agent Framework | Multi-agent apps with layered Core/AgentChat/Extensions APIs. | Agents-as-tools/handoffs, group chat patterns, distributed runtime, A2A/MCP interop. |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Multi-agent automation via **Crews** (role-based autonomy) + **Flows** (event-driven control). | Split autonomous collaboration from deterministic workflow control; structured state, branching/routers, human input, checkpointing. |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | Lightweight multi-agent framework (provider-agnostic). | Handoffs, guardrails, sessions, built-in tracing, sandbox agents, human-in-the-loop. |
| MetaGPT **(notable)** | Assigns software-company roles (PM, architect, engineer) to agents. | Role specialization, SOP/artifact-driven collaboration. |
| Semantic Kernel **(notable)** | Microsoft’s enterprise agent SDK. | Planners, plugins, enterprise connectors. |
| DSPy **(notable)** | Programmatic prompt/optimizer framework. | Systematic prompt optimization, teleprompters, eval-driven tuning. |

**Guidance:** keep our orchestrator simple (plan → delegate → review), but borrow
LangGraph’s durable state/checkpointing, CrewAI’s Crew/Flow split, and the OpenAI
SDK’s handoff/guardrail/session primitives as first-class concepts.

---

## 2. Coding agent runtimes / CLIs

| Project | What it is | Useful patterns for Omega |
|---|---|---|
| [NousResearch Hermes Agent](https://github.com/nousresearch/hermes-agent) | Self-improving agent with learning loop, skills, memory, messaging gateway, cron, TUI. | Skill creation from experience, skill self-improvement, persistent memory + FTS5 recall, nudges, subagent delegation, multi-platform gateway, cron automations. |
| [earendil-works/pi](https://github.com/earendil-works/pi) | Unified LLM API + agent runtime + coding agent CLI + TUI. | Clean package split (ai/agent-core/coding-agent/tui), permissions & containerization (Gondolin/Docker/OpenShell), supply-chain hardening, public OSS session data. |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | Self-hosted developer control center for coding agents and automations. | Agent Server per host + Agent Canvas frontend, multiple backends, automations triggered by schedule/webhooks, ACP agent compatibility. |
| [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) | Minimal (~100-line) bash-only SWE agent. | Linear history, `subprocess.run` actions, sandbox-friendly, model-centric baseline; great as a simple, debuggable agent loop. |
| Aider **(notable)** | CLI pair-programmer. | Repo-map context, edit formats, commit discipline. |
| Cline / Roo Code **(notable)** | VS Code coding agents. | Tool UX, human-in-the-loop approvals, checkpointing. |
| OpenClaw **(notable)** | Agent gateway (Hermes predecessor). | Messaging gateway, migration path, command allowlists. |
| SWE-agent **(notable)** | Research SWE agent. | Agent-computer interfaces, tool design, trajectory analysis. |
| Claude Code / Codex / Gemini CLI / OpenCode **(notable)** | Vendor coding agents. | Tooling UX, plan modes, terminal workflows; useful as agent backends. |

**Guidance:** Hermes shows the value of a self-improving skill/memory loop; Pi
shows clean runtime separation and sandboxing; mini-swe-agent shows a minimal,
model-centric loop is a strong baseline; OpenHands shows a control-center +
agent-server topology we can mirror for the web UI.

---

## 3. Eval harnesses / benchmarks

| Project | What it is | Useful patterns for Omega |
|---|---|---|
| [Pier](https://github.com/datacurve-ai/pier) | Harbor-compatible eval framework for sandboxed coding-agent evals. | Task format, per-agent network allowlists, install specs for air-gapped tasks, augmented ATIF trajectories, `critique run`, trajectory viewer. |
| [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) | UK AISI eval framework with 200+ built-in evals. | Eval composition (prompt/tool/multi-turn/model-graded), extensions, docs as `llms.txt`, reproducible dev envs. |
| DeepSWE (datacurve) | Coding-agent benchmark (Harbor-compatible tasks). | Task.toml + instruction + tests/config/grader, f2p/p2p whitelists, CTRF/JUnit grading, baseline sampling. |
| SWE-bench / Terminal-Bench **(notable)** | Benchmark suites + harnesses. | Verified task sets, reference solutions, Dockerized verifiers. |
| OpenAI Evals **(notable)** | Eval framework + registry. | Eval registry, model-graded evals, custom eval authoring. |
| HELM / lm-eval-harness **(notable)** | Broad model eval suites. | Standardized metrics, reproducible runs, leaderboards. |

**Guidance:** Pier’s per-agent network allowlists and install specs are directly
relevant to our DeepSWE adapter and sandboxing; ATIF-style trajectories and
`critique run` map to our trace/review flows; Inspect’s eval composition and
`llms.txt` docs are good models for our benchmark/report surface.

---

## 4. Observability / evals / tracing

| Project | What it is | Useful patterns for Omega |
|---|---|---|
| LangSmith **(notable)** | LangChain observability + evals. | Trace visualization, dataset evals, prompt/version comparison. |
| LangFuse **(notable)** | Open-source LLM observability. | Traces, spans, scores, datasets, prompt management. |
| OpenTelemetry **(notable)** | Standard telemetry. | Vendor-neutral traces/metrics/logs; our spans should stay OTLP-compatible. |
| Phoenix (Arize) **(notable)** | AI observability. | Trace analysis, evals, drift detection. |
| Braintrust / Helicone / Weave / PromptLayer **(notable)** | LLM observability platforms. | Cost tracking, prompt/version analytics, eval dashboards. |

**Guidance:** keep our `TraceSpan` model and trace-flow/analysis UI, but align
field names and export paths with OTel/ATIF so external viewers and critique
tools can consume them.

---

## 5. Memory, skills, and user modeling

| Project | What it is | Useful patterns for Omega |
|---|---|---|
| Hermes Agent memory/skills | Agent-curated memory, skills that self-improve, FTS5 session search, Honcho user modeling. | Skill creation from experience, skill self-improvement, persistent memory, cross-session recall, nudges, user profiles. |
| Letta (MemGPT) **(notable)** | Agent memory management. | Tiered memory, archival recall, memory editing tools. |
| Zep **(notable)** | Long-term memory for agents. | Fact extraction, temporal knowledge graphs, session memory. |
| agentskills.io / Skills Hub **(notable)** | Open skill standards and distribution. | Shareable skill format, discovery, versioning. |
| MCP **(notable)** | Model Context Protocol. | Tool/resource interoperability; expose Omega tools as MCP servers. |

**Guidance:** implement the hermes-style loop: create skills from successful
runs, let them self-improve from verifier outcomes, persist memory across
sessions, and make skills shareable via a standard manifest.

---

## 6. Sandboxing, execution, and infra

| Project | What it is | Useful patterns for Omega |
|---|---|---|
| Pier/Harbor envs (docker, modal) | Sandboxed eval environments with network allowlists. | Per-agent install specs, network allowlists, reproducible sandboxes. |
| Pi containerization (Gondolin, Docker, OpenShell) | Patterns for isolating agent execution. | Micro-VM/Docker/policy sandbox options; document safe defaults. |
| Daytona / Modal **(notable)** | Serverless dev environments. | Hibernating agent environments, cost-efficient persistence. |
| E2B / Firecracker **(notable)** | Sandboxed code execution. | Fast micro-VM sandboxes for tool execution. |
| Temporal / Inngest / Windmill **(notable)** | Durable workflow engines. | Durable execution, retries, scheduling, human-in-the-loop steps. |
| n8n / Dify / Flowise / LangFlow **(notable)** | Workflow/automation platforms. | Visual flows, integrations, automation triggers. |

**Guidance:** adopt Pier-style network allowlists and install specs for agent
sandboxes; consider a durable workflow engine if orchestration needs
long-running, resumable executions; document container isolation patterns like
Pi’s.

---

## 7. Architectural patterns to incorporate

1. **Orchestrator–worker with verification** (current)
   - Keep plan → delegate → review. Add **review-with-verification** (run
     build/test before `done`) and **model escalation** on repeated failure.
2. **Crew/Flow split** (CrewAI)
   - Let sub-agents be autonomous within a subtask, but keep orchestration
     deterministic and stateful (our feedback loop), with structured state and
     explicit branching.
3. **Agents-as-tools / handoffs** (AutoGen, OpenAI SDK)
   - Treat sub-agents as tools with guardrails and clear handoff contracts;
     keep sessions so context carries across runs.
4. **Skills + memory loop** (Hermes)
   - Auto-create skills from successful tasks, self-improve them from verifier
     outcomes, persist memory, and recall across sessions.
5. **Minimal linear agent loop** (mini-swe-agent)
   - Maintain a simple, debuggable baseline loop where trajectory == messages;
     useful for fine-tuning and for isolating model vs. scaffold issues.
6. **Sandboxed execution with allowlists** (Pier)
   - Per-agent install specs and network allowlists for reproducible, secure
     runs (especially for air-gapped benchmarks).
7. **Durable, checkpointed state** (LangGraph, Temporal)
   - Persist orchestration state so long-running tasks can resume and be
     inspected/modified by humans mid-flight.
8. **Eval-driven improvement** (Inspect, Pier, DeepSWE)
   - Keep benchmarks green with baselines/regressions; use traces/trajectories
     and critique runs to drive prompt/skill optimization.
9. **Human-in-the-loop gates** (OpenAI SDK, Cline)
   - Approval steps for risky commands, review gates before integration, and
     interrupts/redirects in the TUI.
10. **Supply-chain and supply-of-truth** (Pi)
    - Pinned deps, shrinkwrap for the published CLI, audits, `--ignore-scripts`,
      and reproducible dev environments.

---

## 8. Mapped to our roadmap

- **CLI/TUI**: slash-command TUI, watch mode, interrupts (Hermes/Pi); profiles
  and templates (CrewAI/OpenHands).
- **UI**: orchestration tree + cost dashboard (LangSmith/LangFuse-style);
  benchmark explorer with regressions (Inspect/Pier-style).
- **Orchestration**: review-with-verification, model escalation, parallel
  sub-agents with merge, planner artifacts, ensemble voting (AutoGen/OpenAI SDK).
- **Memory/skills**: skill auto-generation, self-improving skills, persistent
  memory, cross-session recall, Skills Hub standard (Hermes/agentskills.io).
- **Sandbox/security**: network allowlists, install specs, command approval,
  containerization, supply-chain hardening (Pier/Pi).
- **Measurability**: OTel/ATIF-aligned traces, baselines/regressions, benchmark
  CI, A/B testing, SLOs, public session data (Inspect/Pier/LangFuse/pi).

See `docs/roadmap.md` for the prioritized TODO list derived from this corpus.
