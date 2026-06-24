import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readDiscoveryIndex, writeDiscoveryIndex } from '../../src/core/discovery-store.mjs';

test('discovery index stores games with screenshot ids', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-discovery-'));
  const filePath = path.join(root, 'discovered-games.json');

  await writeDiscoveryIndex(filePath, {
    games: {
      '2358720': {
        appid: '2358720',
        name: 'Black Myth: Wukong',
        screenshotIds: ['3739717708'],
        lastSeenAt: '2024-09-30T01:04:00.000Z',
      },
    },
  });

  const index = await readDiscoveryIndex(filePath);

  assert.equal(index.games['2358720'].name, 'Black Myth: Wukong');
  assert.deepEqual(index.games['2358720'].screenshotIds, ['3739717708']);
});
