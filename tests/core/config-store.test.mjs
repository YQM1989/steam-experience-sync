import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readGuiConfig, writeGuiConfig } from '../../src/core/config-store.mjs';

test('writeGuiConfig stores api key but redacts public view', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-config-'));
  await writeGuiConfig(root, {
    steamId: '76561198119055866',
    steamApiKey: 'secret-key',
    vaultDir: 'D:/YQM-Obsidian',
    speedMode: 'balanced',
    previewMode: 'confirm_each_run',
  });

  const config = await readGuiConfig(root);

  assert.equal(config.steamApiKey, 'secret-key');
  assert.equal(config.publicSteamApiKeyState, 'filled');
});
