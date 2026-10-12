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
    // server.close() closes the transport, which fires onclose again. Without
    // this guard that recurses until the stack overflows — which is what a
    // client hitting EOF (or a signal) used to trigger.
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void server.close().finally(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    transport.onclose = shutdown;
  });
}
