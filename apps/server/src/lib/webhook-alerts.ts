import type { PrismaClient } from '@omega/db';
import { isCredentialError } from './utils.js';

export { isCredentialError };

// ─── Alert Types ────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface FailureAlert {
  taskId: string;
  title: string;
  provider?: string;
  model?: string;
  error: string;
  tags: string[];
  timestamp: string;
  severity?: AlertSeverity;
}

export interface RetryAlert {
  taskId: string;
  title: string;
  provider: string | null;
  model: string | null;
  strategy: string;
  retryCount: number;
  previousError: string;
  tags: string[];
  timestamp: string;
}

export interface ProviderHealthAlert {
  provider: string;
  event: 'error_rate_threshold' | 'latency_degradation' | 'credential_failure' | 'rate_limit_surge' | 'circuit_open';
  severity: AlertSeverity;
  message: string;
  metrics: Record<string, unknown>;
  timestamp: string;
}

// ─── Severity Rules ─────────────────────────────────────────────────────────

function classifySeverity(error: string): AlertSeverity {
  const lower = error.toLowerCase();
  if (lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('invalid api key')) {
    return 'critical'; // key is invalid — immediate action needed
  }
  if (lower.includes('rate') || lower.includes('429') || lower.includes('too many')) {
    return 'warning'; // transient, will recover
  }
  if (lower.includes('timeout') || lower.includes('abort') || lower.includes('cascade timeout')) {
    return 'warning'; // recoverable
  }
  return 'info'; // generic failures
}

// ─── Threshold Rules ────────────────────────────────────────────────────────

interface ThresholdRule {
  check: (metrics: ProviderMetricsSnapshot) => ProviderHealthAlert | null;
}

interface ProviderMetricsSnapshot {
  provider: string;
  errorRate: number;
  rateLimitRate: number;
  latencyP50: number;
  latencyP95: number;
  recentCalls: number;
}

const thresholdRules: ThresholdRule[] = [
  {
    check: (m) => {
      if (m.recentCalls < 10) return null;
      if (m.errorRate > 0.5) {
        return {
          provider: m.provider,
          event: 'error_rate_threshold',
          severity: 'critical',
          message: `Provider ${m.provider} error rate at ${String(Math.round(m.errorRate * 100))}% (${String(m.recentCalls)} recent calls)`,
          metrics: { errorRate: m.errorRate, recentCalls: m.recentCalls },
          timestamp: new Date().toISOString(),
        };
      }
      return null;
    },
  },
  {
    check: (m) => {
      if (m.recentCalls < 10) return null;
      if (m.rateLimitRate > 0.3) {
        return {
          provider: m.provider,
          event: 'rate_limit_surge',
          severity: 'warning',
          message: `Provider ${m.provider} rate-limited ${String(Math.round(m.rateLimitRate * 100))}% of requests`,
          metrics: { rateLimitRate: m.rateLimitRate, recentCalls: m.recentCalls },
          timestamp: new Date().toISOString(),
        };
      }
      return null;
    },
  },
  {
    check: (m) => {
      if (m.recentCalls < 5 || m.errorRate > 0.5) return null;
      if (m.latencyP95 > 60_000) {
        return {
          provider: m.provider,
          event: 'latency_degradation',
          severity: 'warning',
          message: `Provider ${m.provider} P95 latency at ${String(Math.round(m.latencyP95 / 1000))}s`,
          metrics: { latencyP50: m.latencyP50, latencyP95: m.latencyP95, recentCalls: m.recentCalls },
          timestamp: new Date().toISOString(),
        };
      }
      return null;
    },
  },
];

// ─── Webhook Dispatch ───────────────────────────────────────────────────────

function envUrls(): string[] {
  const raw = process.env.OMEGA_WEBHOOK_URLS;
  if (!raw) return [];
  return raw.split(',').map((u) => u.trim()).filter(Boolean);
}

async function postWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const urls = envUrls();
  if (urls.length === 0) return;

  const body = JSON.stringify({ event, ...payload });
  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          console.warn(`Webhook ${url} returned ${String(res.status)}`);
        }
      } catch (err) {
        console.warn(`Webhook ${url} failed:`, err instanceof Error ? err.message : err);
      }
    }),
  );
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function notifyFailure(prisma: PrismaClient, alert: FailureAlert): Promise<void> {
  const severity = alert.severity ?? classifySeverity(alert.error);
  console.error(`[${severity.toUpperCase()}] Task ${alert.taskId} failed: ${alert.error.slice(0, 200)}`);
  await postWebhook('task.failed', {
    severity,
    task: {
      id: alert.taskId,
      title: alert.title,
      provider: alert.provider,
      model: alert.model,
      error: alert.error,
      tags: alert.tags,
    },
    timestamp: alert.timestamp,
  });
}

export async function notifyRetry(prisma: PrismaClient, alert: RetryAlert): Promise<void> {
  void prisma; // reserved for future per-task routing
  await postWebhook('task.retry', {
    severity: 'info',
    task: {
      id: alert.taskId,
      title: alert.title,
      provider: alert.provider,
      model: alert.model,
      strategy: alert.strategy,
      retryCount: alert.retryCount,
      previousError: alert.previousError,
      tags: alert.tags,
    },
    timestamp: alert.timestamp,
  });
}

export async function notifyQueueDrained(
  prisma: PrismaClient,
  stats: { active: number; queued: number; completed: number; failed: number },
): Promise<void> {
  if (stats.failed === 0) return;
  console.warn(`Queue drained: ${String(stats.failed)} failed, ${String(stats.completed)} completed`);
  await postWebhook('queue.drained', {
    stats,
    timestamp: new Date().toISOString(),
  });
}

export async function notifyProviderHealth(
  prisma: PrismaClient,
  alert: ProviderHealthAlert,
): Promise<void> {
  console.warn(`[${alert.severity.toUpperCase()}] ${alert.message}`);
  await postWebhook('provider.health', {
    severity: alert.severity,
    provider: alert.provider,
    event: alert.event,
    message: alert.message,
    metrics: alert.metrics,
    timestamp: alert.timestamp,
  });
}

/**
 * Runs threshold checks against all provider health data.
 * Called periodically by the server.
 */
export async function checkThresholds(
  prisma: PrismaClient,
  router?: { health: { getEntries(): { provider: string; errorRate: number; rateLimitRate: number; latencyP50: number; latencyP95: number; recentCalls: number; circuitState: string }[] } },
): Promise<void> {
  if (!router) return;
  const entries = router.health.getEntries();
  for (const entry of entries) {
    const snapshot: ProviderMetricsSnapshot = {
      provider: entry.provider,
      errorRate: entry.errorRate,
      rateLimitRate: entry.rateLimitRate,
      latencyP50: entry.latencyP50,
      latencyP95: entry.latencyP95,
      recentCalls: entry.recentCalls,
    };
    for (const rule of thresholdRules) {
      const alert = rule.check(snapshot);
      if (alert) {
        await notifyProviderHealth(prisma, alert);
      }
    }
  }
}
