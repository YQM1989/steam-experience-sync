import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  acquireWorkerLock,
  isWorkerLockActive,
  releaseWorkerLock,
} from '../../src/core/worker-lock.mjs';

test('worker lock prevents a second active worker from starting', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-worker-lock-'));
  const lockFile = path.join(root, 'worker.lock');

  const first = await acquireWorkerLock(lockFile, {
    now: new Date('2026-07-09T00:00:00.000Z'),
  });
  const second = await acquireWorkerLock(lockFile, {
    now: new Date('2026-07-09T00:01:00.000Z'),
  });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);

  await releaseWorkerLock(lockFile);
});

test('worker lock can replace a stale lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-worker-lock-'));
  const lockFile = path.join(root, 'worker.lock');

  await acquireWorkerLock(lockFile, {
    staleMs: 60_000,
    now: new Date('2026-07-09T00:00:00.000Z'),
  });
  const second = await acquireWorkerLock(lockFile, {
    staleMs: 60_000,
    now: new Date('2026-07-09T00:02:01.000Z'),
  });

  assert.equal(second.acquired, true);
  assert.equal(second.stale, true);

  await releaseWorkerLock(lockFile);
});

test('worker lock reports a fresh dead process as inactive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-worker-lock-'));
  const lockFile = path.join(root, 'worker.lock');
  await fs.writeFile(lockFile, JSON.stringify({
    pid: 424242,
    startedAt: '2026-07-09T00:00:00.000Z',
  }));

  const active = await isWorkerLockActive(lockFile, {
    now: new Date('2026-07-09T00:01:00.000Z'),
    isProcessAlive: () => false,
  });

  assert.equal(active, false);
});

test('worker lock immediately replaces a fresh dead process lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-worker-lock-'));
  const lockFile = path.join(root, 'worker.lock');
  await fs.writeFile(lockFile, JSON.stringify({
    pid: 424242,
    startedAt: '2026-07-09T00:00:00.000Z',
  }));

  const result = await acquireWorkerLock(lockFile, {
    now: new Date('2026-07-09T00:01:00.000Z'),
    isProcessAlive: () => false,
  });

  assert.equal(result.acquired, true);
  assert.equal(result.stale, true);

  await releaseWorkerLock(lockFile);
});
