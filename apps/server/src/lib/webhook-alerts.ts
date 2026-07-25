import type { PrismaClient } from '@omega/db';

export interface FailureAlert {
  taskId: string;
  title: string;
  provider?: string;
  model?: string;
  error: string;
  tags: string[];
  timestamp: string;
}

function envUrls(): string[] {
  const raw = process.env.OMEGA_WEBHOOK_URLS;
  if (!raw) return [];
  return raw.split(',').map((u) => u.trim()).filter(Boolean);
}

export async function notifyFailure(prisma: PrismaClient, alert: FailureAlert): Promise<void> {
  const urls = envUrls();
  if (urls.length === 0) return;

  const payload = JSON.stringify({
    event: 'task.failed',
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

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          console.warn(`Webhook ${url} returned ${res.status}`);
        }
      } catch (err) {
        console.warn(`Webhook ${url} failed:`, err instanceof Error ? err.message : err);
      }
    }),
  );
}

export async function notifyQueueDrained(
  prisma: PrismaClient,
  stats: { active: number; queued: number; completed: number; failed: number },
): Promise<void> {
  const urls = envUrls();
  if (urls.length === 0) return;
  if (stats.failed === 0) return;

  const payload = JSON.stringify({
    event: 'queue.drained',
    stats,
    timestamp: new Date().toISOString(),
  });

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // best-effort
      }
    }),
  );
}
