import fsSync from 'node:fs';
import fs from 'node:fs/promises';

export async function readRuntimeStatus(paths) {
  const state = await readJson(paths.stateFile, {});
  const worker = state.worker || {};
  const queue = Array.isArray(worker.queue) ? worker.queue : [];
  const currentIndex = Number.isInteger(worker.currentIndex) ? worker.currentIndex : 0;
  const nextAppid = queue[currentIndex] || queue[0] || '';

  return {
    vaultConfigured: Boolean(paths.vaultDir),
    stateFile: paths.stateFile,
    workerLogFile: paths.workerLogFile,
    stopFile: paths.stopFile,
    stopRequested: Boolean(paths.stopFile && fsSync.existsSync(paths.stopFile)),
    queue,
    currentIndex,
    nextAppid,
    pages: worker.pages || {},
    lastRunAt: worker.lastRunAt || '',
    cooldownUntil: worker.cooldownUntil || '',
  };
}

async function readJson(filePath, fallback) {
  if (!filePath || !fsSync.existsSync(filePath)) return fallback;
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
