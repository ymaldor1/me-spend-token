// Minimal MCP server used when a real server cannot start (auth missing or rejected). It keeps
// the connection alive so the problem and the fix are visible in chat instead of a dead server.
import readline from 'node:readline';

export function serveFallback({ server, problem, runSetup }) {
  let status = problem;
  const tools = [
    {
      name: 'auth_status',
      description: `Explains why the ${server} MCP server is not available (authentication problem) and how to fix it.`,
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'auth_setup',
      description: `Opens the Power Platform MCP auth setup window on the user's desktop and waits until it is closed. Call it only when the user wants to fix or configure authentication.`,
      inputSchema: { type: 'object', properties: {} },
    },
  ];
  const restartHint = `restart the '${server}' server (Command Palette > "MCP: List Servers" > ${server} > Restart)`;
  const help = () =>
    `The '${server}' MCP server is not available: ${status}\n\nTo fix it, call the auth_setup tool (opens a setup window on your desktop) or run \`npm run setup --prefix .vscode/mcp\` in a terminal, then ${restartHint}.`;
  const write = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], isError });

  async function callTool(name) {
    if (name === 'auth_status') return text(help());
    if (name !== 'auth_setup') return null;
    try {
      const outcome = await runSetup();
      if (outcome.ok) {
        status = 'setup completed, restart pending';
        return text(`Setup completed. Now ${restartHint} to load its tools.`);
      }
      status = outcome.problem;
      return text(help(), true);
    } catch (err) {
      return text(`Could not open the setup window: ${err.message}`, true);
    }
  }

  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id === undefined || msg.id === null) return;
    switch (msg.method) {
      case 'initialize':
        return write({
          id: msg.id,
          result: {
            protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: `${server} (auth required)`, version: '1.0.0' },
            instructions: help(),
          },
        });
      case 'ping':
        return write({ id: msg.id, result: {} });
      case 'tools/list':
        return write({ id: msg.id, result: { tools } });
      case 'tools/call': {
        const result = await callTool(msg.params?.name);
        return result
          ? write({ id: msg.id, result })
          : write({ id: msg.id, error: { code: -32602, message: `Unknown tool: ${msg.params?.name}` } });
      }
      default:
        return write({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  });
}
