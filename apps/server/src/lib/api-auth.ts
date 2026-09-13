import type { Request, Response, NextFunction } from 'express';

/**
 * Optional bearer-token gate for the public API (`/v1`, `/mcp`).
 *
 * The harness is local-first, so auth is off unless `OMEGA_API_TOKEN` is set.
 * `/v1/health` stays open so orchestrators can probe liveness without a token.
 */
export function apiAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.OMEGA_API_TOKEN;
  if (!expected) {
    next();
    return;
  }
  if (req.path === '/health') {
    next();
    return;
  }
  const header = req.header('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
  const alt = req.header('x-omega-token')?.trim();
  if (bearer === expected || alt === expected) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}
