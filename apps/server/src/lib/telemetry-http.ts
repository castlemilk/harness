import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';
import { getTracer } from './telemetry.js';

/**
 * Server span for every HTTP request. Extracts W3C trace context from incoming
 * headers so harness spans join traces started upstream, and names spans by
 * route pattern (not raw path) to keep spanmetrics cardinality bounded.
 */
export function httpSpanMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tracer = getTracer();
  const parent = propagation.extract(context.active(), req.headers);
  const queryIndex = req.originalUrl.indexOf('?');
  const span = tracer.startSpan(
    `${req.method} ${req.path}`,
    {
      attributes: {
        'http.request.method': req.method,
        'url.path': req.path,
        'url.query': queryIndex >= 0 ? req.originalUrl.slice(queryIndex + 1) : '',
        'http.route': req.path,
      },
    },
    parent
  );

  res.on('finish', () => {
    const matched = req.route as { path?: unknown } | undefined;
    const routePath = typeof matched?.path === 'string' ? matched.path : '';
    const route = `${req.baseUrl}${routePath}`;
    if (route) span.updateName(`${req.method} ${route}`);
    span.setAttribute('http.response.status_code', res.statusCode);
    span.setStatus({ code: res.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    span.end();
  });

  context.with(trace.setSpan(parent, span), () => {
    next();
  });
}
