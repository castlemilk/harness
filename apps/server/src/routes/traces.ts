import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { getRecentTraces, getTrace, getTraceStats, formatTraceSummary } from '../lib/trace-log.js';

export function traceRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler((req, res, _next) => {
    const limit = typeof req.query.limit === 'string' ? Math.min(parseInt(req.query.limit, 10) || 50, 200) : 50;
    const traces = getRecentTraces(limit);
    res.json(traces);
  }));

  r.get('/stats', asyncHandler((_req, res, _next) => {
    res.json(getTraceStats());
  }));

  r.get('/:taskId', asyncHandler((req, res, _next) => {
    const trace = getTrace(req.params.taskId);
    if (!trace) {
      res.status(404).json({ error: 'No trace found for this task' });
      return;
    }
    res.json(trace);
  }));

  r.get('/:taskId/summary', asyncHandler((req, res, _next) => {
    const trace = getTrace(req.params.taskId);
    if (!trace) {
      res.status(404).json({ error: 'No trace found for this task' });
      return;
    }
    res.type('text/plain').send(formatTraceSummary(trace));
  }));

  return r;
}
