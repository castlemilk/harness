import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export const HARNESS_VERSION = '0.6.11';
const TRACER_NAME = 'omega-harness';

let sdk: NodeSDK | null = null;
let tracer: Tracer = trace.getTracer(TRACER_NAME, HARNESS_VERSION);

/** Tracing is opt-in: no OTLP endpoint means every span call is a no-op. */
export function telemetryEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

export function initTelemetry(): void {
  if (sdk || !telemetryEnabled()) return;
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || TRACER_NAME,
    [ATTR_SERVICE_VERSION]: HARNESS_VERSION,
  });
  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();
  tracer = trace.getTracer(TRACER_NAME, HARNESS_VERSION);
  console.log(`OTel tracing enabled -> ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ''}`);
}

export async function shutdownTelemetry(): Promise<void> {
  const instance = sdk;
  sdk = null;
  if (!instance) return;
  try {
    await instance.shutdown();
  } catch (err) {
    console.error('OTel shutdown failed:', err instanceof Error ? err.message : String(err));
  }
}

export function getTracer(): Tracer {
  return tracer;
}

export function getActiveTraceId(): string | undefined {
  return trace.getSpan(context.active())?.spanContext().traceId;
}

/** Injects W3C trace context (traceparent) into outbound HTTP headers. */
export function injectTraceContext(carrier: Record<string, string>): void {
  propagation.inject(context.active(), carrier);
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
