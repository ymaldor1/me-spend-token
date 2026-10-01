#!/usr/bin/env node
// Adapter for power-platform MCP server

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mcpRoot = path.dirname(fileURLToPath(import.meta.url + '/..'));

export const needsNodeModules = true;

export async function start({ config, values, provider }) {
  // Set up environment variables for powerplatform-mcp server
  const env = {
    ...process.env,
    POWERPLATFORM_ENVIRONMENTS: 'Default',
    POWERPLATFORM_Default_URL: values.EnvironmentUrl,
    POWERPLATFORM_Default_CLIENT_ID: values.AppClientId,
    POWERPLATFORM_Default_TENANT_ID: values.TenantId,
  };

  // Add secret or certificate to environment based on auth mode
  if (config.mode === 'secret' && values.ClientSecret) {
    env.POWERPLATFORM_Default_CLIENT_SECRET = values.ClientSecret;
  } else if (config.mode === 'cert' && values.CertThumbprint) {
    env.POWERPLATFORM_Default_CERT_THUMBPRINT = values.CertThumbprint;
  }

  const serverPath = path.join(mcpRoot, 'node_modules', 'powerplatform-mcp', 'build', 'index.js');
  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
    env,
  });

  child.on('error', (err) => {
    console.error(`[pp-mcp] power-platform: failed to start server (${err.message})`);
    process.exit(1);
  });

  child.on('exit', (code) => process.exit(code ?? 0));
  child.stdin.on('error', () => {});

  // Proxy stdin to the child process
  process.stdin.pipe(child.stdin);
}
