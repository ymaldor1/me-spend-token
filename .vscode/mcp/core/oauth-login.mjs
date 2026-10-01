// Interactive OAuth sign-in (authorization code + PKCE, loopback redirect) used by the
// setup script. Prints {"refreshToken","username","tenantId"} as JSON on stdout; all
// human-facing output goes to stderr. Exit code 1 = failed or cancelled (hints printed).
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { decodeJwt } from './auth.mjs';

const { values: args } = parseArgs({
  options: {
    tenant: { type: 'string' },
    client: { type: 'string' },
    'login-hint': { type: 'string' },
  },
});
if (!args.tenant || !args.client) {
  console.error('Usage: node oauth-login.mjs --tenant <id> --client <id> [--login-hint <upn>]');
  process.exit(2);
}

const HINTS = [
  [/AADSTS5300[0-9]|AADSTS53003|AADSTS530003/, 'A Conditional Access policy blocks this app for you. Try another app (PAC CLI / your own app registration); an admin can see which policy in Entra > Sign-in logs > Conditional Access.'],
  [/AADSTS65002/, 'This Microsoft app is not pre-authorized for the requested API. Try another app or your own app registration.'],
  [/AADSTS65001|AADSTS90094|AADSTS90008/, 'Admin consent is required. Use an app registration on which an admin granted consent.'],
  [/AADSTS50105/, 'Your account is not assigned to this app (assignment required). Ask an admin or try another app.'],
  [/AADSTS700016/, 'This app ID does not exist in the tenant. Check the client ID and tenant ID.'],
  [/AADSTS50011|AADSTS500113/, 'Redirect URI not registered: add http://localhost under Authentication > "Mobile and desktop applications".'],
  [/AADSTS7000218|AADSTS700025/, 'Public client flows are disabled for this app: set Authentication > "Allow public client flows" = Yes.'],
  [/AADSTS50020|AADSTS90072/, 'This account does not exist in the tenant (guest / wrong tenant). Check the tenant ID.'],
  [/AADSTS50076|AADSTS50079/, 'MFA is required: complete it in the browser, then retry.'],
];

function hintFor(text) {
  return HINTS.find(([pattern]) => pattern.test(text))?.[1];
}

function fail(message) {
  console.error(`\nSign-in failed: ${message}`);
  const hint = hintFor(message);
  if (hint) console.error(`Hint: ${hint}`);
  process.exitCode = 1;
}

// Only OIDC scopes here: the refresh token is then redeemed per API, so an API the app is
// not allowed to reach fails in the access test instead of blocking sign-in entirely.
const scope = 'openid profile offline_access';
const authority = `https://login.microsoftonline.com/${args.tenant}/oauth2/v2.0`;
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');

let settle;
const outcome = new Promise((resolve) => (settle = resolve));

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    res.writeHead(404).end();
    return;
  }
  const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
  res.end(
    ok
      ? '<h2>Power Platform MCP: signed in.</h2><p>You can close this tab and return to the setup window.</p>'
      : '<h2>Power Platform MCP: sign-in failed.</h2><p>See the setup window for details.</p>'
  );
  if (ok) settle({ code: url.searchParams.get('code') });
  else settle({ error: `${url.searchParams.get('error') ?? ''}: ${url.searchParams.get('error_description') ?? 'state mismatch'}` });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

const v4 = http.createServer(handler);
const v6 = http.createServer(handler);
const port = await listen(v4, 0, '127.0.0.1');
// Browsers may resolve "localhost" to ::1 first; bind the same port there when possible.
await listen(v6, port, '::1').catch(() => {});
const redirectUri = `http://localhost:${port}`;

const authorizeUrl = new URL(`${authority}/authorize`);
authorizeUrl.search = new URLSearchParams({
  client_id: args.client,
  response_type: 'code',
  redirect_uri: redirectUri,
  response_mode: 'query',
  scope,
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  ...(args['login-hint'] ? { login_hint: args['login-hint'] } : { prompt: 'select_account' }),
}).toString();

console.error('\nOpening your browser for sign-in. If it does not open, paste this URL into a browser:');
console.error(`${authorizeUrl}\n`);
console.error('If the browser shows an error instead of "signed in", type the AADSTS code it shows (or just press Enter) to cancel.');
spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${authorizeUrl.toString().replace(/'/g, "''")}'`], {
  stdio: 'ignore',
  windowsHide: true,
}).on('error', () => {});

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => settle({ error: `cancelled${line.trim() ? ` (${line.trim()})` : ''}` }));
const timer = setTimeout(() => settle({ error: 'timed out after 5 minutes' }), 5 * 60_000);

try {
  const result = await outcome;
  if (result.error) {
    fail(result.error);
  } else {
    const res = await fetch(`${authority}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: args.client,
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        scope,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.refresh_token) {
      fail(`${json.error ?? res.status}: ${(json.error_description ?? 'no refresh token returned').split(/\r?\n| Trace ID:/)[0]}`);
    } else {
      const claims = decodeJwt(json.id_token ?? json.access_token);
      process.stdout.write(
        JSON.stringify({
          refreshToken: json.refresh_token,
          username: claims.preferred_username ?? claims.upn ?? '',
          tenantId: claims.tid ?? '',
        })
      );
      console.error(`Signed in as ${claims.preferred_username ?? claims.upn ?? '(unknown)'}.`);
    }
  }
} catch (err) {
  fail(err.message);
} finally {
  clearTimeout(timer);
  rl.close();
  process.stdin.destroy();
  for (const server of [v4, v6]) {
    server.closeAllConnections();
    server.close(() => {});
  }
}
