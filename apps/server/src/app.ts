import express from 'express';
import cors from 'cors';
import { prisma } from '@omega/db';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { providerRoutes } from './routes/providers.js';
import { routerRoutes } from './routes/router.js';
import { metricsRoutes } from './routes/metrics.js';
import { benchmarkRoutes } from './routes/benchmarks.js';
import { reportRoutes } from './routes/reports.js';
import { promptVersionRoutes } from './routes/prompt-versions.js';
import { costRoutes } from './routes/costs.js';
import { timeseriesRoutes } from './routes/timeseries.js';
import { benchRunRoutes } from './routes/bench-runs.js';
import { traceRoutes } from './routes/traces.js';
import { errorRoutes } from './routes/errors.js';
import { providerCompareRoutes } from './routes/provider-compare.js';
import { foremanRoutes } from './routes/foreman.js';
import { foremanEngineRoutes } from './routes/foreman-engine.js';

export const app: express.Express = express();

const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:5173',
  // Anything the launcher was told to expect, e.g. when 5173 was busy.
  ...(process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]);

/**
 * Loopback dev servers pick whatever port is free, so a fixed allowlist breaks
 * the moment 5173 is taken. The server binds 127.0.0.1 and has no auth, so a
 * loopback origin is no more privileged than a local curl — accept any of them
 * and keep the strict list for everything else.
 */
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || LOOPBACK_ORIGIN.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));
app.use(express.json());

app.use('/projects', projectRoutes(prisma));
app.use('/tasks', taskRoutes(prisma));
app.use('/providers', providerRoutes(prisma));
app.use('/router', routerRoutes(prisma));
app.use('/metrics', metricsRoutes(prisma));
app.use('/benchmarks', benchmarkRoutes(prisma));
app.use('/reports', reportRoutes());
app.use('/prompt-versions', promptVersionRoutes(prisma));
app.use('/costs', costRoutes(prisma));
app.use('/timeseries', timeseriesRoutes(prisma));
app.use('/bench/run', benchRunRoutes(prisma));
app.use('/traces', traceRoutes());
app.use('/errors', errorRoutes(prisma));
app.use('/providers/compare', providerCompareRoutes(prisma));
app.use('/foreman', foremanRoutes(prisma));
app.use('/foreman', foremanEngineRoutes(prisma));

/**
 * An unknown API path is a 404, not the SPA.
 *
 * `index.ts` mounts `express.static` and an `app.get('*')` that returns
 * `index.html` after this module's routes, so anything unmatched used to come
 * back as 200 + HTML. A typo'd endpoint then surfaced in the client as a JSON
 * parse error on markup, or worse, as `response.ok` and a silently empty
 * screen. This runs after every real route and before that catch-all, so the
 * two prefixes that are API surface answer in the same `{ error }` envelope
 * every route in here already uses. Everything else still falls through to the
 * SPA — deep links have to keep working.
 */
const API_PREFIXES = ['/api', '/foreman'];

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const isApiPath = API_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'));
  if (!isApiPath) {
    next();
    return;
  }
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err instanceof Error && err.name === 'ZodError' && 'issues' in err) {
    const issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const details = issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(400).json({ error: 'Validation error', details });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: message });
});
