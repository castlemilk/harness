import { Command } from 'commander';
import { HarnessApiClient, runStdioServer } from '@omega/mcp';
import { getApiUrl } from '../api.js';

/** Poll a URL until it answers or the budget runs out. */
async function isReachable(baseUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const mcpCmd = new Command('mcp')
  .description('Run the harness MCP server over stdio (for Claude Code, Codex, Cursor, ...)')
  .option('--api-url <url>', 'Harness API base URL (defaults to the --api global option)')
  .option('--token <token>', 'API bearer token (defaults to OMEGA_API_TOKEN)')
  .option(
    '--standalone',
    'Mount the harness API inside this process on an ephemeral loopback port instead of requiring a running server'
  )
  .option('--embedded-timeout <ms>', 'How long to wait for the embedded API to become reachable', '2000')
  .action(async (opts: { apiUrl?: string; token?: string; standalone?: boolean; embeddedTimeout?: string }) => {
    const token = opts.token ?? process.env.OMEGA_API_TOKEN;
    let baseUrl = opts.apiUrl ?? process.env.OMEGA_API_URL ?? getApiUrl();
    let embedded: { close: () => Promise<void> } | undefined;
    const closeEmbedded = async (): Promise<void> => {
      await embedded?.close();
      embedded = undefined;
    };

    if (opts.standalone) {
      process.stderr.write('[harness mcp] standalone: embedding the harness API in this process\n');
    } else if (!(await isReachable(baseUrl, 1_500))) {
      process.stderr.write(
        `[harness mcp] no harness API at ${baseUrl}; embedding one in this process. ` +
          'Start the server separately to share state, or pass --standalone to be explicit.\n'
      );
      opts.standalone = true;
    }

    if (opts.standalone) {
      const { startEmbeddedApi } = await import('@omega/server/embedded');
      const api = await startEmbeddedApi();
      embedded = api;
      baseUrl = api.baseUrl;
      process.stderr.write(`[harness mcp] embedded API ready at ${baseUrl}\n`);
    }

    const client = new HarnessApiClient({ baseUrl, token });
    try {
      await runStdioServer({ client });
    } finally {
      // The stdio transport only settles on EOF/SIGINT; releasing the port on
      // the way out keeps repeated spawns from leaking listeners.
      await closeEmbedded();
    }
  });