import crypto from 'node:crypto';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

export const OPENAI_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  callbackPort: 1455,
  callbackPath: '/auth/callback',
  scope: 'openid profile email offline_access',
} as const;

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return base64URLEncode(randomBytes(16));
}

export function buildAuthorizeUrl(opts: {
  codeChallenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_OAUTH.clientId,
    redirect_uri: `http://localhost:${OPENAI_OAUTH.callbackPort}${OPENAI_OAUTH.callbackPath}`,
    scope: OPENAI_OAUTH.scope,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    state: opts.state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'omega',
  });
  return `${OPENAI_OAUTH.authorizeUrl}?${params.toString()}`;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OPENAI_OAUTH.clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: `http://localhost:${OPENAI_OAUTH.callbackPort}${OPENAI_OAUTH.callbackPath}`,
  });

  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as OAuthTokenResponse;
  return data;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: OPENAI_OAUTH.clientId,
    refresh_token: refreshToken,
  });

  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as OAuthTokenResponse;
  return data;
}

export interface CallbackResult {
  code: string;
  state: string;
}

export function startCallbackServer(
  port: number,
  expectedState: string,
  signal?: AbortSignal,
): Promise<CallbackResult> {
  return new Promise<CallbackResult>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('No URL');
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== OPENAI_OAUTH.callbackPath) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing code or state</h1></body></html>');
        server.close();
        reject(new Error('Missing code or state in callback'));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>State mismatch</h1></body></html>');
        server.close();
        reject(new Error('State mismatch — possible CSRF'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>Authorization Successful</h1><p>You can close this window and return to the terminal.</p></body></html>`);

      server.close();
      resolve({ code, state });
    });

    server.listen(port, () => {
      // If the signal aborts before the callback arrives, clean up
      if (signal?.aborted) {
        server.close();
        reject(new Error('OAuth flow cancelled'));
        return;
      }
      signal?.addEventListener('abort', () => {
        server.close();
        reject(new Error('OAuth flow cancelled'));
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Close the other process or use a different port.`));
      } else {
        reject(err);
      }
    });
  });
}
