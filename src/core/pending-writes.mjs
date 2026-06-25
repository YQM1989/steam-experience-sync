import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readPendingWrites(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return { items: [] };
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function writePendingWrites(filePath, pending) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(pending, null, 2));
}

export async function clearPendingWrites(filePath) {
  if (filePath && fsSync.existsSync(filePath)) {
    await fs.unlink(filePath);
  }
}
