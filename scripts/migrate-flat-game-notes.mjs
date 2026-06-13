import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/migrate-flat-game-notes.mjs <Steam体验记录目录>');
  process.exit(1);
}

const entries = await fs.readdir(root, { withFileTypes: true });
const gameDirs = entries
  .filter((entry) => entry.isDirectory())
  .filter((entry) => !entry.name.startsWith('_') && !/^\d{4}$/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

for (const gameDir of gameDirs) {
  const sourceDir = path.join(root, gameDir.name);
  const files = (await findMarkdownFiles(sourceDir)).sort();
  if (files.length === 0) continue;

  const sections = [];
  let header = '';
  const seenIds = new Set();

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    if (!header) header = extractHeader(content);
    for (const section of extractDateSections(content)) {
      const freshSection = filterDuplicateBlocks(section, seenIds);
      if (freshSection.trim()) sections.push(freshSection.trimEnd());
    }
  }

  const target = path.join(root, `${gameDir.name}.md`);
  const nextContent = `${header.trimEnd()}\n\n${sections.join('\n\n')}\n`;
  await fs.writeFile(target, nextContent, 'utf8');
  console.log(`Migrated ${files.length} file(s): ${target}`);
}

async function findMarkdownFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await findMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(fullPath);
  }
  return out;
}

function extractHeader(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n\n[\s\S]*?(?=\n## \d{4}-\d{2}-\d{2}\n)/);
  return match ? match[0] : content;
}

function extractDateSections(content) {
  const matches = content.matchAll(/\n(## \d{4}-\d{2}-\d{2}\n[\s\S]*?)(?=\n## \d{4}-\d{2}-\d{2}\n|$)/g);
  return [...matches].map((match) => match[1]);
}

function filterDuplicateBlocks(section, seenIds) {
  return section.replace(/(### \d{2}:\d{2}\n[\s\S]*?id=(\d+)[^\n]*\)[\s\S]*?)(?=\n### \d{2}:\d{2}\n|$)/g, (block, fullBlock, id) => {
    if (seenIds.has(id)) return '';
    seenIds.add(id);
    return fullBlock.trimEnd() + '\n';
  });
}
