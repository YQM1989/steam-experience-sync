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

test('writeGuiConfig stores worker max detail scans', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-config-'));
  await writeGuiConfig(root, {
    workerMaxDetailScans: 3,
  });

  const config = await readGuiConfig(root);

  assert.equal(config.workerMaxDetailScans, 3);
});

test('readGuiConfig defaults worker mode to screenshot feed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-config-'));

  const config = await readGuiConfig(root);

  assert.equal(config.workerMode, 'feed');
});

test('readGuiConfig defaults to safe Steam community request intervals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-config-'));

  const config = await readGuiConfig(root);

  assert.equal(config.requestDelayMs, 30000);
  assert.equal(config.pageDelayMs, 60000);
  assert.equal(config.workerLoopDelayMs, 60000);
});

test('readGuiConfig migrates old fast intervals to safe floors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-config-'));
  await writeGuiConfig(root, {
    requestDelayMs: 10000,
    pageDelayMs: 15000,
    workerLoopDelayMs: 10000,
  });

  const config = await readGuiConfig(root);

  assert.equal(config.requestDelayMs, 30000);
  assert.equal(config.pageDelayMs, 60000);
  assert.equal(config.workerLoopDelayMs, 60000);
});
