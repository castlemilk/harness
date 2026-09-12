# Docker E2E: harness → cuttlefish hello-world

This is the local, fully-containerised validation of the workflow execution
path. It builds the harness image, starts the tracing stack, publishes a
hello-world workflow through the harness API, runs a task on a cuttlefish
runner, and asserts the result plus the cross-system distributed trace.

```
┌──────────────────────────┐         ┌───────────────────────────────────┐
│  Docker Desktop          │         │  micropod / Apple Container (VM)   │
│                          │         │                                    │
│  omega-harness :4000 ────┼──┐      │  postgres  10.63.219.x:5432        │
│    │  OTLP               │  │      │  minio     10.63.219.x:9000        │
│    ▼                    │  └──────┼─▶ cuttlefish controlplane :4444    │
│  otel-collector :14318   │         │      │ OTLP via Mac LAN IP         │
│    │        │            │◀────────┼──────┘ 192.168.x.x:14318           │
│    ▼        ▼            │         │                                    │
│  tempo   mimir :9009     │         └───────────────────────────────────┘
│  :13200   (existing)     │                        ▲
└──────────────────────────┘                        │ hosts poll :4444
                                     cuttlefish runner containers (Desktop)
```

- The harness reaches cuttlefish at `host.docker.internal:4444` (the micropod
  controlplane's published port).
- The controlplane exports OTLP to the collector at the **Mac's LAN IP**, the
  only host route that works from a micropod custom network (see
  [observability.md](observability.md#environment-notes)).
- postgres/minio are reached by container IP because micropod's DNS no longer
  resolves service names for newly created containers; `cuttlefish-otel-up.sh`
  pins them and restores hostnames when the regression is fixed.

## Prerequisites

- Docker Desktop running (harness, Tempo, collector, runner containers).
- The cuttlefish repo checked out next to this one (`../cuttlefish` by default)
  with its local stack started at least once (`make up`), creating the
  postgres/minio volumes.
- Apple's `container` CLI (ships with micropod) to load the patched
  controlplane image.
- A cuttlefish runner registered against `host.docker.internal:4444` (the
  Desktop `cuttlefish-linux-runner-*` containers re-register automatically).

## One command

```bash
scripts/e2e/docker-e2e.sh        # build, run, trace assertions, tear down
KEEP=1 scripts/e2e/docker-e2e.sh # leave the harness + tracing stack running
task cuttlefish:e2e              # same via task
```

What it does, in order:

1. `docker compose up -d --build` for the harness (`:4000`), Tempo (`:13200`)
   and the OTel collector (`:14317/14318`).
2. `cuttlefish-otel-up.sh`:
   - ensures the controlplane image in micropod contains the W3C propagator
     patch (builds it with `docker buildx --platform linux/arm64 --output
     type=oci` and loads it with `container image load` if missing)
   - verifies the collector is reachable from the micropod network at the
     Mac's LAN IP
   - recreates the micropod controlplane with `DATABASE_URL`/`MINIO_ENDPOINT`
     pinned to container IPs and `OTEL_EXPORTER_OTLP_ENDPOINT=http://<lan-ip>:14318`
   - waits for `/readyz`; runners re-register automatically
3. `cuttlefish-hello-world.sh`:
   - registers/reuses runtime connection `local-docker`
   - publishes `deploy/cuttlefish/hello-world.yaml` via
     `POST /v1/runtimes/:id/workflows`
   - creates a task tagged `flow:hello-world`, runs it, polls until terminal
   - asserts the cuttlefish logs contain `hello from cuttlefish`
   - asserts the MCP endpoint exposes tools
   - resolves the flow's `traceId` and asserts Tempo has spans from both
     `omega-harness` and `cuttlefish-controlplane`
   - asserts span-derived metrics reached Mimir (`/v1/observability/hotspots`)
4. Cleanup: `cuttlefish-otel-down.sh` recreates the controlplane without
   tracing (same IP-pinned deps), then the harness stack is torn down unless
   `KEEP=1`.

## Manual run

```bash
docker compose up -d --build
scripts/e2e/cuttlefish-otel-up.sh

HARNESS_API_URL=http://127.0.0.1:4000 \
RUNTIME_BASE_URL=http://host.docker.internal:4444 \
EXPECT_TRACES=1 \
  scripts/e2e/cuttlefish-hello-world.sh

scripts/e2e/cuttlefish-otel-down.sh
docker compose down -v
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OMEGA_PORT` | `4000` | Host port for the harness. |
| `HARNESS_API_URL` | `http://127.0.0.1:${OMEGA_PORT}` | Harness API used by assertions. |
| `CUTTLEFISH_API_URL` | `http://127.0.0.1:4444` | Control plane the script health-checks. |
| `RUNTIME_BASE_URL` | `http://host.docker.internal:4444` | URL stored on the RuntimeConnection (must work from the harness container). |
| `EXPECT_TRACES` | `0` (`1` via wrapper) | Assert Tempo spans + Mimir hotspots. |
| `CUTTLEFISH_OTEL` | `1` | Enable tracing + trace assertions. Set `0` for the harness-only flow. |
| `CUTTLEFISH_OTEL_HOST_IP` | `en0`/`en1` LAN address | Mac LAN IP the controlplane exports to. |
| `CUTTLEFISH_OTEL_BUILD` | `0` | Force-rebuild the patched controlplane image. |
| `CUTTLEFISH_DIR` | `../cuttlefish` or `~/projects/cuttlefish` | Cuttlefish checkout. |
| `KEEP` | `0` | Keep the harness stack running after the test. |
| `TIMEOUT_S` | `180` | Task completion timeout. |

## Troubleshooting

- **"collector not reachable"**: confirm the harness stack is up and that
  `CUTTLEFISH_OTEL_HOST_IP` is the Mac's active LAN address
  (`ipconfig getifaddr en0`). Containers on micropod networks cannot reach
  `192.168.64.1` or `host.docker.internal`.
- **"lookup postgres ... no such host"**: expected until micropod DNS is
  fixed; the helper pins dependency IPs in the controlplane env.
- **"lacks the W3C propagator patch"**: `cmd/controlplane/main.go` in the
  cuttlefish checkout needs `otel.SetTextMapPropagator`; the helper builds the
  micropod image from that working tree.
- **Runner not picking up work**: restart a Desktop runner container so it
  re-registers against the controlplane now on `:4444`.
- **Artifact upload fails (`dial tcp: lookup minio`)** on cuttlefish's macOS
  "machine" executor: use inline-node workflows (the default hello-world) or
  the docker executor; artifacts are not required for the smoke test.
- **Harness unhealthy**: `docker compose logs harness`; first boot applies
  migrations and seeds providers.
