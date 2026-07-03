import express from 'express';
import cors from 'cors';
import { prisma } from '@omega/db';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { providerRoutes } from './routes/providers.js';
import { routerRoutes } from './routes/router.js';
import { metricsRoutes } from './routes/metrics.js';

export const app: express.Express = express();

app.use(cors());
app.use(express.json());

app.use('/projects', projectRoutes(prisma));
app.use('/tasks', taskRoutes(prisma));
app.use('/providers', providerRoutes(prisma));
app.use('/router', routerRoutes(prisma));
app.use('/metrics', metricsRoutes(prisma));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: message });
});
