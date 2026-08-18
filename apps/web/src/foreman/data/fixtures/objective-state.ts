/**
 * A real `/foreman/objectives/:id/state` response, captured from the server
 * running the `scripts/seed-foreman-e2e.ts` fixture and trimmed to two
 * harnesses, two workstreams and one of everything else.
 *
 * It exists so the boundary check in `../adapt.ts` is tested against what the
 * server actually serialises rather than against a hand-written shape that
 * agrees with the checker by construction. Re-capture with:
 *
 *   curl -s localhost:4000/foreman/objectives/<id>/state
 */
export const OBJECTIVE_STATE_FIXTURE: unknown = {
  "objective": {
    "id": "e2e00000-0000-4000-8000-000000000010",
    "projectId": "e2e00000-0000-4000-8000-000000000001",
    "name": "Ship the Foreman control plane",
    "description": "Objectives, harness trees, pulses and interventions, wired end to end.",
    "status": "active",
    "useCase": null,
    "targetDate": "2026-08-21T03:29:00.233Z",
    "spendCapUsd": 120,
    "spendCap": 120,
    "daysLeft": 5,
    "createdAt": "2026-08-15T03:29:00.326Z",
    "updatedAt": "2026-08-17T23:34:04.922Z",
    "phases": [
      {
        "id": "e2e00000-0000-4000-8000-000000000040",
        "objectiveId": "e2e00000-0000-4000-8000-000000000010",
        "name": "Frame the mission",
        "state": "done",
        "weight": 1.4,
        "detail": "Contract agreed.",
        "orderIdx": 0
      },
      {
        "id": "e2e00000-0000-4000-8000-000000000041",
        "objectiveId": "e2e00000-0000-4000-8000-000000000010",
        "name": "Build the control plane",
        "state": "active",
        "weight": 3.2,
        "detail": "18 of 24 tickets",
        "orderIdx": 1
      }
    ],
    "progress": 0.2857142857142857,
    "ticketsTotal": 7,
    "ticketsDone": 2,
    "spendToday": 14.310000000000002,
    "spendTotal": 30.02122689,
    "stats": {
      "running": 11,
      "runningDelta": null,
      "blocked": 2,
      "blockedNeedingYou": 3,
      "mergedToday": 2,
      "awaitingReview": 2
    }
  },
  "workstreams": [
    {
      "id": "e2e00000-0000-4000-8000-000000000030",
      "objectiveId": "e2e00000-0000-4000-8000-000000000010",
      "name": "Control plane",
      "paused": false,
      "pausedAt": null,
      "pausedNote": null,
      "orderIdx": 0,
      "leadHarnessId": "e2e00000-0000-4000-8000-000000000100",
      "status": "watching",
      "agentCount": 7,
      "spend": 14.120000000000001
    },
    {
      "id": "e2e00000-0000-4000-8000-000000000031",
      "objectiveId": "e2e00000-0000-4000-8000-000000000010",
      "name": "Harness runtime",
      "paused": false,
      "pausedAt": null,
      "pausedNote": null,
      "orderIdx": 1,
      "leadHarnessId": "e2e00000-0000-4000-8000-000000000200",
      "status": "watching",
      "agentCount": 10,
      "spend": 13.160000000000004
    }
  ],
  "harnesses": [
    {
      "id": "e2e00000-0000-4000-8000-000000000100",
      "objectiveId": "e2e00000-0000-4000-8000-000000000010",
      "workstreamId": "e2e00000-0000-4000-8000-000000000030",
      "parentId": null,
      "name": "control-lead",
      "status": "watching",
      "activity": "Reconciling objective state with active workstreams.",
      "mission": "Own the control-plane contract. Break ambiguity into sequenced work and keep no more than 6 children in flight.",
      "currentJob": "Drive the control-plane board to zero.",
      "model": "gpt-5",
      "playbookId": "e2e00000-0000-4000-8000-000000000020",
      "taskId": null,
      "branch": null,
      "heartbeatMinutes": 30,
      "nextPulseAt": "2026-08-17T23:53:04.845Z",
      "maxChildren": 6,
      "spendCapUsd": 24,
      "spendUsd": 4.2,
      "contextTokens": 84000,
      "contextWindow": 400000,
      "permissions": [
        {
          "id": "repo",
          "label": "Read repo, run tests, open PRs",
          "granted": true,
          "needsApproval": false
        },
        {
          "id": "comment",
          "label": "Comment on tickets it owns",
          "granted": true,
          "needsApproval": false
        },
        {
          "id": "merge",
          "label": "Merge without review",
          "granted": false,
          "needsApproval": true
        }
      ],
      "dryRun": false,
      "lastPulseSeq": 18,
      "idleSince": "2026-08-17T23:30:04.845Z",
      "createdAt": "2026-08-15T03:29:00.340Z",
      "updatedAt": "2026-08-17T23:34:04.983Z",
      "retiredAt": null,
      "contextUsed": 0.21,
      "spend": 4.2,
      "spendCap": 24,
      "subtreeSpend": 15.020000000000001,
      "nextPulseInMinutes": 3,
      "idleMinutes": 20,
      "latestPulseSeq": 18,
      "ticketId": null,
      "childCount": 4,
      "recentPulses": [
        {
          "id": "8b37ccf9-ff83-4dff-9924-840793528aea",
          "harnessId": "e2e00000-0000-4000-8000-000000000100",
          "seq": 18,
          "startedAt": "2026-08-17T23:34:04.845Z",
          "endedAt": "2026-08-17T23:38:04.845Z",
          "outcome": "ok",
          "summary": "control-lead: advanced its slice and recorded evidence.",
          "costUsd": 0.2333333333333333,
          "tokens": 9580,
          "weight": 0.684254935989719,
          "durationMs": 240000,
          "cost": 0.2333333333333333
        },
        {
          "id": "927a9783-8453-456f-8908-cddb096749f0",
          "harnessId": "e2e00000-0000-4000-8000-000000000100",
          "seq": 17,
          "startedAt": "2026-08-17T20:34:04.845Z",
          "endedAt": "2026-08-17T20:38:04.845Z",
          "outcome": "ok",
          "summary": "control-lead: advanced its slice and recorded evidence.",
          "costUsd": 0.2333333333333333,
          "tokens": 11224,
          "weight": 0.8017092246602897,
          "durationMs": 240000,
          "cost": 0.2333333333333333
        }
      ],
      "routine": [
        {
          "index": 1,
          "text": "Read the objective, your children, spend, and open interventions.",
          "condition": null,
          "id": "e2e00000-0000-4000-8000-000000000020:1"
        },
        {
          "index": 2,
          "text": "Choose the smallest useful next action.",
          "condition": null,
          "id": "e2e00000-0000-4000-8000-000000000020:2"
        }
      ]
    },
    {
      "id": "e2e00000-0000-4000-8000-000000000200",
      "objectiveId": "e2e00000-0000-4000-8000-000000000010",
      "workstreamId": "e2e00000-0000-4000-8000-000000000031",
      "parentId": null,
      "name": "runtime-lead",
      "status": "watching",
      "activity": "Reviewing eight children for stalls.",
      "mission": "Keep the pulse engine honest: real cost, real context, no silent failures.",
      "currentJob": "Get the engine to a state where a pulse costs what we say it costs.",
      "model": "gpt-5",
      "playbookId": "e2e00000-0000-4000-8000-000000000020",
      "taskId": "e2e00000-0000-4000-8000-000000000705",
      "branch": null,
      "heartbeatMinutes": 30,
      "nextPulseAt": "2026-08-17T23:53:04.845Z",
      "maxChildren": 12,
      "spendCapUsd": null,
      "spendUsd": 6.8,
      "contextTokens": 120000,
      "contextWindow": 400000,
      "permissions": [
        {
          "id": "repo",
          "label": "Read repo, run tests, open PRs",
          "granted": true,
          "needsApproval": false
        },
        {
          "id": "comment",
          "label": "Comment on tickets it owns",
          "granted": true,
          "needsApproval": false
        },
        {
          "id": "merge",
          "label": "Merge without review",
          "granted": false,
          "needsApproval": true
        }
      ],
      "dryRun": false,
      "lastPulseSeq": 12,
      "idleSince": "2026-08-17T23:32:04.845Z",
      "createdAt": "2026-08-15T03:29:00.344Z",
      "updatedAt": "2026-08-17T23:34:05.148Z",
      "retiredAt": null,
      "contextUsed": 0.3,
      "spend": 6.8,
      "spendCap": null,
      "subtreeSpend": 13.160000000000004,
      "nextPulseInMinutes": 3,
      "idleMinutes": 18,
      "latestPulseSeq": 12,
      "ticketId": "e2e00000-0000-4000-8000-000000000705",
      "childCount": 9,
      "recentPulses": [
        {
          "id": "54928cd9-f5b6-4b98-8dea-9b054375587f",
          "harnessId": "e2e00000-0000-4000-8000-000000000200",
          "seq": 12,
          "startedAt": "2026-08-17T23:34:04.845Z",
          "endedAt": "2026-08-17T23:38:04.845Z",
          "outcome": "ok",
          "summary": "runtime-lead: advanced its slice and recorded evidence.",
          "costUsd": 0.5666666666666667,
          "tokens": 7134,
          "weight": 0.5095996103256796,
          "durationMs": 240000,
          "cost": 0.5666666666666667
        },
        {
          "id": "425671c8-05a9-44db-8998-878cdd43e5ca",
          "harnessId": "e2e00000-0000-4000-8000-000000000200",
          "seq": 11,
          "startedAt": "2026-08-17T20:34:04.845Z",
          "endedAt": "2026-08-17T20:38:04.845Z",
          "outcome": "ok",
          "summary": "runtime-lead: advanced its slice and recorded evidence.",
          "costUsd": 0.5666666666666667,
          "tokens": 11684,
          "weight": 0.8345589967518228,
          "durationMs": 240000,
          "cost": 0.5666666666666667
        }
      ],
      "routine": [
        {
          "index": 1,
          "text": "Read the objective, your children, spend, and open interventions.",
          "condition": null,
          "id": "e2e00000-0000-4000-8000-000000000020:1"
        },
        {
          "index": 2,
          "text": "Choose the smallest useful next action.",
          "condition": null,
          "id": "e2e00000-0000-4000-8000-000000000020:2"
        }
      ]
    }
  ],
  "interventions": [
    {
      "id": "e2e00000-0000-4000-8000-000000000601",
      "objectiveId": "e2e00000-0000-4000-8000-000000000010",
      "harnessId": "e2e00000-0000-4000-8000-000000000104",
      "kind": "question",
      "title": "Retry with backoff, or fail the delivery and surface it?",
      "detail": "The spec says at-least-once but the customer endpoint 500s on duplicates. Your call decides the public contract.",
      "impact": "idle since",
      "payload": null,
      "status": "pending",
      "response": null,
      "createdAt": "2026-08-17T10:34:04.845Z",
      "resolvedAt": null,
      "harnessName": "554-webhook-retry",
      "diff": null,
      "budget": null
    }
  ],
  "tickets": [
    {
      "id": "e2e00000-0000-4000-8000-000000000706",
      "ref": "E2E000",
      "title": "Rendezvous coordinator exceeded its budget",
      "state": "triaged",
      "ownerHarnessId": "e2e00000-0000-4000-8000-000000000105",
      "ownerHarnessName": "555-rendezvous",
      "ownerStatus": "failed",
      "branch": null,
      "prNumber": null,
      "childCount": 0,
      "labels": [
        {
          "text": "high",
          "tone": "high"
        }
      ],
      "rawLabels": [
        "high"
      ],
      "assignmentNote": null
    },
    {
      "id": "e2e00000-0000-4000-8000-000000000705",
      "ref": "E2E000",
      "title": "Pulse engine records real cost per model",
      "state": "in-review",
      "ownerHarnessId": "e2e00000-0000-4000-8000-000000000200",
      "ownerHarnessName": "runtime-lead",
      "ownerStatus": "watching",
      "branch": null,
      "prNumber": null,
      "childCount": 0,
      "labels": [
        {
          "text": "integrations",
          "tone": "integrations"
        }
      ],
      "rawLabels": [
        "integrations"
      ],
      "assignmentNote": "Get the engine to a state where a pulse costs what we say it costs."
    }
  ],
  "activity": [
    {
      "id": "failed-e2e00000-0000-4000-8000-000000000105",
      "verb": "failed",
      "text": "555-rendezvous",
      "at": "2026-08-17T23:34:05.150Z"
    },
    {
      "id": "merged-e2e00000-0000-4000-8000-000000000705",
      "verb": "merged",
      "text": "E2E000 Pulse engine records real cost per model",
      "at": "2026-08-17T23:34:05.148Z"
    }
  ]
};
