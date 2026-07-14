import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..', '..');

test('--no-adaptive disables rate limiter loading for status output', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-cli-vault-'));

  const { stderr } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', '--worker-status-json', '--no-adaptive'],
    {
      cwd: root,
      env: {
        ...process.env,
        STEAM_ID: '76561198119055866',
        OBSIDIAN_VAULT_DIR: vault,
        STEAM_API_KEY: 'test-key',
      },
    },
  );

  assert.equal(stderr.includes('Rate limiter:'), false);
});

test('--rate-limiter-file points adaptive limiter at a custom state file', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-cli-vault-'));
  const limiterFile = path.join(vault, 'custom-rate-limiter.json');
  await fs.writeFile(
    limiterFile,
    JSON.stringify({
      baseDelayMs: 30000,
      minimumDelayMs: 10000,
      consecutiveSuccesses: 0,
      consecutive429s: 1,
      totalRequests: 2,
      total429s: 1,
      last429At: null,
    }),
  );

  const { stderr } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', '--worker-status-json', '--rate-limiter-file', limiterFile],
    {
      cwd: root,
      env: {
        ...process.env,
        STEAM_ID: '76561198119055866',
        OBSIDIAN_VAULT_DIR: vault,
        STEAM_API_KEY: 'test-key',
        STEAM_REQUEST_DELAY_MS: '10000',
      },
    },
  );

  assert.match(stderr, /Rate limiter: baseDelay=30000ms/);
});

test('--worker-max-detail-scans appears in worker status json', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-cli-vault-'));

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      '--worker-status-json',
      '--worker-max-detail-scans',
      '3',
      '--no-adaptive',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        STEAM_ID: '76561198119055866',
        OBSIDIAN_VAULT_DIR: vault,
        STEAM_API_KEY: 'test-key',
      },
    },
  );

  const status = JSON.parse(stdout);
  assert.equal(status.configuredMaxDetailScans, 3);
});

test('--worker-max-detail-scans cannot disable the worker scan cap', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-cli-vault-'));

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      '--worker-status-json',
      '--worker-max-detail-scans',
      'all',
      '--no-adaptive',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        STEAM_ID: '76561198119055866',
        OBSIDIAN_VAULT_DIR: vault,
        STEAM_API_KEY: 'test-key',
      },
    },
  );

  const status = JSON.parse(stdout);
  assert.equal(status.configuredMaxDetailScans, 3);
});

test('worker status defaults to screenshot feed mode without requiring an appid queue', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-cli-vault-'));

  const { stdout } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', '--worker-status-json', '--no-adaptive'],
    {
      cwd: root,
      env: {
        ...process.env,
        STEAM_ID: '76561198119055866',
        OBSIDIAN_VAULT_DIR: vault,
        STEAM_API_KEY: 'test-key',
        STEAM_WORKER_APPIDS: '',
        STEAM_SYNC_APPIDS: '',
      },
    },
  );

  const status = JSON.parse(stdout);
  assert.equal(status.workerMode, 'feed');
  assert.equal(status.nextAppid, '');
  assert.deepEqual(status.queue, []);
  assert.deepEqual(status.feedProgress, {
    nextPage: 1,
    imported: 0,
    lastMatchedCount: null,
    lastProcessedCount: null,
    lastDetailScannedCount: null,
  });
});

test('worker status reports an active worker lock', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-cli-vault-'));
  const runtimeDir = path.join(vault, '.obsidian', 'steam-experience-sync');
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(
    path.join(runtimeDir, 'worker.lock'),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', '--worker-status-json', '--no-adaptive'],
    {
      cwd: root,
      env: {
        ...process.env,
        STEAM_ID: '76561198119055866',
        OBSIDIAN_VAULT_DIR: vault,
        STEAM_API_KEY: 'test-key',
      },
    },
  );

  const status = JSON.parse(stdout);
  assert.equal(status.workerLockActive, true);
});

test('worker loop delay defaults to 60 seconds for safer Steam community browsing', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-cli-vault-'));

  const { stdout } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', '--worker-status-json', '--no-adaptive'],
    {
      cwd: root,
      env: {
        ...process.env,
        STEAM_ID: '76561198119055866',
        OBSIDIAN_VAULT_DIR: vault,
        STEAM_API_KEY: 'test-key',
        STEAM_WORKER_LOOP_DELAY_MS: '',
      },
    },
  );

  const status = JSON.parse(stdout);
  assert.equal(status.configuredLoopDelayMs, 60000);
});
