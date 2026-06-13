import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/convert-shot-cards.mjs <Steam体验记录目录>');
  process.exit(1);
}

const files = (await fs.readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
  .map((entry) => path.join(root, entry.name));

for (const file of files) {
  const content = await fs.readFile(file, 'utf8');
  const next = content.replace(
    /### \d{2}:\d{2}\n\n!\[screenshot\]\(([^)]+)\)\n\n> \[!quote\] 当时评价\n((?:>.*\n)+)\n来源：\[Steam 截图\]\(([^)]+)\)/g,
    (_match, image, quoteLines, source) => {
      const caption = quoteLines
        .split(/\r?\n/)
        .map((line) => line.replace(/^>\s?/, '').trim())
        .filter(Boolean)
        .join('\n');
      return createShotCard(image, caption || '无文字评价', source);
    },
  );

  if (next !== content) {
    await fs.writeFile(file, next, 'utf8');
    console.log(`Converted ${file}`);
  }
}

function createShotCard(image, caption, source) {
  return [
    '<div class="steam-shot">',
    `  <img class="steam-shot-image" src="${image}" alt="screenshot">`,
    '  <div class="steam-shot-side">',
    '    <div class="steam-shot-label">当时评价</div>',
    `    <p>${escapeHtml(caption).replace(/\n/g, '<br>')}</p>`,
    `    <a href="${source}">Steam 截图</a>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
