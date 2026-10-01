// Auth core shared by every MCP server in this pack: mode/profile config, Windows
// Credential Manager access (through auth/McpAuthCli.ps1) and a token provider that
// turns (mode, resource) into an access token.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Local install = <workspace>/.vscode/mcp. A global install gets the workspace from
// PP_MCP_WORKSPACE (${workspaceFolder} in mcp.json) or the cwd VS Code starts it in.
export const workspaceRoot = path.resolve(
  process.env.PP_MCP_WORKSPACE ||
    (path.basename(path.dirname(mcpRoot)).toLowerCase() === '.vscode' ? path.dirname(path.dirname(mcpRoot)) : process.cwd())
);
export const configPath = path.join(workspaceRoot, '.vscode', 'mcp', 'auth.config.json');
export const setupScript = path.join(mcpRoot, 'auth', 'Setup-McpAuth.ps1');
const cliScript = path.join(mcpRoot, 'auth', 'McpAuthCli.ps1');

export const MODES = ['secret', 'cert', 'oauth'];
export const SERVERS = ['power-platform', 'power-automate', 'canvas-authoring'];
export const FLOW_RESOURCE = 'https://service.flow.microsoft.com';
export const DEFAULT_OAUTH_CLIENT_ID = '9cee029c-6210-4654-90bb-17e6e9d36617'; // Power Platform CLI (pac) public client

const MODE_KEYS = {
  secret: ['AppClientId', 'ClientSecret'],
  cert: ['AppClientId', 'CertThumbprint'],
  oauth: ['OAuthClientId', 'RefreshToken', 'Username'],
};

const SERVER_KEYS = {
  'power-platform': ['TenantId', 'EnvironmentUrl', 'EnvironmentId'],
  'power-automate': ['TenantId', 'EnvironmentId'],
  // Canvas coauthoring is user-bound: the server only supports delegated MSAL sign-in.
  'canvas-authoring': ['TenantId', 'Username'],
};

export function requiredKeys(server, mode) {
  const base = SERVER_KEYS[server];
  if (!base) throw new Error(`Unknown server '${server}'. Expected one of: ${SERVERS.join(', ')}`);
  return server === 'canvas-authoring' ? base : [...base, ...MODE_KEYS[mode]];
}

export function missingKeys(server, mode, values) {
  return requiredKeys(server, mode).filter((key) => !values[key]);
}

export function loadConfig() {
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) : {};
  const mode = process.env.PP_MCP_AUTH_MODE || config.mode || 'oauth';
  const profile = process.env.PP_MCP_AUTH_PROFILE || config.profile || 'default';
  const workspace = config.workspace || path.basename(workspaceRoot).replace(/[^\w.-]/g, '_');
  if (!MODES.includes(mode)) throw new Error(`Invalid auth mode '${mode}' in ${configPath}. Expected: ${MODES.join(' | ')}`);
  if (!/^[\w.-]+$/.test(profile)) throw new Error(`Invalid profile name '${profile}' (letters, digits, . _ - only).`);
  if (!/^[\w.-]+$/.test(workspace)) throw new Error(`Invalid workspace name '${workspace}' in ${configPath} (letters, digits, . _ - only).`);
  return { mode, profile, workspace };
}

function runExe(exe, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${exe} exited with code ${code}`));
    });
    child.stdin.end(input ?? '');
  });
}

let pwshExe;
export async function runPowerShell(args, { input } = {}) {
  for (const exe of pwshExe ? [pwshExe] : ['pwsh.exe', 'powershell.exe']) {
    try {
      const out = await runExe(exe, args, input);
      pwshExe = exe;
      return out;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  throw new Error('PowerShell not found (pwsh.exe or powershell.exe).');
}

export function getPowerShellExe() {
  return pwshExe ?? 'pwsh.exe';
}

function scopeArgs({ workspace, profile }) {
  return ['-Workspace', workspace, '-ProfileName', profile];
}

export async function readProfile(config) {
  const json = await runPowerShell(['-File', cliScript, '-Action', 'Export', ...scopeArgs(config)]);
  return JSON.parse(json || '{}');
}

export async function writeProfileValues(config, values) {
  await runPowerShell(['-File', cliScript, '-Action', 'Import', ...scopeArgs(config)], { input: JSON.stringify(values) });
}

// Error class the launcher uses to decide "credentials are wrong -> reopen setup".
export class CredentialError extends Error {}

const CREDENTIAL_ERROR_CODES = ['invalid_client', 'invalid_grant', 'unauthorized_client'];

function toScope(resource) {
  const base = (resource || FLOW_RESOURCE).replace(/\/+$/, '');
  return base.endsWith('/.default') ? base : `${base}/.default`;
}

export function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export function createTokenProvider(config, values) {
  let owner = config;
  let { mode } = config;
  let tokenEndpoint = `https://login.microsoftonline.com/${values.TenantId}/oauth2/v2.0/token`;
  const cache = new Map();
  const inflight = new Map();
  let refreshToken = values.RefreshToken;
  let assertion = null;
  let persistChain = Promise.resolve();

  async function clientAssertion() {
    if (assertion && assertion.expiresAt > Date.now()) return assertion.value;
    try {
      const value = await runPowerShell([
        '-File', cliScript, '-Action', 'SignAssertion',
        '-Thumbprint', values.CertThumbprint, '-ClientId', values.AppClientId, '-Audience', tokenEndpoint,
      ]);
      assertion = { value, expiresAt: Date.now() + 5 * 60_000 };
      return value;
    } catch (err) {
      const Cls = /CERT_(NOT_FOUND|NO_KEY)/.test(err.message) ? CredentialError : Error;
      throw new Cls(`[pp-mcp-auth] certificate signing failed: ${err.message}`);
    }
  }

  async function requestBody(scope) {
    switch (mode) {
      case 'secret':
        return { grant_type: 'client_credentials', client_id: values.AppClientId, client_secret: values.ClientSecret, scope };
      case 'cert':
        return {
          grant_type: 'client_credentials',
          client_id: values.AppClientId,
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: await clientAssertion(),
          scope,
        };
      case 'oauth':
        return { grant_type: 'refresh_token', client_id: values.OAuthClientId, refresh_token: refreshToken, scope: `${scope} offline_access` };
      default:
        throw new Error(`Unsupported auth mode '${mode}'`);
    }
  }

  async function fetchToken(scope) {
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(await requestBody(scope)),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      const detail = `${json.error ?? res.status}: ${(json.error_description ?? '').split(/\r?\n| Trace ID:/)[0]}`;
      const Cls = CREDENTIAL_ERROR_CODES.includes(json.error) ? CredentialError : Error;
      throw new Cls(`[pp-mcp-auth] ${mode} token request for ${scope} failed (${detail}). Re-run the setup: npm run setup --prefix .vscode/mcp`);
    }
    if (mode === 'oauth' && json.refresh_token && json.refresh_token !== refreshToken) {
      refreshToken = json.refresh_token;
      const rotated = refreshToken;
      persistChain = persistChain
        .then(() => writeProfileValues(owner, { RefreshToken: rotated }))
        .catch((err) => console.error(`[pp-mcp-auth] could not persist rotated refresh token: ${err.message}`));
    }
    cache.set(scope, { token: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000 });
    return json.access_token;
  }

  const provider = {
    get mode() {
      return mode;
    },
    // Set by the launcher: called (not awaited) when a token request is rejected for credential reasons.
    onCredentialError: null,
    async getAccessToken(resource) {
      const scope = toScope(resource);
      const hit = cache.get(scope);
      if (hit && hit.expiresAt - 5 * 60_000 > Date.now()) return hit.token;
      if (!inflight.has(scope)) {
        inflight.set(scope, fetchToken(scope).finally(() => inflight.delete(scope)));
      }
      try {
        return await inflight.get(scope);
      } catch (err) {
        if (!(err instanceof CredentialError) || !provider.onCredentialError) throw err;
        provider.onCredentialError(err);
        throw new CredentialError(`${err.message} An auth setup window was opened on the desktop: complete it, then retry this call.`);
      }
    },
    invalidateAccessToken(resource) {
      cache.delete(toScope(resource));
    },
    reload(next, nextValues) {
      owner = next;
      mode = next.mode;
      values = nextValues;
      tokenEndpoint = `https://login.microsoftonline.com/${values.TenantId}/oauth2/v2.0/token`;
      refreshToken = values.RefreshToken;
      assertion = null;
      cache.clear();
    },
  };
  return provider;
}
