import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { accountClient, beginNintendoLogin, clientCompatibility, normaliseAccountMedia, persistentCredentials, validateCallback, validateMediaUrl } from '../../src/switch/account.mjs';
import { runSwitchAction } from '../../src/switch/index.mjs';
import { writeGuiConfig } from '../../src/core/config-store.mjs';

const config = { thirdPartyConsent: true, nxapiClientId: 'fixture-client', nxapiClientVersion: 'fixture-compat' };
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const rawMedia = (id, type = 'image') => ({ id, appName: '测试游戏', titleId: '0100abcd12345678', type, capturedAt: 1791511800, uploadedAt: 1791511900, expiresAt: 1794103800, contentUri: 'https://example.nintendo.net/test.jpg', contentLength: 10 });

test('OAuth state, PKCE, expiry and exact redirect are validated', () => {
  const pending = beginNintendoLogin(1000);
  const url = new URL(pending.url);
  assert.equal(url.origin, 'https://accounts.nintendo.com');
  assert.equal(url.searchParams.get('session_token_code_challenge_method'), 'S256');
  assert.notEqual(url.searchParams.get('session_token_code_challenge'), pending.verifier);
  const callback = `npf71b963c1b7b6d119://auth#state=${pending.state}&session_token_code=fixture-code`;
  assert.equal(validateCallback(callback, pending, 2000), 'fixture-code');
  assert.throws(() => validateCallback(callback.replace(pending.state, 'other'), pending, 2000), /不属于/);
  assert.throws(() => validateCallback(callback, pending, 400000), /过期/);
  assert.throws(() => validateCallback(callback.replace('://auth', '://auth.evil'), pending, 2000), /授权完成/);
});

test('no account requests occur before explicit service consent and own client identity', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('must not call'); };
  await assert.rejects(accountClient({ ...config, thirdPartyConsent: false }, {}, { fetch: request }).listMedia(), /同意/);
  await assert.rejects(accountClient({ ...config, nxapiClientId: '' }, {}, { fetch: request }).listMedia(), /客户端/);
  assert.throws(() => accountClient({ ...config, nxapiClientVersion: 'unsafe\nheader' }, {}, { fetch: request }), /兼容/);
  assert.equal(calls, 0);
});

test('service discovery cannot treat the legacy header as completed compatibility setup', async () => {
  const requests = [];
  const client = accountClient({ ...config, nxapiClientVersion: '' }, {}, { fetch: async (url, init) => {
    requests.push([url, init]);
    if (url.endsWith('/api/oauth/token')) return reply({ access_token: 'fixture-transient', expires_in: 300 });
    if (url.endsWith('/config')) return reply({ nso_version: '3.5.0' });
    throw new Error('Nintendo requests must not occur');
  } });
  assert.equal(clientCompatibility({}), '');
  await assert.rejects(client.checkService(), /缺少.*服务签发.*无需重新登录/);
  assert.equal(requests.length, 2);
  assert.equal(requests[1][1].headers['X-znca-Client-Version'], '3.0.3');
  assert.equal(requests[0][1].body.includes('scope=ca%3Agf+ca%3Aer+ca%3Adr'), true);
  assert.equal(persistentCredentials(client.credentials).nxToken, undefined);
});

test('missing or version-number compatibility values never reach Nintendo or f-generation', async () => {
  for (const value of ['', '3.0.3', '3.5.0']) {
    let calls = 0;
    const credentials = { sessionToken: 'fixture-session', version: '3.5.0', versionExpiresAt: Date.now() + 60000 };
    const client = accountClient({ ...config, nxapiClientVersion: value }, credentials, { fetch: async () => { calls++; throw new Error('must not call'); } });
    await assert.rejects(client.listMedia(), /兼容标识/);
    assert.equal(calls, 0);
    assert.equal(client.credentials.sessionToken, 'fixture-session');
  }
});

test('newer service versions do not silently change the implemented Coral protocol', async () => {
  const headers = [];
  const client = accountClient(config, {}, { fetch: async (url, init) => {
    headers.push(init.headers);
    if (url.endsWith('/api/oauth/token')) return reply({ access_token: 'fixture-transient', expires_in: 300 });
    return reply({ nso_version: '3.6.0', versions: [{ platform: 'Android', version: '3.6.0' }, { platform: 'Android', version: '3.5.0' }] });
  } });
  assert.equal((await client.checkService()).ok, true);
  assert.equal(client.credentials.version, '3.5.0');
  assert.equal(headers[1]['X-znca-Client-Version'], 'fixture-compat');
});

test('manual service check refreshes configuration even when the previous version is cached', async () => {
  const requests = [];
  const client = accountClient(config, { version: '3.5.0', versionExpiresAt: Date.now() + 60000 }, { fetch: async (url) => {
    requests.push(url);
    if (url.endsWith('/api/oauth/token')) return reply({ access_token: 'fixture-transient', expires_in: 300 });
    return reply({ nso_version: '3.5.0' });
  } });
  assert.equal((await client.checkService()).ok, true);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].endsWith('/config'));
});

test('unsupported service configuration stops before Nintendo exchange and retains the session', async () => {
  const requests = [];
  const client = accountClient(config, { sessionToken: 'fixture-session' }, { fetch: async (url) => {
    requests.push(url);
    if (url.endsWith('/api/oauth/token')) return reply({ access_token: 'fixture-transient', expires_in: 300 });
    if (url.endsWith('/config')) return reply({ nso_version: '3.6.0', versions: [{ platform: 'Android', version: '3.6.0' }] });
    throw new Error('Nintendo must not be contacted');
  } });
  await assert.rejects(client.listMedia(), /未提供.*3\.5\.0/);
  assert.equal(requests.length, 2);
  assert.equal(client.credentials.sessionToken, 'fixture-session');
});

test('mocked account chain exchanges login, encrypts/decrypts album and keeps nxapi token transient', async () => {
  const requests = [];
  let decrypted = 0;
  const request = async (url, init) => {
    requests.push([url, init]);
    if (url.endsWith('/api/session_token')) return reply({ session_token: 'fixture-session' });
    if (url.endsWith('/api/oauth/token')) return reply({ access_token: 'fixture-nxapi', expires_in: 300 });
    if (url.endsWith('/config')) return reply({ nso_version: '3.5.0' });
    if (url.endsWith('/api/token')) return reply({ id_token: 'fixture-id', access_token: 'fixture-na', expires_in: 900 });
    if (url.endsWith('/users/me')) return reply({ id: 'fixture-user', birthday: '2000-01-01', country: 'JP', language: 'ja-JP' });
    if (url.endsWith('/f')) return reply({ encrypted_token_request: Buffer.from('fixture-login').toString('base64') });
    if (url.endsWith('/Account/Login') || url.endsWith('/Media/List')) return reply('fixture-encrypted');
    if (url.endsWith('/encrypt-request')) return reply({ data: Buffer.from('fixture-list').toString('base64') });
    if (url.endsWith('/decrypt-response')) {
      assert.equal(init.headers.Accept, 'text/plain');
      return reply({ status: 0, result: decrypted++ === 0 ? { webApiServerCredential: { accessToken: 'fixture-coral', expiresIn: 7200 } } : { media: [rawMedia('shot')] } });
    }
    throw new Error('unexpected endpoint');
  };
  const pending = beginNintendoLogin();
  const client = accountClient(config, {}, { fetch: request });
  await client.completeLogin(`npf71b963c1b7b6d119://auth#state=${pending.state}&session_token_code=fixture-code`, pending);
  assert.equal((await client.listMedia()).length, 1);
  const znca = requests.filter(([url]) => url.includes('/api/znca/'));
  assert.ok(znca.every(([, init]) => init.headers['X-znca-Client-Version'] === 'fixture-compat'));
  assert.equal(requests.filter(([url]) => url.endsWith('/api/oauth/token')).length, 1);
  assert.equal(persistentCredentials(client.credentials).nxToken, undefined);
  assert.equal(persistentCredentials(client.credentials).sessionToken, 'fixture-session');
});

test('HTTP limits persist cooldown, stop further requests, and do not expose response tokens', async () => {
  let calls = 0;
  const client = accountClient(config, { sessionToken: 'fixture-session' }, { now: () => 1000, fetch: async () => { calls++; return reply({ secret: 'DO-NOT-EXPOSE' }, 429, { 'retry-after': '60' }); } });
  await assert.rejects(client.listMedia(), /限流/);
  assert.equal(client.credentials.cooldownUntil, 61000);
  await assert.rejects(client.listMedia(), /冷却/);
  assert.equal(calls, 1);
  const rejected = accountClient(config, {}, { fetch: async () => reply('DO-NOT-EXPOSE', 403) });
  await assert.rejects(rejected.listMedia(), (error) => error.message.includes('HTTP 403') && !error.message.includes('DO-NOT-EXPOSE'));
});

test('invalid Coral responses and missing media arrays are errors rather than empty albums', async () => {
  const credentials = { sessionToken: 'fixture-session', version: '3.5.0', versionExpiresAt: Date.now() + 60000, coralToken: 'fixture-coral', coralExpiresAt: Date.now() + 60000 };
  for (const body of [{ status: 999, result: {} }, { status: 0, result: {} }]) {
    const client = accountClient(config, credentials, { fetch: async (url) => url.endsWith('/api/oauth/token') ? reply({ access_token: 'fixture-nx', expires_in: 300 }) : url.endsWith('/encrypt-request') ? reply({ data: 'eA==' }) : url.endsWith('/Media/List') ? reply('encrypted') : reply(body) });
    await assert.rejects(client.listMedia(), /拒绝|缺少媒体/);
  }
});

test('account IDs and capture timestamps are stable; unsafe URLs and incomplete metadata are rejected', () => {
  const items = normaliseAccountMedia([rawMedia('shot'), rawMedia('video', 'video')]);
  assert.notEqual(items[0].id, items[1].id);
  assert.match(items[0].capturedAt, /\+08:00$/);
  assert.equal(Date.parse(items[0].capturedAt), rawMedia('shot').capturedAt * 1000);
  assert.equal(items[0].source, 'nintendo_album');
  assert.throws(() => normaliseAccountMedia([{ ...rawMedia('x'), capturedAt: 0 }]), /缺少/);
  for (const url of ['http://example.nintendo.net/file', 'https://nintendo.net.evil/file', 'https://user:secret@example.nintendo.net/file', 'https://localhost/file']) assert.throws(() => validateMediaUrl(url), /允许/);
});

test('mock album to Obsidian pipeline preserves reflections, dedupes downloads, and cleans staging', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'switch-account-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault'); await fs.mkdir(vault);
  await writeGuiConfig(root, { vaultDir: vault, steamId: 'preserved', switch: { ...config, source: 'account', experienceDir: 'Switch', attachmentDir: 'Assets', filenameTimezone: '+08:00', games: {} } });
  const media = [rawMedia('shot'), rawMedia('video', 'video')];
  const credentials = { sessionToken: 'fixture-session' };
  let downloads = 0;
  const options = {
    credentials,
    accountClient: (_config, saved) => ({ credentials: saved, listMedia: async () => media }),
    downloadMedia: async (item, staging) => {
      downloads++; await fs.mkdir(staging, { recursive: true });
      const sourceFile = path.join(staging, item.id + (item.kind === 'video' ? '.mp4' : '.jpg'));
      await fs.writeFile(sourceFile, item.id);
      const { hashFile } = await import('../../src/switch/archive.mjs');
      return { sourceFile, hash: await hashFile(sourceFile) };
    },
  };
  assert.equal((await runSwitchAction('preview', {}, root, options)).total, 2);
  assert.equal(downloads, 0);
  assert.equal((await runSwitchAction('sync', {}, root, options)).imported, 2);
  const stateFile = path.join(vault, '.obsidian/switch-experience-sync/state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  const noteFile = path.join(vault, Object.values(state.games)[0].note);
  const reflection = '我的 Switch 通关回忆，绝不能被覆盖。';
  await fs.writeFile(noteFile, (await fs.readFile(noteFile, 'utf8')).replace('在 Obsidian 里写下这一刻的回忆。', reflection));
  const before = await fs.readFile(noteFile, 'utf8');
  assert.equal((await runSwitchAction('sync', {}, root, options)).duplicates, 2);
  assert.equal(downloads, 2);
  assert.equal(await fs.readFile(noteFile, 'utf8'), before);
  assert.deepEqual(await fs.readdir(path.join(vault, '.obsidian/switch-experience-sync/downloads')), []);
  assert.equal(Object.values(state.media)[0].source, 'nintendo_album');
  assert.equal(JSON.stringify(state).includes('fixture-session'), false);
  media.push({ ...rawMedia('new-shot'), capturedAt: media[0].capturedAt + 3600 });
  const added = await runSwitchAction('sync', {}, root, options);
  assert.equal(added.imported, 1);
  assert.equal(added.duplicates, 2);
  assert.equal(downloads, 3);
  const afterNewMedia = await fs.readFile(noteFile, 'utf8');
  assert.ok(afterNewMedia.includes(reflection));
  assert.equal((afterNewMedia.match(/%% switch-media:/g) || []).length, 3);
  await runSwitchAction('disconnect', {}, root, options);
  assert.deepEqual(credentials, {});
  assert.equal(await fs.readFile(noteFile, 'utf8'), afterNewMedia);
});

test('bounded downloader supports Node DNS lookup forms, rejects invalid downloads and cleans partial files', async (t) => {
  const { downloadMedia } = await import('../../src/switch/account.mjs');
  const { EventEmitter } = await import('node:events');
  const { Readable } = await import('node:stream');
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'switch-download-test-'));
  t.after(() => fs.rm(staging, { recursive: true, force: true }));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const item = { id: 'nintendo-fixture', kind: 'image', contentUri: 'https://example.nintendo.net/file', contentLength: jpeg.length };
  const network = (bytes, statusCode = 200, allAddresses = false) => ({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    get: (_url, init, callback) => {
      const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = () => {};
      init.lookup('example.nintendo.net', { all: allAddresses }, (error, address, family) => {
        assert.equal(error, null);
        if (allAddresses) assert.deepEqual(address, [{ address: '8.8.8.8', family: 4 }]);
        else { assert.equal(address, '8.8.8.8'); assert.equal(family, 4); }
      });
      const response = Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]); response.statusCode = statusCode;
      queueMicrotask(() => callback(response)); return request;
    },
  });
  const good = await downloadMedia(item, staging, async () => false, network(jpeg));
  assert.deepEqual(await fs.readFile(good.sourceFile), jpeg);
  await fs.unlink(good.sourceFile);
  const goodAll = await downloadMedia(item, staging, async () => false, network(jpeg, 200, true));
  assert.deepEqual(await fs.readFile(goodAll.sourceFile), jpeg);
  await fs.unlink(goodAll.sourceFile);
  await assert.rejects(downloadMedia(item, staging, async () => false, network(jpeg.subarray(0, 5))), /不完整/);
  await assert.rejects(downloadMedia(item, staging, async () => false, network(Buffer.alloc(8))), /格式/);
  await assert.rejects(downloadMedia(item, staging, async () => false, network(jpeg, 302)), /重定向/);
  await assert.rejects(downloadMedia(item, staging, async () => true, network(jpeg)), /停止/);
  await assert.rejects(downloadMedia(item, staging, async () => false, { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }), /公网/);
  assert.deepEqual(await fs.readdir(staging), []);
});

test('HTTP diagnostics identify the failing stage without exposing error bodies or credentials', async () => {
  const credentials = { sessionToken: 'fixture-session', idToken: 'fixture-id', profile: { id: 'fixture-user', birthday: '2000-01-01', country: 'JP' }, nintendoExpiresAt: Date.now() + 60000, version: '3.5.0', versionExpiresAt: Date.now() + 60000 };
  const client = accountClient(config, credentials, { fetch: async (url) => {
    if (url.endsWith('/api/oauth/token')) return reply({ access_token: 'fixture-nx', expires_in: 300 });
    return reply({ error: 'incompatible_client', error_description: 'DO-NOT-EXPOSE fixture-id', token: 'DO-NOT-EXPOSE' }, 400);
  } });
  await assert.rejects(client.listMedia(), (error) => error.message.includes('nxapi 相册登录认证参数') && error.message.includes('incompatible_client') && !error.message.includes('DO-NOT-EXPOSE'));
  assert.equal(client.credentials.lastAuthError.stage, 'nxapi 相册登录认证参数');
  assert.equal(client.credentials.lastAuthError.status, 400);
  assert.equal(JSON.stringify(client.credentials.lastAuthError).includes('fixture-id'), false);
});

test('status distinguishes Nintendo session approval from completed album authentication', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'switch-status-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const partial = await runSwitchAction('account-status', {}, root, { credentials: { sessionToken: 'fixture-session' } });
  assert.equal(partial.sessionAuthorised, true);
  assert.equal(partial.connected, false);
  const complete = await runSwitchAction('account-status', {}, root, { credentials: { sessionToken: 'fixture-session', coralToken: 'fixture-coral' } });
  assert.equal(complete.connected, true);
  assert.equal(JSON.stringify(partial).includes('fixture-session'), false);
});
