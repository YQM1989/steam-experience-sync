import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveRuntimePaths } from '../../src/core/paths.mjs';
import { readRuntimeStatus } from '../../src/core/status.mjs';

test('readRuntimeStatus reports stop file and state progress', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-'));
  const vault = path.join(root, 'vault');
  await fs.mkdir(path.join(vault, '.obsidian', 'steam-experience-sync'), { recursive: true });
  await fs.writeFile(
    path.join(vault, '.obsidian', 'steam-experience-sync', 'state.json'),
    JSON.stringify({
      worker: {
        queue: ['2758000'],
        currentIndex: 0,
        pages: { '2758000': { nextPage: 4 } },
        lastRunAt: '2026-06-22T13:47:04.000Z',
      },
    }),
  );
  await fs.writeFile(path.join(vault, '.obsidian', 'steam-experience-sync', 'stop-worker'), '');

  const paths = resolveRuntimePaths(root, {
    OBSIDIAN_VAULT_DIR: vault,
    STEAM_SYNC_STATE: '.obsidian/steam-experience-sync/state.json',
    STEAM_WORKER_LOG: '.obsidian/steam-experience-sync/worker.log',
    STEAM_WORKER_STOP_FILE: '.obsidian/steam-experience-sync/stop-worker',
  });

  const status = await readRuntimeStatus(paths);

  assert.equal(status.stopRequested, true);
  assert.equal(status.nextAppid, '2758000');
  assert.equal(status.pages['2758000'].nextPage, 4);
});
