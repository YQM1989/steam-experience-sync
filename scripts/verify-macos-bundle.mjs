import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('Bundle verification must run on macOS.');
const app = path.resolve(process.argv[2] || 'src-tauri/target/release/bundle/macos/Steam Experience Sync.app');
const worker = path.join(app, 'Contents/Resources/worker');
const node = path.join(app, 'Contents/MacOS/steam-node');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-bundle-check-'));
try {
  const configFile = path.join(temporary, 'Application Support', 'config.json');
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: temporary,
    TMPDIR: temporary,
    STEAM_GUI_CONFIG_FILE: configFile,
  };
  function run(args) {
    const result = spawnSync(node, args, { cwd: worker, env, encoding: 'utf8', timeout: 30000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const architecture = run(['-p', 'process.arch']);
  assert.equal(architecture, 'arm64');
  for (const item of ['.env', '.steam-experience-sync', 'node_modules']) {
    await assert.rejects(fs.stat(path.join(worker, item)), { code: 'ENOENT' });
  }
  assert.ok((await fs.readFile(path.join(worker, 'NODE-LICENSE'), 'utf8')).includes('Permission is hereby granted'));
  const config = { steamId: '76561198000000000', vaultDir: temporary, requestDelayMs: 30000 };
  run(['-e', `import('./src/core/config-store.mjs').then(m => m.writeGuiConfig(process.cwd(), ${JSON.stringify(config)})).catch(e => {console.error(e.message); process.exit(1)})`]);
  const stored = JSON.parse(run(['-e', "import('./src/core/config-store.mjs').then(async m => console.log(JSON.stringify(await m.readGuiConfig(process.cwd()))))"]));
  assert.equal(stored.vaultDir, temporary);
  assert.equal((await fs.stat(configFile)).mode & 0o777, 0o600);
  // Runtime config is passed by Rust in the same way as this offline check.
  env.STEAM_ID = stored.steamId;
  env.OBSIDIAN_VAULT_DIR = stored.vaultDir;
  env.STEAM_REQUEST_DELAY_MS = String(stored.requestDelayMs);
  const configuredStatus = JSON.parse(run(['src/index.mjs', '--worker-status-json', '--no-adaptive']));
  assert.equal(configuredStatus.configuredLoopDelayMs, 60000);
  console.log('Bundled arm64 Node, config save/reopen and offline worker status verified without system Node or Steam requests.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
