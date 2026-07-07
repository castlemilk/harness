import { Command } from 'commander';
import open from 'open';
import { apiFetch } from '../api.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthorizeUrl,
  exchangeCode,
  startCallbackServer,
} from '@omega/providers/oauth';

export const providerCmd = new Command('provider').description('Manage providers');

providerCmd
  .command('login')
  .description('Log in to an OAuth provider')
  .argument('[kind]', 'provider kind (openai)', 'openai')
  .option('--name <name>', 'provider name to save as', 'openai-oauth')
  .option('--port <port>', 'local callback port', '1455')
  .action(async (kind: string, opts: { name: string; port: string }) => {
    if (kind !== 'openai') {
      console.error('Only openai OAuth login is supported currently.');
      process.exit(1);
    }

    const port = parseInt(opts.port, 10);
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const authorizeUrl = buildAuthorizeUrl({ codeChallenge, state });

    console.log('Opening browser for OpenAI authentication...');
    console.log(`Authorize URL: ${authorizeUrl}`);

    const ac = new AbortController();

    // Start the callback server and open the browser in parallel
    const [callbackResult] = await Promise.all([
      startCallbackServer(port, state, ac.signal),
      open(authorizeUrl),
    ]).catch((err: Error) => {
      ac.abort();
      throw err;
    });

    console.log('Authorization received, exchanging code for tokens...');
    const tokenResponse = await exchangeCode(callbackResult.code, codeVerifier);

    const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

    // Check if a provider with this name already exists
    const allProviders = (await apiFetch('/providers')) as { id: string; name: string }[];
    const existing = allProviders.find((p) => p.name === opts.name);

    if (existing) {
      console.log(`Updating existing provider "${opts.name}"...`);
      await apiFetch(`/providers/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          tokenExpiresAt: expiresAt,
          enabled: true,
        }),
      });
      console.log(`Provider "${opts.name}" updated with OAuth credentials.`);
    } else {
      console.log(`Creating new provider "${opts.name}"...`);
      await apiFetch('/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: opts.name,
          kind: 'openai',
          defaultModel: 'gpt-4o',
          apiKey: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          tokenExpiresAt: expiresAt,
          capabilities: [
            { name: 'gpt-4o', level: 'advanced', supportsTools: true },
            { name: 'gpt-4o-mini', level: 'capable', supportsTools: true },
            { name: 'o3', level: 'advanced', supportsTools: true },
            { name: 'o4-mini', level: 'advanced', supportsTools: true },
          ],
          enabled: true,
        }),
      });
      console.log(`Provider "${opts.name}" created with OAuth credentials.`);
    }

    const expiryDate = new Date(expiresAt);
    console.log(`Token expires at: ${expiryDate.toISOString()}`);
    console.log('OpenAI OAuth login complete.');
  });

providerCmd
  .command('list')
  .description('List providers')
  .action(async () => {
    const providers = await apiFetch('/providers');
    console.log(JSON.stringify(providers, null, 2));
  });
