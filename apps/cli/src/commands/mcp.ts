import { Command } from 'commander';
import { HarnessApiClient, runStdioServer } from '@omega/mcp';
import { getApiUrl } from '../api.js';

export const mcpCmd = new Command('mcp')
  .description('Run the harness MCP server over stdio (for Claude Code, Codex, Cursor, ...)')
  .option('--api-url <url>', 'Harness API base URL (defaults to the --api global option)')
  .option('--token <token>', 'API bearer token (defaults to OMEGA_API_TOKEN)')
  .action(async (opts: { apiUrl?: string; token?: string }) => {
    const baseUrl = opts.apiUrl ?? process.env.OMEGA_API_URL ?? getApiUrl();
    const token = opts.token ?? process.env.OMEGA_API_TOKEN;
    if (!process.stdout.isTTY) {
      // stdio transport owns stdout; logs must go to stderr only.
      console.error(`[harness mcp] connecting to ${baseUrl}`);
    }
    const client = new HarnessApiClient({ baseUrl, token });
    await runStdioServer({ client });
  });
