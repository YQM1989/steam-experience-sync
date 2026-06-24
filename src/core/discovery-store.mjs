import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readDiscoveryIndex(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return { games: {} };
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function writeDiscoveryIndex(filePath, index) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2));
}

export function upsertDiscoveredScreenshot(index, screenshot) {
  const appid = String(screenshot.appid || '');
  if (!appid) return index;
  const existing = index.games[appid] || {
    appid,
    name: screenshot.game || '',
    screenshotIds: [],
    lastSeenAt: '',
  };
  const ids = new Set(existing.screenshotIds);
  ids.add(String(screenshot.id));
  index.games[appid] = {
    ...existing,
    name: screenshot.game || existing.name,
    screenshotIds: [...ids],
    lastSeenAt: screenshot.postedAt || existing.lastSeenAt,
  };
  return index;
}
