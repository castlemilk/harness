---
name: ngram-cache
description: N-gram KV-cache warmup for Ollama local inference — when to use it, how to configure providers, and benchmark evidence.
---

# ngram-cache

N-gram KV-cache warmup for Ollama local inference — when to use it, how to configure providers, and benchmark evidence.

## When to use

Use this skill when the user asks to:
- Understand n-gram caching in the harness
- Configure a provider with cache modes (`cold`, `warm-prefix`, `warm-ngram`)
- Benchmark local Ollama models with cache warmup
- Decide whether n-gram caching is beneficial for a workload
- Interpret `ngramCacheHitRate` in benchmark results

## What it is

N-gram caching warms Ollama's KV cache by sending the full prompt prefix with a small marker appended. The measured run then reuses the cached prefix state, skipping prefill work. This is implemented in the harness `OllamaProvider` and exposed through `ProviderConfig` and `SendOptions`.

**Key insight**: The benefit depends entirely on whether the same prompt prefix is reused across multiple requests.

## Cache modes

| Mode | Warmup prompt | Use case |
|---|---|---|
| `cold` | Distinct cache-breaking prompt | Default. No cache reuse. |
| `warm-prefix` | Same prompt text | When measuring cached-prefix behavior intentionally. |
| `warm-ngram` | Same prompt + n-gram marker | When measuring prefix cache hit rate. |

## Configuration

### Provider-level defaults

```bash
curl -X POST http://localhost:4000/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "ollama-ngram",
    "kind": "ollama",
    "baseUrl": "http://127.0.0.1:11435",
    "defaultModel": "qwen3.8:27b-mlx",
    "defaultCacheMode": "warm-ngram",
    "defaultWarmupRuns": 1,
    "defaultContextTokens": 4096,
    "enabled": true
  }'
```

### Per-request overrides

```typescript
// In agent or benchmark code
await provider.send(prompt, {
  cacheMode: 'warm-ngram',
  warmupRuns: 1,
  contextTokens: 262144,
  keepAlive: '30m',
});
```

## Benchmark evidence

### Long-context (262K needle test) — n-gram is transformative

| Metric | Cold | Warm-ngram | Improvement |
|---|---|---|---|
| TTFT | 719.4s (12 min) | 1.0s | **-99.86%** |
| Prompt tok/s | 362 | 1,944,163 | **+5,371x** |
| Gen tok/s | 15.9 | 19.5 | +22.6% |
| Total elapsed | 719.6s | 29.1s | **-96.0%** |

**Why**: The warmup builds KV-cache state for the full 260K-token prefix. The measured run skips prefill almost entirely.

### Synthetic benchmark (5 tasks) — n-gram is harmful

| Metric | Cold | Warm-ngram | Delta |
|---|---|---|---|
| Total duration | 279.5s | 369.7s | +32% slower |
| Total tokens | 152,570 | 167,168 | +9.6% more |

**Why**: Each synthetic task creates a new project with different prompts. The warmup cost isn't amortized because there's no repeated prefix.

### Decision matrix

| Workload | Recommended mode | Reason |
|---|---|---|
| Long-context evaluation (>32K) | `warm-ngram` | Prefill dominates; cache eliminates it |
| Variance benchmark (same task ×N) | `warm-ngram` | Warmup cost amortized across runs |
| Synthetic suite (different tasks) | `cold` | No prefix reuse; warmup is pure overhead |
| Short prompts (<1K tokens) | `cold` | Prefill is fast; warmup adds latency |
| Single-run agent task | `cold` | No repetition to benefit from |
| Multi-turn chat with long history | `warm-prefix` | Prefix naturally grows; Ollama reuses it |

## Usage in benchmarks

### Via provider config (recommended for repeated workloads)

```bash
# Create provider with n-gram defaults
curl -X POST http://localhost:4000/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "ollama-ngram",
    "kind": "ollama",
    "baseUrl": "http://127.0.0.1:11435",
    "defaultModel": "qwen3.8:27b-mlx",
    "defaultCacheMode": "warm-ngram",
    "defaultWarmupRuns": 1,
    "enabled": true
  }'

# Run benchmark using that provider
curl -X POST http://localhost:4000/bench/run \
  -H 'Content-Type: application/json' \
  -d '{
    "suite": "synthetic",
    "models": [{"provider": "ollama-ngram", "model": "qwen3.8:27b-mlx"}],
    "varianceRuns": 3,
    "concurrency": 1
  }'
```

### Via direct Ollama API (for validation)

```bash
# Warm the cache
curl http://127.0.0.1:11435/api/generate \
  -d '{"model":"qwen3.8:27b-mlx","prompt":"<full prompt>\n// ngram-cache warm abc123","stream":false,"options":{"num_predict":1}}'

# Measure with cache
curl http://127.0.0.1:11435/api/generate \
  -d '{"model":"qwen3.8:27b-mlx","prompt":"<full prompt>","stream":false,"options":{"num_predict":64}}'
```

## Metrics

Each benchmark result includes `usage.ngramCacheHitRate` (0-1):

- `0.0` = No cache reuse (full prefill)
- `0.5` = Half the prefill work avoided
- `1.0` = Full cache hit (zero prefill)

The rate is computed as `1 - (measured_prompt_duration / warmup_prompt_duration)`.

## Implementation details

- **Warmup prompt**: `prompt + "\n// ngram-cache warm " + sha256(prompt)[:8]`
- **Hash**: SHA-256 of the full prompt text, first 8 hex chars
- **Cache state**: Ollama's in-memory KV cache, keyed by model + prompt tokens
- **Scope**: Cache is per-model, per-prompt; survives until `keep_alive` expires or model is unloaded

## Limitations

1. **Ollama-only**: Cloud providers (OpenAI, Anthropic, Kimi) do not expose KV-cache control.
2. **In-memory only**: Cache is lost when the model unloads. No SSD persistence without a custom Ollama build.
3. **Per-prompt**: Different prompts have separate cache entries. No cross-prompt sharing.
4. **Warmup cost**: First request with a new prefix pays full prefill cost.

## Related skills

- `omega-bench`: Run benchmarks and process reports.
- `omega-harness`: General harness architecture and CLI usage.
