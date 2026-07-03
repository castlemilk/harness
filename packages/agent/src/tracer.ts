import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@omega/db';

export interface TraceContext {
  traceId: string;
  spanId: string;
}

export interface SpanEvent {
  time: string;
  name: string;
  attributes?: Record<string, unknown>;
}

function generateId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export class Span {
  public readonly spanId: string;
  public readonly traceId: string;
  public readonly parentId?: string;
  public readonly name: string;
  public readonly taskId?: string;
  public startTime: Date;
  public endTime?: Date;
  public status: 'ok' | 'error' = 'ok';
  public attributes: Record<string, unknown> = {};
  public events: SpanEvent[] = [];
  private ended = false;

  constructor(
    name: string,
    traceId: string,
    spanId: string,
    parentId: string | undefined,
    taskId: string | undefined,
    private tracer: Tracer
  ) {
    this.name = name;
    this.traceId = traceId;
    this.spanId = spanId;
    this.parentId = parentId;
    this.taskId = taskId;
    this.startTime = new Date();
  }

  setAttributes(attrs: Record<string, unknown>): this {
    this.attributes = { ...this.attributes, ...attrs };
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.events.push({ time: new Date().toISOString(), name, attributes });
    return this;
  }

  recordError(error: unknown): this {
    this.status = 'error';
    this.attributes.error = error instanceof Error ? error.message : String(error);
    this.addEvent('error', { error: this.attributes.error });
    return this;
  }

  async end(status?: 'ok' | 'error'): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.endTime = new Date();
    if (status) this.status = status;
    await this.tracer.persist(this);
  }

  toContext(): TraceContext {
    return { traceId: this.traceId, spanId: this.spanId };
  }
}

export class Tracer {
  public readonly traceId: string;

  constructor(
    private prisma: PrismaClient,
    private taskId?: string,
    traceId?: string
  ) {
    this.traceId = traceId ?? generateId();
  }

  startSpan(name: string, parent?: TraceContext): Span {
    const spanId = generateId();
    return new Span(name, this.traceId, spanId, parent?.spanId, this.taskId, this);
  }

  async persist(span: Span): Promise<void> {
    try {
      await this.prisma.traceSpan.create({
        data: {
          traceId: span.traceId,
          spanId: span.spanId,
          parentId: span.parentId,
          taskId: span.taskId,
          name: span.name,
          startTime: span.startTime,
          endTime: span.endTime,
          status: span.status,
          attributes: JSON.stringify(span.attributes),
          events: JSON.stringify(span.events),
        },
      });
    } catch (err) {
      // Never let tracing failures break the agent.
      console.error('Failed to persist trace span:', err instanceof Error ? err.message : String(err));
    }
  }
}
