import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { bundledAlbumClient, verifyBundledClient } from '../../src/switch/nxapi-client.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'switch-client-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'tools/nxapi-client/node_modules/nxapi');
  await fs.mkdir(path.join(pkg, 'bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/switch'), { recursive: true });
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ version: '1.6.1-next.257+sha.fixture' }));
  await fs.writeFile(path.join(pkg, 'bin/nxapi.js'), '');
  await fs.writeFile(path.join(root, 'src/switch/nxapi-preload.mjs'), '');
  return root;
}
function mockSpawn(run) {
  return (node, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.emit('close', null); return true; };
    let input = '';
    child.stdin.on('data', (data) => { input += data.toString(); });
    child.stdin.on('finish', () => run({ child, input: JSON.parse(input), node, args, options }));
    return child;
  };
}

test('bundled client keeps credentials in pipes/Keychain cache and exposes only media to callers', async (t) => {
  const root = await fixture(t);
  const credentials = { sessionToken: 'SYNTHETIC-SESSION-ONLY' };
  const client = bundledAlbumClient({ thirdPartyConsent: true }, credentials, { projectRoot: root, spawn: mockSpawn(({ child, input, args, options }) => {
    assert.equal(input.sessionToken, credentials.sessionToken);
    assert.equal(JSON.stringify(args).includes(credentials.sessionToken), false);
    assert.equal(JSON.stringify(options.env).includes(credentials.sessionToken), false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.env.NXAPI_DEBUG_FILE, '0');
    child.stdout.write(JSON.stringify({ media: [{ id: 'fixture-media' }] }) + '\n');
    child.stdout.write('__SWITCH_PRIVATE_CACHE__' + JSON.stringify([['NaToken.fixture', { token: 'SYNTHETIC-ACCESS' }]]) + '\n');
    child.emit('close', 0);
  }) });
  assert.deepEqual(await client.listMedia(), [{ id: 'fixture-media' }]);
  assert.equal(client.credentials.nxapiCache[0][1].token, 'SYNTHETIC-ACCESS');
  assert.ok(client.credentials.lastAlbumAt);
  assert.equal(credentials.nxapiCache, undefined);
});

test('service errors and throttling are sanitized and pause further requests', async (t) => {
  const root = await fixture(t);
  let calls = 0;
  const client = bundledAlbumClient({ thirdPartyConsent: true }, { sessionToken: 'SYNTHETIC-SESSION' }, { projectRoot: root, now: () => 1000, spawn: mockSpawn(({ child }) => {
    calls++;
    child.stderr.write('Raw upstream error: NEVER-EXPOSE-THIS-TOKEN\n');
    child.stderr.write('__SWITCH_DIAGNOSTIC__' + JSON.stringify({ stage: '相册认证', status: 429, retryAfterSeconds: 60, code: 'NEVER-EXPOSE-THIS-TOKEN' }) + '\n');
    child.emit('close', 1);
  }) });
  await assert.rejects(client.listMedia(), (error) => error.message.includes('HTTP 429') && !error.message.includes('NEVER-EXPOSE'));
  assert.equal(client.credentials.cooldownUntil, 61000);
  await assert.rejects(client.listMedia(), /冷却/);
  assert.equal(calls, 1);
});

test('consent, stop, and missing helper prevent unintended account requests', async (t) => {
  const root = await fixture(t);
  let calls = 0;
  const spawn = () => { calls++; throw new Error('unexpected'); };
  await assert.rejects(bundledAlbumClient({}, { sessionToken: 'fixture' }, { projectRoot: root, spawn }).listMedia(), /同意/);
  assert.deepEqual(await bundledAlbumClient({ thirdPartyConsent: true }, { sessionToken: 'fixture' }, { projectRoot: root, spawn }).listMedia({ shouldStop: async () => true }), []);
  await fs.unlink(path.join(root, 'tools/nxapi-client/node_modules/nxapi/bin/nxapi.js'));
  await assert.rejects(verifyBundledClient(root), /缺失/);
  assert.equal(calls, 0);
});

test('hanging background client is terminated without returning or logging raw output', async (t) => {
  const root = await fixture(t);
  const client = bundledAlbumClient({ thirdPartyConsent: true }, { sessionToken: 'fixture' }, { projectRoot: root, timeoutMs: 10, spawn: mockSpawn(() => {}) });
  await assert.rejects(client.listMedia(), /读取超时/);
});
