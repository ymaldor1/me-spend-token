#!/usr/bin/env node
// Single entry point for every MCP server in this pack:
//   node launch.mjs <power-platform|power-automate|canvas-authoring>
//   node launch.mjs --test [server|all]
// Auth mode + profile come from auth.config.json; values from Windows Credential Manager.
// stdout is the MCP channel: everything human-readable goes to stderr.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CredentialError,
  FLOW_RESOURCE,
  SERVERS,
  createTokenProvider,
  getPowerShellExe,
  loadConfig,
  mcpRoot,
  missingKeys,
  readProfile,
  setupScript,
  workspaceRoot,
} from './core/auth.mjs';
import { serveFallback } from './core/fallback-server.mjs';

const PRIMARY_RESOURCE = {
  'power-platform': (values) => values.EnvironmentUrl,
  'power-automate': () => FLOW_RESOURCE,
};

function log(message) {
  console.error(`[pp-mcp] ${message}`);
}

async function ensureNodeModules() {
  if (existsSync(path.join(mcpRoot, 'node_modules', 'powerplatform-mcp'))) return;
  log(`installing dependencies in ${mcpRoot}`);
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: mcpRoot, shell: true, stdio: ['ignore', 2, 2] });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm install failed (${code})`))));
  });
}

// One setup window per profile, even when several servers start at the same time.
async function openSetupWindow(config, server, missing, reason) {
  const lockPath = path.join(os.tmpdir(), `pp-mcp-setup-${config.workspace}-${config.profile}.lock`);
  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (Date.now() - statSync(lockPath).mtimeMs > 30 * 60_000) {
      unlinkSync(lockPath);
      return openSetupWindow(config, server, missing, reason);
    }
    log('auth setup is already open for this profile, waiting for it to close');
    while (existsSync(lockPath)) await sleep(1000);
    return;
  }
  try {
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', setupScript, '-FromLauncher',
      '-Server', server, '-WorkspaceRoot', workspaceRoot, '-ProfileName', config.profile,
    ];
    if (missing.length) args.push('-Missing', missing.join(','));
    if (reason) args.push('-Reason', reason);
    // Start-Process gives the setup its own console window; Node's `detached` would give it none.
    const commandLine = args.map((a) => `"${String(a).replace(/"/g, "'")}"`).join(' ');
    const exe = getPowerShellExe();
    const script = `Start-Process -FilePath '${exe}' -ArgumentList '${commandLine.replace(/'/g, "''")}' -Wait`;
    await new Promise((resolve) => {
      const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
      child.on('error', (err) => {
        log(`could not open the setup window: ${err.message}`);
        resolve();
      });
      child.on('exit', resolve);
    });
  } finally {
    closeSync(fd);
    unlinkSync(lockPath);
  }
}

async function checkAuth(server) {
  const config = loadConfig();
  const values = await readProfile(config);
  const missing = missingKeys(server, config.mode, values);
  const context = `mode '${config.mode}', workspace '${config.workspace}', profile '${config.profile}'`;
  if (missing.length) return { config, values, missing, problem: `missing ${missing.join(', ')} (${context})` };
  const provider = createTokenProvider(config, values);
  const resource = PRIMARY_RESOURCE[server]?.(values);
  if (resource) {
    try {
      await provider.getAccessToken(resource);
    } catch (err) {
      if (err instanceof CredentialError) return { config, values, missing, problem: `${err.message} (${context})` };
      log(`token probe failed, starting anyway: ${err.message}`);
    }
  }
  return { config, values, provider, missing };
}

async function resolveAuth(server) {
  let auth = await checkAuth(server);
  if (auth.problem && !process.env.PP_MCP_NO_SETUP) {
    log(`${server}: ${auth.problem} - opening the auth setup window`);
    await openSetupWindow(auth.config, server, auth.missing, auth.missing.length ? '' : auth.problem);
    auth = await checkAuth(server);
  }
  if (auth.problem) throw new Error(auth.problem);
  return auth;
}

// Credentials rejected while serving (expired secret, revoked refresh token...): reopen the
// setup once, then hot-swap the provider's credentials so the next tool call can succeed.
function recoverCredentials(server, provider) {
  let running = null;
  return (err) => {
    if (running) return;
    running = (async () => {
      log(`${server}: credentials rejected - opening the auth setup window`);
      await openSetupWindow(loadConfig(), server, [], err.message);
      const next = loadConfig();
      provider.reload(next, await readProfile(next));
      log(`${server}: credentials reloaded (mode '${next.mode}')`);
    })()
      .catch((e) => log(`credential recovery failed: ${e.message}`))
      .finally(() => {
        running = null;
      });
  };
}

async function launch(server) {
  if (!SERVERS.includes(server)) throw new Error(`Usage: node launch.mjs <${SERVERS.join('|')}> | --test [server|all]`);
  const adapter = await import(`./servers/${server}.mjs`);
  let auth;
  try {
    if (adapter.needsNodeModules) await ensureNodeModules();
    auth = await resolveAuth(server);
  } catch (err) {
    if (process.env.PP_MCP_NO_SETUP) throw err;
    log(`${server}: ${err.message} - serving the auth-required fallback`);
    serveFallback({
      server,
      problem: err.message,
      runSetup: async () => {
        const current = await checkAuth(server);
        await openSetupWindow(current.config, server, current.missing, current.problem);
        const after = await checkAuth(server);
        return after.problem ? { ok: false, problem: after.problem } : { ok: true };
      },
    });
    return;
  }
  if (!process.env.PP_MCP_NO_SETUP) auth.provider.onCredentialError = recoverCredentials(server, auth.provider);
  log(`${server}: auth mode '${auth.config.mode}', workspace '${auth.config.workspace}', profile '${auth.config.profile}'`);
  await adapter.start(auth);
}

const [command, target] = process.argv.slice(2);
try {
  if (command === '--test') {
    const { runSelfTest } = await import('./core/selftest.mjs');
    process.exitCode = await runSelfTest(target ?? 'all');
  } else {
    await launch(command);
  }
} catch (err) {
  log(err.message);
  process.exit(1);
}
