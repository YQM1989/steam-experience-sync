import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeGuiConfig } from './config-schema.mjs';

export function guiConfigPath(projectRoot) {
  return path.join(projectRoot, '.steam-experience-sync', 'config.json');
}

export async function readGuiConfig(projectRoot) {
  const filePath = guiConfigPath(projectRoot);
  if (!fsSync.existsSync(filePath)) {
    return withPublicState(normalizeGuiConfig());
  }
  const raw = await fs.readFile(filePath, 'utf8');
  return withPublicState(normalizeGuiConfig(JSON.parse(raw)));
}

export async function writeGuiConfig(projectRoot, config) {
  const normalized = normalizeGuiConfig(config);
  const filePath = guiConfigPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(normalized, null, 2));
  return withPublicState(normalized);
}

function withPublicState(config) {
  return {
    ...config,
    publicSteamApiKeyState: config.steamApiKey ? 'filled' : 'empty',
  };
}
