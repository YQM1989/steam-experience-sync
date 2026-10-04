import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { guiConfigPath, readGuiConfig, writeGuiConfig } from '../../src/core/config-store.mjs';

test('packaged app stores config outside readonly resources and reopens it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-mac-config-'));
  const previous = process.env.STEAM_GUI_CONFIG_FILE;
  try {
    const codeRoot = path.join(root, 'Example.app/Contents/Resources/worker');
    const configFile = path.join(root, 'Library/Application Support/Steam Sync/config.json');
    process.env.STEAM_GUI_CONFIG_FILE = configFile;
    await writeGuiConfig(codeRoot, { steamId: '123', steamApiKey: 'test-only', vaultDir: root });
    assert.equal(guiConfigPath(codeRoot), configFile);
    assert.equal((await readGuiConfig(codeRoot)).steamId, '123');
    await assert.rejects(fs.stat(codeRoot), { code: 'ENOENT' });
    if (process.platform !== 'win32') assert.equal((await fs.stat(configFile)).mode & 0o777, 0o600);
  } finally {
    if (previous === undefined) delete process.env.STEAM_GUI_CONFIG_FILE;
    else process.env.STEAM_GUI_CONFIG_FILE = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('config override rejects relative paths and CLI keeps its original location', () => {
  assert.throws(() => guiConfigPath('/example', { STEAM_GUI_CONFIG_FILE: 'config.json' }), /absolute/);
  assert.equal(guiConfigPath('/example', {}), path.join('/example', '.steam-experience-sync/config.json'));
});
