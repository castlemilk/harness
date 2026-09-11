---
name: local-model-manager
description: Manage local Ollama models through the harness UI — discovery, configuration, proxy routing, n-gram caching, and Token Horizon metrics.
---

# local-model-manager

Manage local Ollama models through the harness UI — discovery, configuration, proxy routing, n-gram caching, and Token Horizon metrics.

## When to use

Use this skill when the user asks to:
- Add, configure, or remove local Ollama models in the harness
- Discover what models are available on the local Ollama daemon
- Launch a model with proxy routing for Token Horizon analytics
- Configure n-gram caching for a local model
- View token metrics and usage for local models
- Understand the local model management UI

## Architecture

The local model manager has three layers:

1. **Database** (`LocalModelConfig` in Prisma): Stores per-model configuration (name, base URL, cache mode, warmup runs, context tokens, keep-alive, proxy enabled, Token Horizon URL).
2. **API** (`/local-models` routes): CRUD for configurations, model discovery, launch testing, and metrics aggregation.
3. **UI** (`LocalModelPanel` in React): Sidebar view for managing models with discovery, forms, and metrics display.

## Configuration fields

| Field | Default | Purpose |
|---|---|---|
| `name` | — | Unique config identifier |
| `baseUrl` | `http://127.0.0.1:11435` | Ollama endpoint (proxy) or `11434` (direct) |
| `model` | — | Ollama model name (e.g. `qwen3.8:27b-mlx`) |
| `cacheMode` | `cold` | `cold`, `warm-prefix`, or `warm-ngram` |
| `warmupRuns` | `0` | Number of warmup requests before measured runs |
| `contextTokens` | `4096` | `num_ctx` sent to Ollama per request |
| `keepAlive` | `30m` | Model retention in memory |
| `proxyEnabled` | `true` | Route through Token Horizon proxy (`11435`) |
| `tokenHorizonUrl` | `http://127.0.0.1:8765` | Token Horizon health/metrics endpoint |

## API endpoints

```
GET    /local-models              # List configured models
POST   /local-models              # Create or update a model config
GET    /local-models/:id          # Get a specific config
DELETE /local-models/:id          # Delete a config
GET    /local-models/discover     # Scan Ollama for available models
POST   /local-models/:id/launch   # Test-launch a model through proxy
GET    /local-models/:id/metrics  # Get usage metrics for a model
```

## UI features

- **Discover Models**: Scans the Ollama daemon for installed models
- **Add Model**: Form to configure a new local model with all fields
- **Launch Test**: Sends a minimal request to verify the model is reachable
- **Metrics**: Shows token usage, run count, and Token Horizon proxy status
- **Use in Bench**: Links the model config to benchmark runs

## Best practices

1. **Always use the proxy** (`11435`) for local models when Token Horizon is running. This gives you exact tok/s, prompt eval counts, and completion metrics without estimating from hardware usage.

2. **Use `warm-ngram` for long-context** (>32K) or repeated prompts. The warmup cost is amortized across measured runs.

3. **Use `cold` for synthetic benchmarks** with different tasks. Each task has a different prompt, so the cache warmup is pure overhead.

4. **Set `contextTokens` to the model's advertised maximum** for long-context evaluation. For `qwen3.8:27b-mlx`, use `262144`.

5. **Set `keepAlive` to `30m`** for benchmarks. Set to `0` to unload immediately after the run.

6. **One config per workload**: Create separate configs for cold benchmarks vs. n-gram long-context evaluation, even if they use the same model.

## Related skills

- `ngram-cache`: Deep dive on n-gram cache modes and benchmark evidence.
- `omega-bench`: Run benchmarks and process reports.
- `omega-harness`: General harness architecture and CLI usage.
