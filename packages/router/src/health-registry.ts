// ─── Provider Health Registry ───────────────────────────────────────────────

interface HealthSample {
  timestamp: number;
  latencyMs: number;
  success: boolean;
  rateLimited: boolean;
  costUsd: number;
}

const HEALTH_WINDOW_MS = 30 * 60 * 1000; // 30-minute rolling window

export class ProviderHealthRegistry {
  private samples = new Map<string, HealthSample[]>();
  private circuits = new Map<string, { state: 'closed' | 'open' | 'half-open'; openedAt: number; cooldownUntil: number; trialInFlight: boolean; consecutiveSuccesses?: number }>();
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  private static readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 min before half-open probe
  private static readonly DEFAULT_RATE_LIMIT = 60; // 60 requests per minute per provider
  private static readonly RATE_WINDOW_MS = 60_000; // 1-minute sliding window

  record(providerKey: string, sample: Omit<HealthSample, 'timestamp'>): void {
    const list = this.samples.get(providerKey) ?? [];
    list.push({ ...sample, timestamp: Date.now() });
    // Prune old samples
    const cutoff = Date.now() - HEALTH_WINDOW_MS;
    while (list.length > 0 && list[0].timestamp < cutoff) list.shift();
    this.samples.set(providerKey, list);

    // Update circuit breaker state on failures
    if (!sample.success && !sample.rateLimited) {
      const health = this.getHealth(providerKey);
      if (health.errorRate > 0.5 && health.recentCalls >= 5) {
        const circuit = this.circuits.get(providerKey);
        if (circuit?.state !== 'open') {
          this.circuits.set(providerKey, {
            state: 'open',
            openedAt: Date.now(),
            cooldownUntil: Date.now() + ProviderHealthRegistry.COOLDOWN_MS,
            trialInFlight: false,
          });
        }
      }
    } else if (sample.success) {
      const circuit = this.circuits.get(providerKey);
      if (circuit && circuit.state !== 'closed') {
        const consecutiveSuccesses = (circuit.consecutiveSuccesses ?? 0) + 1;
        if (consecutiveSuccesses >= 3) {
          this.circuits.set(providerKey, {
            state: 'closed',
            openedAt: 0,
            cooldownUntil: 0,
            trialInFlight: false,
          });
        } else {
          this.circuits.set(providerKey, {
            ...circuit,
            consecutiveSuccesses,
          });
        }
      }
    }
  }

  restoreSample(providerKey: string, sample: HealthSample): void {
    const list = this.samples.get(providerKey) ?? [];
    list.push(sample);
    this.samples.set(providerKey, list);
  }

  getHealth(providerKey: string): ProviderHealth {
    const list = this.samples.get(providerKey) ?? [];
    if (list.length === 0) {
      return { latencyP50: 0, latencyP95: 0, errorRate: 0, rateLimitRate: 0, recentCalls: 0, score: 5 };
    }

    const latencies = list.map((s) => s.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const errors = list.filter((s) => !s.success).length;
    const rateLimits = list.filter((s) => s.rateLimited).length;
    const errorRate = errors / list.length;
    const rateLimitRate = rateLimits / list.length;

    let score = 10;
    score -= errorRate * 5;
    score -= rateLimitRate * 3;
    if (p95 > 30_000) score -= 2;
    else if (p95 > 15_000) score -= 1;
    else if (p95 > 5_000) score -= 0.5;

    return {
      latencyP50: p50,
      latencyP95: p95,
      errorRate,
      rateLimitRate,
      recentCalls: list.length,
      score: Math.max(0, Math.min(10, score)),
    };
  }

  isCircuitBroken(providerKey: string): boolean {
    const circuit = this.circuits.get(providerKey);
    if (!circuit || circuit.state === 'closed') return false;
    if (circuit.state === 'open') {
      if (Date.now() >= circuit.cooldownUntil) {
        circuit.state = 'half-open';
        circuit.trialInFlight = false;
        return false;
      }
      return true;
    }
    if (circuit.trialInFlight) return true;
    circuit.trialInFlight = true;
    return false;
  }

  getCircuitState(providerKey: string): 'closed' | 'open' | 'half-open' {
    return this.circuits.get(providerKey)?.state ?? 'closed';
  }

  checkRateLimit(providerKey: string, maxRpm = ProviderHealthRegistry.DEFAULT_RATE_LIMIT): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(providerKey);
    if (!bucket) {
      bucket = { tokens: maxRpm, lastRefill: now };
      this.buckets.set(providerKey, bucket);
    }
    const elapsed = now - bucket.lastRefill;
    const refill = (elapsed / ProviderHealthRegistry.RATE_WINDOW_MS) * maxRpm;
    bucket.tokens = Math.min(maxRpm, bucket.tokens + refill);
    bucket.lastRefill = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  rateLimitWaitMs(providerKey: string, maxRpm = ProviderHealthRegistry.DEFAULT_RATE_LIMIT): number {
    const bucket = this.buckets.get(providerKey);
    if (!bucket) return 0;
    if (bucket.tokens >= 1) return 0;
    const tokenIntervalMs = ProviderHealthRegistry.RATE_WINDOW_MS / maxRpm;
    return Math.ceil((1 - bucket.tokens) * tokenIntervalMs);
  }

  getEntries(): (ProviderHealth & { provider: string; circuitState: string })[] {
    return Array.from(this.samples.entries()).map(([name, samples]) => {
      const list = samples.slice(-200);
      const errors = list.filter((s) => !s.success).length;
      const rateLimits = list.filter((s) => s.rateLimited).length;
      const errorRate = list.length > 0 ? errors / list.length : 0;
      const rateLimitRate = list.length > 0 ? rateLimits / list.length : 0;
      const latencies = list
        .filter((s) => s.success && !s.rateLimited)
        .map((s) => s.latencyMs)
        .sort((a, b) => a - b);
      return {
        provider: name,
        latencyP50: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
        latencyP95: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
        errorRate,
        rateLimitRate,
        recentCalls: list.length,
        score: this.getHealth(name).score,
        circuitState: this.getCircuitState(name),
      };
    });
  }
}

export interface ProviderHealth {
  latencyP50: number;
  latencyP95: number;
  errorRate: number;
  rateLimitRate: number;
  recentCalls: number;
  score: number;
}
