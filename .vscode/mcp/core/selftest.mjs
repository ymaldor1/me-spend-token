// `node launch.mjs --test [server|all]`: shows the stored profile (secrets masked), then
// for each server checks token acquisition + a few read-only API calls, and finally does
// a real MCP handshake (initialize + tools/list) through launch.mjs.
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  FLOW_RESOURCE,
  SERVERS,
  createTokenProvider,
  decodeJwt,
  loadConfig,
  mcpRoot,
  missingKeys,
  readProfile,
  workspaceRoot,
} from './auth.mjs';

const SECRET_KEYS = new Set(['ClientSecret', 'RefreshToken']);
const FLOW_API = 'https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple';

function tail(text, lines = 6) {
  return text.trim().split(/\r?\n/).slice(-lines).join(' | ');
}

function describeToken(token) {
  const c = decodeJwt(token);
  const who = c.upn ?? c.preferred_username ?? (c.idtyp === 'app' || c.roles ? `app ${c.appid ?? c.azp}` : c.oid);
  const grants = c.scp ? `scp=${c.scp}` : c.roles ? `roles=${[].concat(c.roles).join(' ')}` : 'no scp/roles';
  return `aud=${c.aud} as ${who} (${grants})`;
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`.trim());
  return body;
}

function handshake(server, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(mcpRoot, 'launch.mjs'), server], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PP_MCP_NO_SETUP: '1', PP_MCP_WORKSPACE: workspaceRoot },
    });
    const tools = [];
    let buffer = '';
    let stderr = '';
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      err ? reject(err) : resolve(tools);
    };
    const timer = setTimeout(() => finish(new Error(`timeout after ${timeoutMs / 1000}s; stderr: ${tail(stderr)}`)), timeoutMs);
    const send = (msg) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
    child.stdin.on('error', () => {});
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => finish(new Error(`server exited (${code}) before tools/list; stderr: ${tail(stderr)}`)));
    child.stdout.on('data', (d) => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) return finish(new Error(`${msg.error.code}: ${msg.error.message}`));
        if (msg.id === 1) {
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list', params: {} });
        } else if (typeof msg.id === 'number' && msg.id >= 2) {
          tools.push(...(msg.result?.tools ?? []));
          if (msg.result?.nextCursor) send({ id: msg.id + 1, method: 'tools/list', params: { cursor: msg.result.nextCursor } });
          else finish();
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pp-mcp-selftest', version: '1.0.0' } },
    });
  });
}

function checksFor(server, values, provider) {
  const env = values.EnvironmentId;
  const dataverse = values.EnvironmentUrl?.replace(/\/+$/, '');
  const token = (resource) => provider.getAccessToken(resource);
  const flowsInEnv = {
    name: `Flow API: flows in ${env}`,
    run: async () => `${(await getJson(`${FLOW_API}/environments/${env}/flows?api-version=2016-11-01`, await token(FLOW_RESOURCE))).value?.length ?? 0} flow(s) visible`,
  };
  const whoAmI = {
    name: `Dataverse WhoAmI (${dataverse})`,
    run: async () => {
      const t = await token(dataverse);
      const me = await getJson(`${dataverse}/api/data/v9.2/WhoAmI`, t);
      return `UserId=${me.UserId}; ${describeToken(t)}`;
    },
  };
  switch (server) {
    case 'power-platform':
      return [
        whoAmI,
        {
          name: 'Dataverse read: solutions',
          run: async () => `${(await getJson(`${dataverse}/api/data/v9.2/solutions?$select=uniquename&$top=50`, await token(dataverse))).value.length} solution(s) readable (top 50)`,
        },
        flowsInEnv,
      ];
    case 'power-automate':
      return [
        { name: 'Flow token', run: async () => describeToken(await token(FLOW_RESOURCE)) },
        {
          name: 'Flow API: environments',
          run: async () => `${(await getJson(`${FLOW_API}/environments?api-version=2016-11-01`, await token(FLOW_RESOURCE))).value?.length ?? 0} environment(s)`,
        },
        flowsInEnv,
        { name: 'Connectivity token (api.powerplatform.com)', run: async () => describeToken(await token('https://api.powerplatform.com')) },
        { name: 'API Hub token (connections)', run: async () => describeToken(await token('https://apihub.azure.com')) },
        ...(dataverse ? [whoAmI] : []),
      ];
    default:
      return [];
  }
}

export async function runSelfTest(target) {
  const servers = target === 'all' ? SERVERS : [target];
  if (!servers.every((s) => SERVERS.includes(s))) throw new Error(`Unknown server '${target}'`);
  const config = loadConfig();
  const values = await readProfile(config);
  const provider = createTokenProvider(config, values);
  let failures = 0;

  console.log(`Auth mode '${config.mode}', workspace '${config.workspace}', profile '${config.profile}' (credentials: PowerPlatformMCP:${config.workspace}:${config.profile}:*)`);
  for (const [key, value] of Object.entries(values)) {
    const shown = !value ? '(not set)' : SECRET_KEYS.has(key) ? `(stored, ${value.length} chars)` : value;
    console.log(`  ${key.padEnd(15)} ${shown}`);
  }

  for (const server of servers) {
    console.log(`\n== ${server}`);
    const missing = missingKeys(server, config.mode, values);
    if (missing.length) {
      failures++;
      console.log(`  FAIL  missing: ${missing.join(', ')} -> run: npm run setup --prefix .vscode/mcp`);
      continue;
    }
    if (server === 'canvas-authoring') {
      console.log(`  INFO  delegated sign-in only; 'connect' will default login_hint=${values.Username}, tenant_id=${values.TenantId}`);
    }
    for (const check of checksFor(server, values, provider)) {
      try {
        console.log(`  PASS  ${check.name}: ${await check.run()}`);
      } catch (err) {
        failures++;
        console.log(`  FAIL  ${check.name}: ${err.message}`);
      }
    }
    try {
      const tools = await handshake(server);
      console.log(`  PASS  MCP handshake: ${tools.length} tool(s) (${tools.slice(0, 6).map((t) => t.name).join(', ')}${tools.length > 6 ? ', ...' : ''})`);
    } catch (err) {
      failures++;
      console.log(`  FAIL  MCP handshake: ${err.message}`);
    }
  }
  console.log(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}`);
  return failures ? 1 : 0;
}
