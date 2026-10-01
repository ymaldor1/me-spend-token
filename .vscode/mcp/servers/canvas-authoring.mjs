// Microsoft Canvas Authoring MCP (.NET, `dnx`). It signs in with its own MSAL public
// client (DPAPI-encrypted cache) and exposes no token injection point, so only delegated
// sign-in is possible. This adapter proxies stdio and pre-fills `connect` with the
// profile's user + tenant when the caller did not pass them.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const PACKAGE = 'Microsoft.PowerApps.CanvasAuthoring.McpServer@1.1.5';

function withDefaults(message, values) {
  if (message?.method !== 'tools/call' || message.params?.name !== 'connect') return message;
  const args = (message.params.arguments ??= {});
  if (!args.login_hint && values.Username) args.login_hint = values.Username;
  if (!args.tenant_id && values.TenantId) args.tenant_id = values.TenantId;
  return message;
}

export function rewrite(line, values) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  const out = Array.isArray(parsed) ? parsed.map((m) => withDefaults(m, values)) : withDefaults(parsed, values);
  return JSON.stringify(out);
}

export async function start({ config, values }) {
  if (config.mode !== 'oauth') {
    console.error(
      `[pp-mcp] canvas-authoring: auth mode '${config.mode}' is not supported by this server (coauthoring is user-bound). Using delegated sign-in as ${values.Username}.`
    );
  }
  const child = spawn('dotnet', ['dnx', PACKAGE, '--yes'], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  child.on('error', (err) => {
    console.error(`[pp-mcp] canvas-authoring: failed to start dotnet dnx (${err.message}). The .NET 10 SDK is required.`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.stdin.on('error', () => {});

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => child.stdin.write(`${line.trim() ? rewrite(line, values) : line}\n`));
  rl.on('close', () => child.stdin.end());
}
