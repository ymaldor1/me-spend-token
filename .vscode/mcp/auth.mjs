// Shared certificate-based (client-assertion JWT) app-only auth for Power Platform /
// Dataverse. Signing happens via the Windows certificate store (see
// get-signed-assertion.ps1) — the private key is never exported to disk.
// Never handles a client secret.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let envLoaded = false;
function loadEnvFile(envPath) {
  if (envLoaded) return;
  envLoaded = true;
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireEnv(name) {
  loadEnvFile(path.join(repoRoot, '.env'));
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required .env value: ${name}`);
  }
  return value;
}

export async function discoverTenantId(envUrl) {
  if (process.env.PP_TENANT_ID) return process.env.PP_TENANT_ID;

  const probeUrl = new URL('/api/data/v9.2/', envUrl).toString();
  const res = await fetch(probeUrl, { redirect: 'manual' });
  const authHeader = res.headers.get('www-authenticate');
  if (!authHeader) {
    throw new Error(
      `Could not discover tenant id: no WWW-Authenticate header from ${probeUrl} (status ${res.status}). Set PP_TENANT_ID in .env to skip discovery.`
    );
  }

  const match = authHeader.match(/authorization_uri="?https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})/i);
  if (!match) {
    throw new Error(`Could not parse tenant id out of WWW-Authenticate header: ${authHeader}`);
  }
  return match[1];
}

async function getSignedAssertion({ thumbprint, clientId, tokenEndpoint }) {
  const scriptPath = path.join(repoRoot, 'scripts', 'pp-auth', 'get-signed-assertion.ps1');
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-Thumbprint', thumbprint,
    '-ClientId', clientId,
    '-Audience', tokenEndpoint,
  ];
  // Prefer pwsh (PowerShell 7) to match the interactive session's cert-store view;
  // fall back to Windows PowerShell 5.1 if pwsh isn't installed.
  try {
    const { stdout } = await execFileAsync('pwsh.exe', args);
    return stdout.trim();
  } catch (err) {
    if (err.code === 'ENOENT') {
      const { stdout } = await execFileAsync('powershell.exe', args);
      return stdout.trim();
    }
    throw err;
  }
}

async function exchangeToken({ tokenEndpoint, clientId, assertion, scope }) {
  const body = new URLSearchParams({
    client_id: clientId,
    scope,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

// Keyed by env URL so multiple Dataverse environments can be used in one process.
const tokenCache = new Map();

export async function getDataverseToken(envUrl) {
  const targetEnvUrl = envUrl || requireEnv('PP_ENV_URL');
  const cached = tokenCache.get(targetEnvUrl);
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.accessToken;
  }

  const thumbprint = requireEnv('PP_CERT_THUMBPRINT');
  const clientId = requireEnv('PP_CLIENT_ID');
  const scope = `${new URL(targetEnvUrl).origin}/.default`;

  const tenantId = await discoverTenantId(targetEnvUrl);
  const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const assertion = await getSignedAssertion({ thumbprint, clientId, tokenEndpoint });
  const { access_token: accessToken, expires_in: expiresIn } = await exchangeToken({
    tokenEndpoint,
    clientId,
    assertion,
    scope,
  });

  tokenCache.set(targetEnvUrl, {
    accessToken,
    expiresAt: Date.now() + Number(expiresIn ?? 3600) * 1000,
  });
  return accessToken;
}
