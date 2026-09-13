import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHarnessMcpServer, type CreateHarnessMcpServerOptions } from './server.js';

/**
 * Runs the harness MCP server over stdio. This is what `harness mcp` starts
 * when an MCP client (Claude Code, Codex, Cursor, ...) spawns the CLI.
 */
export async function runStdioServer(options: CreateHarnessMcpServerOptions): Promise<void> {
  const server = createHarnessMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void server.close().finally(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    transport.onclose = shutdown;
  });
}
