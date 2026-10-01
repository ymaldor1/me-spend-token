#!/usr/bin/env node
// Wrapper so the community `powerplatform-mcp` package (67 tools) can run
// headlessly from .env, matching the auto-auth setup used for our own
// cert-based server. This package's own code hard-requires a client secret —
// it has no certificate/thumbprint auth path (checked its source directly).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTenantId, requireEnv } from './auth.mjs';

const mcpDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(mcpDirectory, 'node_modules', 'powerplatform-mcp', 'build', 'index.js');
const envUrl = requireEnv('PP_ENV_URL');
const clientId = requireEnv('PP_CLIENT_ID');
const clientSecret = requireEnv('PP_CLIENT_SECRET');
const tenantId = process.env.PP_TENANT_ID || (await discoverTenantId(envUrl));

const child = spawn(process.execPath, [serverPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    POWERPLATFORM_ENVIRONMENTS: 'DEV',
    POWERPLATFORM_DEV_URL: envUrl,
    POWERPLATFORM_DEV_CLIENT_ID: clientId,
    POWERPLATFORM_DEV_CLIENT_SECRET: clientSecret,
    POWERPLATFORM_DEV_TENANT_ID: tenantId,
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[pp-mcp] Failed to launch powerplatform-mcp:', err.message);
  process.exit(1);
});
