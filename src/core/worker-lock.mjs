import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_STALE_MS = 60 * 60 * 1000;

export async function acquireWorkerLock(lockFile, options = {}) {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now ?? new Date();
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: now.toISOString(),
  });

  try {
    await writeNewLock(lockFile, payload);
    return { acquired: true, stale: false };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const existing = await readLock(lockFile);
  if (await isActive(existing, now, staleMs, isProcessAlive)) {
    return { acquired: false, stale: false, existing };
  }

  await fs.unlink(lockFile).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await writeNewLock(lockFile, payload);
  return { acquired: true, stale: true, existing };
}

export async function isWorkerLockActive(lockFile, options = {}) {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now ?? new Date();
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const existing = await readLock(lockFile);

  return isActive(existing, now, staleMs, isProcessAlive);
}

export async function releaseWorkerLock(lockFile) {
  await fs.unlink(lockFile).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function writeNewLock(lockFile, payload) {
  const handle = await fs.open(lockFile, 'wx');
  try {
    await handle.writeFile(payload);
  } finally {
    await handle.close();
  }
}

async function readLock(lockFile) {
  try {
    return JSON.parse(await fs.readFile(lockFile, 'utf8'));
  } catch {
    return {};
  }
}

function isStale(lock, now, staleMs) {
  const startedAt = Date.parse(lock?.startedAt || '');
  if (!Number.isFinite(startedAt)) return true;
  return now.getTime() - startedAt > staleMs;
}

async function isActive(lock, now, staleMs, isProcessAlive) {
  if (isStale(lock, now, staleMs)) return false;
  return Boolean(await isProcessAlive(lock?.pid));
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
