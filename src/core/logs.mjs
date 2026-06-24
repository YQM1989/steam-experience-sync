import fsSync from 'node:fs';
import fs from 'node:fs/promises';

export async function readWorkerLog(paths, limit = 120) {
  if (!paths.workerLogFile || !fsSync.existsSync(paths.workerLogFile)) return [];
  const raw = await fs.readFile(paths.workerLogFile, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);
}
