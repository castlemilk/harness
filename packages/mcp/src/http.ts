import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  createHarnessMcpServer,
  createHarnessMcpServerFromEnv,
  type CreateHarnessMcpServerOptions,
} from './server.js';

/**
 * Stateless Streamable HTTP handler for the harness MCP endpoint.
 *
 * A fresh server + transport is built per request; MCP tool calls are
 * independent HTTP round-trips, so no session state is needed. `enableJsonResponse`
 * keeps responses as plain JSON instead of SSE, which is friendlier for
 * API-style clients and proxies.
 */
export async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
  options?: CreateHarnessMcpServerOptions
): Promise<void> {
  const server = options ? createHarnessMcpServer(options) : createHarnessMcpServerFromEnv();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  };
  res.on('close', cleanup);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    // GET/DELETE streams may stay open; the res close handler cleans those up.
    if (!res.writableEnded) cleanup();
  }
}
