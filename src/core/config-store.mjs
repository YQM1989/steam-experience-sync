import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeGuiConfig } from './config-schema.mjs';

export function guiConfigPath(projectRoot, env = process.env) {
  if (env.STEAM_GUI_CONFIG_FILE) {
    if (!path.isAbsolute(env.STEAM_GUI_CONFIG_FILE)) {
      throw new Error('STEAM_GUI_CONFIG_FILE must be an absolute path.');
    }
    return env.STEAM_GUI_CONFIG_FILE;
  }
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
  await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') await fs.chmod(filePath, 0o600);
  return withPublicState(normalized);
}

function withPublicState(config) {
  return {
    ...config,
    publicSteamApiKeyState: config.steamApiKey ? 'filled' : 'empty',
  };
}
