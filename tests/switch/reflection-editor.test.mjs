import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasGameIdentity, mediaCard, appendCard } from '../../src/switch/archive.mjs';
import { migrateReflectionBlocks, reflectionKey } from '../../src/switch/reflection-editor.mjs';

const id = 'nintendo-' + 'a'.repeat(64);
const item = { id, capturedAt: '2026-10-07T12:31:14+08:00', kind: 'image' };
const view = 'Switch/_组件/switch-reflection';
const header = '---\ntype: raw_switch_experience\nplatform: switch\nswitch_game_id: "0100abcd"\n---\n';

test('independent reflection migration preserves hand-written text as Markdown properties and is idempotent', () => {
  const personal = '**我的感想**，还有 [[自己的笔记]]。\n下一段原文。';
  const before = header + mediaCard(item, 'Attachments/photo.jpg').replace('> > 在 Obsidian 里写下这一刻的回忆。', personal.split('\n').map((line) => '> > ' + line).join('\n'));
  const after = migrateReflectionBlocks(before, view);
  assert.ok(after.includes(reflectionKey(id) + ': ' + JSON.stringify(personal)));
  assert.ok(after.includes('await dv.view'));
  assert.ok(after.includes('Attachments/photo.jpg'));
  assert.equal(migrateReflectionBlocks(after, view), after);
  const extended = appendCard(after, { ...item, id: 'nintendo-' + 'b'.repeat(64) }, 'Attachments/new.jpg', view);
  assert.ok(extended.includes(reflectionKey(id) + ': ' + JSON.stringify(personal)));
  assert.equal((extended.match(/await dv.view/g) || []).length, 2);
});

test('generated instructions are not mistaken for personal memories, and conflicting fields are not overwritten', () => {
  const before = header + mediaCard(item, 'Attachments/photo.jpg');
  const after = migrateReflectionBlocks(before, view);
  assert.ok(after.includes(reflectionKey(id) + ': ""'));
  const conflicting = before.replace('---\ntype:', '---\n' + reflectionKey(id) + ': "已有感想"\ntype:').replace('在 Obsidian 里写下这一刻的回忆。', '另一份感想');
  assert.throws(() => migrateReflectionBlocks(conflicting, view), /未自动合并/);
});

test('Obsidian frontmatter quote normalization preserves game identity checks', () => {
  for (const scalar of ['"0100abcd"', "'0100abcd'", '0100abcd']) assert.equal(hasGameIdentity('---\nswitch_game_id: ' + scalar + '\n---', '0100abcd'), true);
  assert.equal(hasGameIdentity('switch_game_id: wrong-game', '0100abcd'), false);
});
