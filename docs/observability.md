# Observability: distributed traces and hotspots

The harness ships OpenTelemetry traces and span-derived metrics to a local
stack so an end-to-end run can be inspected as one trace and ranked by latency.

## Pipeline

```
harness (OTLP HTTP :4318)
    │  HTTP server spans, flow.run / flow.dispatch spans
    ▼
otel-collector ── traces ──▶ Tempo :3200 (query :13200)      per-span debugging
    │
    └── spanmetrics ──▶ Mimir :9009                          hotspots (p50/p95/p99, errors)
```

Mimir stores metrics only; traces live in Tempo. The collector's `spanmetrics`
connector turns every span into call/latency/error series keyed by
`service_name` + `span_name`, which is what `/v1/observability/hotspots`
queries.

Stack (started by `docker compose`):

| Service | Container port | Host port |
| --- | --- | --- |
| Tempo | 3200 | `TEMPO_QUERY_PORT` (13200) |
| OTel collector OTLP gRPC | 4317 | `OTEL_GRPC_PORT` (14317) |
| OTel collector OTLP HTTP | 4318 | `OTEL_HTTP_PORT` (14318) |
| Mimir (existing local stack) | 9009 | 9009 |

## Harness instrumentation

- **HTTP server spans** for every request, named by route pattern
  (`GET /v1/flows/:id/trace`) to keep spanmetrics cardinality bounded;
  incoming `traceparent` is extracted so harness spans can join upstream traces.
- **`flow.run`** — one span per dispatched cuttlefish flow, from dispatch to
  terminal status, with events for status transitions. Its trace id is stored
  on `FlowRun.traceId`, which is what the query API uses.
- **`flow.dispatch`** — child span around `POST /api/runs/start`. The
  cuttlefish client injects W3C `traceparent` on every request, so the
  controlplane's `controlplane.http` span is a child of it (same trace).
- **`task.run`** — local agent/provider runs emit their own trace (not joined
  to the request trace in detached mode).
- **Database mirror** — node attempts and the per-flow step stay in
  `TraceSpan`/`TaskStep` and are merged into the flow trace response, covering
  the runner tier which is not OTel-instrumented yet.

Tracing is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. The SDK registers
`AsyncLocalStorage` context, a W3C propagator, and a batch exporter; spans are
flushed on graceful shutdown.

## Querying

```bash
# Everything for one flow: Tempo spans + harness DB spans + runner history
curl http://localhost:4000/v1/flows/<flow-id>/trace

# One trace by id (normalized spans: service, timing, status, attributes)
curl http://localhost:4000/v1/observability/traces/<trace-id>

# Pipeline health (tracing enabled? Tempo/Mimir reachable?)
curl http://localhost:4000/v1/observability/status

# Latency hotspots over a window: service, operation, p50/p95/p99, err%, calls/s
curl 'http://localhost:4000/v1/observability/hotspots?window=15m&limit=10'
```

MCP tools: `omega_flow_trace`, `omega_observability_trace`,
`omega_observability_status`, `omega_observability_hotspots`.

Web UI:

- **Task detail → Distributed tab** — waterfall of the flow's trace, service
  chips, per-span attributes/events, and the cuttlefish runner history.
- **Side panel → Hotspots** — top operations by p95 with OTLP/Tempo/Mimir
  status dots; window selector (5m/15m/1h).

## Hotspots and optimisation

`/v1/observability/hotspots` discovers the spanmetrics metric names in Mimir
(`traces_spanmetrics_calls_total`, `traces_spanmetrics_latency_bucket`) so
collector version changes don't break it, then merges:

- `rate(calls[window])` per `service_name`/`span_name`
- `histogram_quantile(0.5|0.95|0.99, rate(duration_bucket[window]))`
- error ratio from the `status_code` dimension

Use it to find which stage dominates a slow run — e.g. `flow.run` end-to-end
vs `flow.dispatch` vs `controlplane.http` — then drill into the trace for that
flow. Hotspot numbers reflect only sampled spans; the harness samples all of
its own spans (`OTEL_TRACES_SAMPLER=parentbased_always_on` by default) and
cuttlefish honors the parent decision.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (disabled) | OTLP HTTP endpoint; `http://otel-collector:4318` in Docker. |
| `OTEL_SERVICE_NAME` | `omega-harness` | Resource service name. |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | SDK sampler. |
| `TEMPO_QUERY_URL` | `http://127.0.0.1:13200` | Tempo query base URL (`http://tempo:3200` in Docker). |
| `MIMIR_QUERY_URL` | `http://127.0.0.1:9009` | Prometheus-compatible query base URL. |
| `MIMIR_REMOTE_WRITE_URL` | `http://host.docker.internal:9009/api/v1/push` | Collector remote-write target. |
| `TEMPO_QUERY_PORT`, `OTEL_GRPC_PORT`, `OTEL_HTTP_PORT` | 13200/14317/14318 | Host port mappings. |

## Cuttlefish propagation requirement

Cuttlefish's `initOTEL` sets a `TracerProvider` but no `TextMapPropagator`, so
incoming `traceparent` headers are ignored and its spans start new traces. The
required addition in `cmd/controlplane/main.go` is:

```go
otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
    propagation.TraceContext{},
    propagation.Baggage{},
))
```

Micropod cannot build images (the Docker shim's buildx container cannot run in
the Apple VM), so `scripts/e2e/cuttlefish-otel-up.sh` builds the image on
Docker Desktop as an OCI archive and loads it into micropod with Apple's
`container image load`:

```bash
docker buildx build --platform linux/arm64 --no-cache-filter build \
  -f deploy/Dockerfile.controlplane \
  --tag cuttlefish-controlplane:otel --output type=oci,dest=/tmp/cp.tar .
container image load -i /tmp/cp.tar
```

The helper checks the source for `SetTextMapPropagator`, builds when
`cuttlefish-controlplane:otel` is missing (or `CUTTLEFISH_OTEL_BUILD=1`), and
recreates the controlplane with that image.

## Environment notes

On this macOS setup cuttlefish runs under **micropod** (Apple Container 1.3.1).
Three behaviours shaped the wiring:

1. **Custom networks cannot reach the vmnet gateway.** Containers on
   `cuttlefish_micropodval_default` (10.63.219.0/24) cannot connect to
   `192.168.64.1` or `host.docker.internal`; the default bridge can. They *can*
   reach the Mac's LAN address through VM NAT, so the controlplane exports to
   `http://<lan-ip>:14318` (discovered from `en0`, override with
   `CUTTLEFISH_OTEL_HOST_IP`). Failure mode: OTLP export timeouts and no
   `cuttlefish-controlplane` spans.
2. **Service DNS no longer resolves for newly created containers.** Even on a
   freshly created network, `postgres`/`minio` NXDOMAIN while the pre-existing
   containers could resolve them. Recreating the vmnet plugin to reset it
   wedges the network ("pending operation") — do not. The helper pins
   dependency IPs in the controlplane env instead; when Apple/micropod fixes
   DNS, the pinning can be dropped.
3. **A compose container-recreate attempt can reset volumes.** A `docker
   compose up` that tried to recreate postgres/minio removed the containers and
   the local Postgres volume came back empty. The data is disposable
   (`python3 scripts/dev/seed_examples.py --controlplane-url
   http://localhost:4444` republishes the catalog), but avoid compose
   recreates on that stack; the helper recreates only the controlplane
   (`--no-deps`) and pins the dependency IPs.

With the propagator image loaded and the LAN endpoint configured, the
distributed trace runs entirely through micropod: harness
`flow.dispatch` → controlplane `controlplane.http`, same trace id, visible in
Tempo and ranked in Mimir hotspots.

**If the Apple Container VM wedges** (`container list` / `docker ps` time out,
port forwards disappear after a shim restart, `container stop/delete` hang), a
**macOS restart** is the reliable recovery — the VM is below the user-space
daemons and cannot be reset by killing them. The container data volumes live on
disk under `~/Library/Application Support/com.apple.container/volumes/` and
survive. After reboot:

```bash
(cd ~/projects/cuttlefish && make up)          # postgres/minio/controlplane
python3 scripts/dev/seed_examples.py --controlplane-url http://localhost:4444   # if the catalog is empty
scripts/e2e/cuttlefish-otel-up.sh              # patched image + tracing
```

Do not restart `container-network-vmnet.*` plugins or run `container
stop/delete` against a wedged runtime — both hang and can leave networks with
"pending operation" state.

