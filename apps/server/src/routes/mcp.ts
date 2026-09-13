import { Router, type Request, type Response } from 'express';
import { HarnessApiClient, handleMcpHttpRequest, resolveHarnessApiUrl } from '@omega/mcp';
import { asyncHandler } from '../lib/async-handler.js';

/**
 * Mounts the MCP Streamable HTTP endpoint on the harness server itself, so
 * remote MCP clients can point at `http://host:4000/mcp`. The tool handlers
 * call back into this server's own `/v1` API, which keeps a single execution
 * path for local and remote MCP clients.
 */
export function mcpRoutes(): Router {
  const r = Router();

  const handler = async (req: Request, res: Response): Promise<void> => {
    const client = new HarnessApiClient({
      baseUrl: process.env.OMEGA_MCP_API_URL ?? resolveHarnessApiUrl(),
      token: process.env.OMEGA_API_TOKEN,
    });
    await handleMcpHttpRequest(req, res, req.body, { client });
  };

  r.post('/', asyncHandler(handler));
  r.get('/', asyncHandler(handler));
  r.delete('/', asyncHandler(handler));

  return r;
}
