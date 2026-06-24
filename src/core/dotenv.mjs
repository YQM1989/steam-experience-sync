import fsSync from 'node:fs';
import fs from 'node:fs/promises';

export async function loadDotEnvFile(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return {};
  const raw = await fs.readFile(filePath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}
