import { EventEmitter } from 'node:events';
import { envInt } from './utils.js';

export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

export interface QueueResult {
  queued: boolean;
  position: number;
}

export interface QueueStatus {
  active: number;
  queued: number;
  completed: number;
  failed: number;
  maxConcurrency: number;
}

interface QueueEntry {
  id: string;
  provider: string | undefined;
  run: () => Promise<unknown>;
}

class TaskQueue extends EventEmitter {
  private maxConcurrency: number;
  private providerLimits: Map<string, number>;
  private active = 0;
  private providerActive = new Map<string, number>();
  private queue: QueueEntry[] = [];
  private completed = 0;
  private failed = 0;
  private draining = false;

  constructor() {
    super();
    this.maxConcurrency = envInt('OMEGA_MAX_CONCURRENT_TASKS', 3);
    this.providerLimits = new Map();
  }

  private getProviderLimit(provider: string): number {
    if (this.providerLimits.has(provider)) {
      return this.providerLimits.get(provider) ?? this.maxConcurrency;
    }
    const limit = envInt(`OMEGA_MAX_CONCURRENT_${provider.toUpperCase()}`, this.maxConcurrency);
    this.providerLimits.set(provider, limit);
    return limit;
  }

  private providerCount(name: string): number {
    return this.providerActive.get(name) ?? 0;
  }

  private canRun(entry: QueueEntry): boolean {
    if (this.active >= this.maxConcurrency) return false;
    if (entry.provider) {
      if (this.providerCount(entry.provider) >= this.getProviderLimit(entry.provider)) return false;
    }
    return true;
  }

  private acquire(entry: QueueEntry): void {
    this.active++;
    if (entry.provider) {
      this.providerActive.set(entry.provider, this.providerCount(entry.provider) + 1);
    }
  }

  private release(entry: QueueEntry): void {
    this.active--;
    if (entry.provider) {
      this.providerActive.set(entry.provider, this.providerCount(entry.provider) - 1);
    }
  }

  private runEntry(entry: QueueEntry): void {
    this.acquire(entry);
    entry
      .run()
      .then(() => {
        this.completed++;
      })
      .catch(() => {
        this.failed++;
      })
      .finally(() => {
        this.release(entry);
        this.emit('tick');
        if (!this.draining) {
          this.processQueue();
        }
      });
  }

  private processQueue(): void {
    for (let i = 0; i < this.queue.length; ) {
      const entry = this.queue[i];
      if (this.canRun(entry)) {
        this.queue.splice(i, 1);
        this.runEntry(entry);
      } else {
        i++;
      }
    }
  }

  enqueue(
    id: string,
    provider: string | undefined,
    run: () => Promise<unknown>,
  ): QueueResult {
    if (this.draining) {
      throw new Error('Task queue is draining');
    }

    const entry: QueueEntry = { id, provider, run };

    if (this.canRun(entry)) {
      this.runEntry(entry);
      return { queued: false, position: 0 };
    }

    const position = this.queue.length;
    this.queue.push(entry);
    return { queued: true, position };
  }

  status(): QueueStatus {
    return {
      active: this.active,
      queued: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      maxConcurrency: this.maxConcurrency,
    };
  }

  async drain(): Promise<void> {
    this.draining = true;
    if (this.active === 0 && this.queue.length === 0) return;

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.active === 0 && this.queue.length === 0) {
          this.removeListener('tick', check);
          resolve();
        }
      };
      this.on('tick', check);
      check();
    });
  }
}

export const queue = new TaskQueue();
