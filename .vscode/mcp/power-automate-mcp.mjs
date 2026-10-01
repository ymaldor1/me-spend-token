#!/usr/bin/env node

import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(repoRoot, 'power-automate-server.mjs');
const bundleSourceUrl = 'https://raw.githubusercontent.com/microsoft/power-platform-skills/main/plugins/power-automate/server/mcp.mjs';

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function findBundledServer(startDir) {
  const stack = [startDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries;

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.name === 'mcp.mjs' && currentDir.includes(`${path.sep}power-automate${path.sep}`)) {
        return fullPath;
      }
    }
  }

  return null;
}

function resolveServerPath() {
  const localCopies = [
    path.join(repoRoot, '.temp', 'power-platform-skills', 'plugins', 'power-automate', 'server', 'mcp.mjs'),
    path.join(repoRoot, 'power-platform-skills', 'plugins', 'power-automate', 'server', 'mcp.mjs'),
  ];

  for (const candidate of localCopies) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  const installedPluginsRoot = path.join(os.homedir(), '.copilot', 'installed-plugins');
  const installedCopy = exists(installedPluginsRoot) ? findBundledServer(installedPluginsRoot) : null;
  if (installedCopy) {
    return installedCopy;
  }

  return null;
}

function downloadBundle(targetPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(targetPath);
    const request = https.get(bundleSourceUrl, (response) => {
      if (response.statusCode !== 200) {
        file.close(() => fs.unlink(targetPath, () => {}));
        reject(new Error(`Failed to fetch bundle: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }

      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    });

    request.on('error', (error) => {
      file.close(() => fs.unlink(targetPath, () => {}));
      reject(error);
    });

    file.on('error', (error) => {
      request.destroy(error);
      reject(error);
    });
  });
}

async function ensureBundle() {
  if (fs.existsSync(bundlePath)) {
    return bundlePath;
  }

  try {
    await downloadBundle(bundlePath);
    return bundlePath;
  } catch (error) {
    throw new Error(
      `${error.message}. Install or fetch the Power Automate plugin bundle first, then place it at ${bundlePath} or under power-platform-skills/plugins/power-automate/server/mcp.mjs.`
    );
  }
}

const serverPath = resolveServerPath();
const effectivePath = serverPath || await ensureBundle();
await import(pathToFileURL(effectivePath).href);