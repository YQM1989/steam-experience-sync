import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readPendingWrites, writePendingWrites } from '../../src/core/pending-writes.mjs';

test('pending writes persist target path and screenshot captions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-pending-'));
  const filePath = path.join(root, 'pending-writes.json');
  await writePendingWrites(filePath, {
    items: [
      {
        id: '3739717708',
        appid: '2358720',
        game: 'Black Myth: Wukong',
        targetFile: 'Steam体验记录/Black Myth_ Wukong.md',
        caption: '沙大郎？傻大郎！',
      },
    ],
  });

  const pending = await readPendingWrites(filePath);

  assert.equal(pending.items[0].game, 'Black Myth: Wukong');
  assert.equal(pending.items[0].caption, '沙大郎？傻大郎！');
});
