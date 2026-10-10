import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, hasGameIdentity, readJson, vaultPath, writeNote } from './archive.mjs';

const DEFAULT_TEXT = '在 Obsidian 里写下这一刻的回忆。';
export const reflectionKey = (id) => 'switch_reflection_' + id;
export function reflectionBlock(id, view) {
  return `> > [!switch-reflection] 我的感想\n> > \`\`\`dataviewjs\n> > await dv.view(${JSON.stringify(view)}, {mediaId: ${JSON.stringify(id)}});\n> > \`\`\`\n`;
}

export function migrateReflectionBlocks(content, view) {
  const fields = new Map();
  const after = content.replace(/(%% switch-media:((?:nintendo|local)-[a-f0-9]{64}) %%(?:(?!%% switch-media:)[\s\S])*?> > \[!switch-reflection\] 我的感想\n)((?:> >[^\n]*\n)*)/g, (whole, prefix, id, body) => {
    if (body.includes('```dataviewjs')) return whole;
    const value = body.split('\n').filter((line) => line.startsWith('> >')).map((line) => line.replace(/^> > ?/, '')).join('\n');
    const key = reflectionKey(id);
    const fieldPresent = new RegExp('^' + key + ':', 'm').test(content);
    if (fieldPresent && value.trim() && value.trim() !== DEFAULT_TEXT) throw new Error('这条感想已有独立字段和正文内容，未自动合并或覆盖。');
    if (!fieldPresent) fields.set(key, value.trim() === DEFAULT_TEXT ? '' : value);
    return prefix.replace(/> > \[!switch-reflection\] 我的感想\n$/, '') + reflectionBlock(id, view);
  });
  if (!fields.size) return after;
  const match = /^---\n([\s\S]*?)\n---\n/.exec(after);
  if (!match) throw new Error('游戏笔记属性区缺失，未迁移感想。');
  const entries = [...fields].map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  return after.replace(match[0], `---\n${match[1]}\n${entries}\n---\n`);
}

export async function installReflectionView(vault, config, projectRoot) {
  const enabled = await readJson(await vaultPath(vault, '.obsidian/community-plugins.json'), []);
  const settings = await readJson(await vaultPath(vault, '.obsidian/plugins/dataview/data.json'), {});
  if (!enabled.includes('dataview') || settings.enableDataviewJs !== true) return null;
  const view = `${config.experienceDir}/_组件/switch-reflection`;
  const target = await vaultPath(vault, view + '.js');
  const source = await fs.readFile(path.join(projectRoot, 'docs/switch-reflection-view.js'), 'utf8');
  let current;
  try { current = await fs.readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current && !current.startsWith('/* Game Experience Sync: independent Switch reflection editor */')) throw new Error('同名感想编辑组件已存在，未覆盖。');
  if (current !== source) {
    if (current) await fs.copyFile(target, target + '.' + Date.now() + '.bak', 1);
    await atomicWrite(target, source);
  }
  return view;
}

export async function upgradeReflectionNotes(vault, state, view, backupRoot) {
  let count = 0;
  for (const game of Object.values(state.games)) {
    const target = await vaultPath(vault, game.note);
    const before = await fs.readFile(target, 'utf8');
    if (!hasGameIdentity(before, game.id)) throw new Error('游戏标识已修改，未迁移感想。');
    const after = migrateReflectionBlocks(before, view);
    if (after === before) continue;
    const backup = path.join(backupRoot, game.note);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.writeFile(backup, before, { flag: 'wx', mode: 0o600 });
    await writeNote(target, before, after);
    count++;
  }
  return count;
}
