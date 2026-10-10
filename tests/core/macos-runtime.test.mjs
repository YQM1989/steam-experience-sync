import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareMacRuntime } from '../../scripts/prepare-macos-runtime.mjs';

test('Mac packaging rejects a Windows or Intel runtime', async () => {
  await assert.rejects(prepareMacRuntime({ platform: 'win32', arch: 'arm64' }), /Apple Silicon/);
  await assert.rejects(prepareMacRuntime({ platform: 'darwin', arch: 'x64' }), /Apple Silicon/);
});

test('Mac packaging validates the binary and includes its license, not local secrets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-mac-package-'));
  try {
    const executable = path.join(root, 'fake-node');
    await fs.writeFile(executable, Buffer.alloc(8));
    const options = { root, executable, platform: 'darwin', arch: 'arm64', licenseText: 'Permission is hereby granted' };
    await assert.rejects(prepareMacRuntime(options), /Mach-O/);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    await fs.writeFile(executable, header);
    await fs.writeFile(path.join(root, '.env'), 'STEAM_API_KEY=test-only');
    const destination = await prepareMacRuntime(options);
    assert.deepEqual(await fs.readFile(destination), header);
    assert.deepEqual((await fs.readdir(path.dirname(destination))).sort(), ['NODE-LICENSE', 'steam-node-aarch64-apple-darwin']);
    await assert.rejects(prepareMacRuntime({ ...options, licenseText: 'invalid' }), /license/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Mac bundle only includes explicit code resources and its runtime', async () => {
  const config = JSON.parse(await fs.readFile(new URL('../../src-tauri/tauri.macos.conf.json', import.meta.url)));
  assert.deepEqual(config.bundle.externalBin, ['runtime/steam-node']);
  assert.deepEqual(Object.keys(config.bundle.resources).sort(), [
    '../docs/NXAPI-AGPL-LICENSE.txt', '../docs/THIRD-PARTY-NOTICES-SWITCH.txt', '../docs/obsidian-steam-experience.css', '../docs/obsidian-switch-experience.css',
    '../docs/switch-reflection-view.js',
    '../package.json', '../src/', '../tools/nxapi-client/', 'runtime/NODE-LICENSE',
  ]);
});
