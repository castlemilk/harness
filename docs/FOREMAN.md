# Foreman

The orchestration layer: an **objective** owns **workstreams**, which own a tree
of **harnesses** (standing agents). Each harness wakes on a heartbeat, runs its
playbook **routine** once, records a **pulse**, and escalates to a human as an
**intervention** when it needs a decision.

## Try it

```bash
task setup          # first run on a fresh checkout
task db:seed:e2e    # load the fixture (21 harnesses, 234 pulses, 2 objectives)
task dev            # API :4000 + web :5173, one database, Ctrl-C stops both
```

`task doctor` if anything looks wrong — it checks databases, migrations, port
occupancy and provider keys.

### Worth clicking

| Where | What it should show |
|---|---|
| **Console** | Tree with a depth-4 chain, an *Unassigned* lane, a paused lane. Roster shows all seven statuses. |
| **Board** | Workstream lanes, 12-pulse sparklines, `+N more` overflow, the *Needs you* rail with all three intervention kinds. |
| **Graph** | Auto-fits the whole fleet. Rings are context used. Drag to pan, `⤢` refits, scrubber replays. |
| **Work / Usage / Playbooks** | Tickets scoped to the objective; spend by model against cap; routine editor with a live resolved preview. |
| **⌘K** | `pause runtime` → acts on the match. `⌘↵` widens to the subtree. |

The second objective ("Keep the support queue at zero") is deliberately empty —
it exists to prove objective-scoping and the empty states.

## Running it for real

The engine makes **real, paid provider calls**, so it is off unless asked:

```bash
task engine:pulse:dry -- <harnessId>   # no provider call, no spend
task engine:pulse     -- <harnessId>   # one real pulse
task dev:engine                        # scheduler on (FOREMAN_ENGINE=1)
```

A pulse builds its prompt from the harness's mission, routine, recent pulses,
children and any operator reply; calls the provider; then records tokens, cost,
status and any escalation.

Safety properties worth knowing, because they are load-bearing:

- **Budget caps are checked before the call**, so a capped harness cannot
  overspend by one pulse. Hitting the cap raises one budget intervention, not
  one per heartbeat.
- **Unpriced models record `null` cost, never `0`** (`packages/core/src/pricing.ts`).
  A model that looks free would silently defeat every cap.
- **Dry-run harnesses are never auto-run** by the scheduler.
- If no provider serves the harness's declared model, a credentialed provider is
  substituted, the substitution is logged, and **the model that actually ran is
  what cost is attributed to**.

## Layout

```
packages/db/prisma/schema.prisma    Objective/Workstream/Harness/Pulse/…
apps/server/src/routes/foreman*.ts  API, mutations, SSE
apps/server/src/lib/pulse-engine.ts runner + scheduler
apps/web/src/foreman/               shells/ surfaces/ ui/ data/
scripts/seed-foreman-e2e.ts         the fixture
```

`GET /foreman/objectives/:id/state` is the hot path — the whole dashboard in one
bounded query. The SSE stream opens with that same snapshot, then patches.

## Known gaps

- **Context gauge reads ~0% on live agents.** Pulses are stateless, so a ~400
  token prompt against a 400k window genuinely is ~0%. The fixture's higher
  numbers are fabricated. The gauge only becomes meaningful if harnesses carry
  conversation across pulses — a design decision, not a bug.
- **A harness does no real work yet.** It reasons about state and reports; it has
  no tools. `HarnessTool.run` records an invocation without executing anything.
- **`mergedToday` uses `Task.updatedAt`**, which any write bumps. There is no
  merge timestamp to key off.
- **Day boundaries are UTC**, so "today's spend" rolls over at 10am AEST.
- Four places can still resolve a database: the repo root (canonical), the two
  legacy per-package dirs, and `omegaStorageRoot()/pglite-data` when
  `DATABASE_DIR` is unset. `task doctor` reports the first three.

## Tests

```bash
task test:foreman   # 46 server + 16 web
task check          # lint, typecheck, build, test
```

The server suite deliberately asserts values, not shapes — an earlier
`expect.any(Number)` suite let a 75% spend under-report pass. If you add
assertions, assert the number.
