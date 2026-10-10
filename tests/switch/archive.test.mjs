import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { archiveItems, captureFromFilename, scanAlbum, vaultPath } from '../../src/switch/archive.mjs';
import { runSwitchAction } from '../../src/switch/index.mjs';
import { readGuiConfig, writeGuiConfig } from '../../src/core/config-store.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'switch-archive-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  const album = path.join(root, 'Album');
  await fs.mkdir(vault);
  await fs.mkdir(path.join(album, '测试游戏'), { recursive: true });
  const config = { experienceDir: 'Switch', attachmentDir: 'Attachments/Switch', filenameTimezone: '+08:00', games: {} };
  const state = { version: 1, media: {}, games: {} };
  const add = async (name, bytes = name) => fs.writeFile(path.join(album, '测试游戏', name), bytes);
  const run = async (options = {}) => archiveItems({ vault, config, items: (await scanAlbum(album, config)).items, state, saveState: async () => {}, ...options });
  const note = () => fs.readFile(path.join(vault, Object.values(state.games)[0].note), 'utf8');
  return { root, vault, album, config, state, add, run, note };
}

test('dates come from captures and invalid dates are not replaced with import time', () => {
  assert.equal(captureFromFilename('2026100815304500_c.jpg'), '2026-10-08T15:30:45+08:00');
  assert.equal(captureFromFilename('2026023015304500_c.jpg'), null);
  assert.equal(captureFromFilename('my-photo.jpg'), null);
  assert.equal(captureFromFilename('2026100815304500_c.jpg', '+09:00'), '2026-10-08T15:30:45+09:00');
});

test('imports image and video, keeps same-second captures distinct, and is idempotent', async (t) => {
  const f = await fixture(t);
  await f.add('2026100815304500_c.jpg', 'first-image');
  await f.add('2026100815304500_c.mp4', 'first-video');
  assert.equal((await f.run()).imported, 2);
  const before = await f.note();
  assert.match(before, /## 2026-10-08/);
  assert.match(before, /\[!switch-reflection\] 我的感想/);
  assert.match(before, /\.mp4\]\]/);
  assert.equal((await f.run()).duplicates, 2);
  assert.equal(await f.note(), before);
});

test('manual reflections survive new media and later poster changes byte for byte', async (t) => {
  const f = await fixture(t);
  await f.add('2026100715304500_c.jpg');
  await f.run();
  const record = Object.values(f.state.games)[0];
  const noteFile = path.join(f.vault, record.note);
  const reflection = '这一天终于通关了。\n> > **不想被改写的感想**，还有 [[自己的笔记]]。';
  await fs.writeFile(noteFile, (await f.note()).replace('在 Obsidian 里写下这一刻的回忆。', reflection));
  await f.add('2026100815304500_c.mp4');
  await f.run();
  const coverFile = path.join(f.root, 'poster.png');
  await fs.writeFile(coverFile, 'poster-fixture');
  f.config.games[record.id] = { name: '确认后的游戏名', coverFile };
  const result = await f.run();
  assert.equal(result.imported, 0);
  const content = await f.note();
  assert.ok(content.includes(reflection));
  assert.match(content, /cover-[a-f0-9]+\.png/);
  assert.match(content, /game: "确认后的游戏名"/);
  assert.equal((content.match(/%% switch-media:/g) || []).length, 2);
});

test('cloud upload duplicates retain every ID, while identical content at another capture time remains a memory', async (t) => {
  const f = await fixture(t);
  const filename = '2026100815304500_c.jpg';
  await f.add(filename, 'same-capture-bytes');
  const base = (await scanAlbum(f.album, f.config)).items[0];
  const items = [
    { ...base, id: 'nintendo-first', source: 'nintendo_album', uploadedAt: '2026-10-08T08:00:00Z', expiresAt: '2026-11-07T08:00:00Z' },
    { ...base, id: 'nintendo-copy', source: 'nintendo_album', uploadedAt: '2026-10-09T08:00:00Z', expiresAt: '2026-11-08T08:00:00Z' },
    { ...base, id: 'nintendo-another-day', source: 'nintendo_album', capturedAt: '2026-10-09T15:30:45+08:00' },
  ];
  const run = () => archiveItems({ vault: f.vault, config: f.config, items, state: f.state, saveState: async () => {} });
  assert.deepEqual(await run(), { imported: 2, duplicates: 1, stopped: false });
  assert.equal(Object.keys(f.state.media).length, 3);
  assert.equal(f.state.media['nintendo-copy'].duplicateOf, 'nintendo-first');
  assert.equal(f.state.media['nintendo-copy'].uploadedAt, '2026-10-09T08:00:00Z');
  assert.equal(f.state.media['nintendo-copy'].attachment, f.state.media['nintendo-first'].attachment);
  const before = await f.note();
  assert.equal((before.match(/%% switch-media:/g) || []).length, 2);
  assert.match(before, /## 2026-10-09/);
  assert.deepEqual(await run(), { imported: 0, duplicates: 3, stopped: false });
  assert.equal(await f.note(), before);
  await writeGuiConfig(f.root, { vaultDir: f.vault, switch: f.config });
  const stateDir = path.join(f.vault, '.obsidian/switch-experience-sync');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, 'state.json'), JSON.stringify(f.state));
  const status = await runSwitchAction('status', {}, f.root);
  assert.equal(status.imported, 2);
  assert.equal(status.games[0].count, 2);
});

test('appends to the correct existing date, keeping later date content', async (t) => {
  const f = await fixture(t);
  await f.add('2026100715304500_c.jpg');
  await f.add('2026100815304500_c.jpg');
  await f.run();
  await f.add('2026100716304500_c.mp4');
  await f.run();
  const content = await f.note();
  assert.equal(content.split('## 2026-10-07').length, 2);
  assert.ok(content.indexOf('.mp4]]') < content.indexOf('## 2026-10-08'));
});

test('detects edits before replacing a note and does not mark the new item imported', async (t) => {
  const f = await fixture(t);
  await f.add('2026100715304500_c.jpg');
  await f.run();
  await f.add('2026100815304500_c.jpg');
  await assert.rejects(f.run({ beforeWrite: (file) => fs.appendFile(file, '\n正在编辑的用户文字\n') }), /正在被编辑/);
  assert.equal(Object.keys(f.state.media).length, 1);
  assert.match(await f.note(), /正在编辑的用户文字/);
  assert.equal((await f.run()).imported, 1);
});

test('does not overwrite unrelated existing notes with the same game name', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.vault, 'Switch'));
  await fs.writeFile(path.join(f.vault, 'Switch/测试游戏.md'), '我的已有笔记');
  await f.add('2026100815304500_c.jpg');
  await f.run();
  assert.equal(await fs.readFile(path.join(f.vault, 'Switch/测试游戏.md'), 'utf8'), '我的已有笔记');
  assert.notEqual(Object.values(f.state.games)[0].note, 'Switch/测试游戏.md');
});

test('rejects output traversal and output symlinks outside the vault', async (t) => {
  const f = await fixture(t);
  await assert.rejects(vaultPath(f.vault, '../outside'), /不能离开/);
  await fs.symlink(f.root, path.join(f.vault, 'external'));
  await assert.rejects(vaultPath(f.vault, 'external/notes'), /符号链接/);
});

test('reports unrecognised files and skips source symlinks', async (t) => {
  const f = await fixture(t);
  await f.add('no-date.jpg');
  await f.add('2026100815304500_c.jpg');
  await fs.symlink(path.join(f.album, '测试游戏/2026100815304500_c.jpg'), path.join(f.album, '2026100816304500_c.jpg'));
  const scan = await scanAlbum(f.album, f.config);
  assert.equal(scan.items.length, 1);
  assert.equal(scan.skipped.length, 1);
});

test('stop is honoured before importing files', async (t) => {
  const f = await fixture(t);
  await f.add('2026100815304500_c.jpg');
  const result = await f.run({ shouldStop: async () => true });
  assert.equal(result.stopped, true);
  assert.equal(Object.keys(f.state.media).length, 0);
});

test('Switch settings preserve existing Steam settings and do not persist Nintendo tokens', async (t) => {
  const f = await fixture(t);
  await writeGuiConfig(f.root, { steamId: 'steam-existing', steamApiKey: 'fixture-only-key', requestDelayMs: 45000 });
  await runSwitchAction('save-settings', { vaultDir: f.vault, switch: { ...f.config, albumDir: f.album, sessionToken: 'must-not-save' } }, f.root);
  const stored = await readGuiConfig(f.root);
  assert.equal(stored.steamId, 'steam-existing');
  assert.equal(stored.steamApiKey, 'fixture-only-key');
  assert.equal(stored.requestDelayMs, 45000);
  assert.equal(stored.switch.albumDir, f.album);
  assert.equal(stored.switch.sessionToken, undefined);
});

test('controller scans, imports, reports state, and installs only its own stylesheet', async (t) => {
  const f = await fixture(t);
  await f.add('2026100815304500_c.jpg');
  await runSwitchAction('save-settings', { vaultDir: f.vault, switch: { ...f.config, albumDir: f.album } }, f.root);
  assert.equal((await runSwitchAction('preview', {}, f.root)).total, 1);
  assert.equal((await runSwitchAction('sync', {}, f.root)).imported, 1);
  assert.equal((await runSwitchAction('status', {}, f.root)).imported, 1);
  await fs.mkdir(path.join(f.root, 'docs'));
  await fs.writeFile(path.join(f.root, 'docs/obsidian-switch-experience.css'), '/* Game Experience Sync: Switch */\n');
  await runSwitchAction('install-style', {}, f.root);
  const appearance = JSON.parse(await fs.readFile(path.join(f.vault, '.obsidian/appearance.json'), 'utf8'));
  assert.deepEqual(appearance.enabledCssSnippets, ['switch-experience']);
  await fs.writeFile(path.join(f.vault, '.obsidian/snippets/switch-experience.css'), '用户已有样式');
  await assert.rejects(runSwitchAction('install-style', {}, f.root), /未覆盖/);
});
