import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/refresh-flat-game-covers.mjs <Steam体验记录目录>');
  process.exit(1);
}

const files = (await fs.readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
  .map((entry) => path.join(root, entry.name));

for (const file of files) {
  let content = await fs.readFile(file, 'utf8');
  const appid = firstMatch(content, /^steam_appid:\s*(\d+)/m);
  const currentCover = unquote(firstMatch(content, /^cover:\s*(.+)$/m));
  if (!appid || !currentCover) continue;

  const cover = await findCover(currentCover);
  if (!cover || cover === currentCover) continue;

  content = content.replace(/^cover:\s*.*$/m, `cover: ${JSON.stringify(cover)}`);
  content = content.replace(/<img src="[^"]+" alt="([^"]+ cover)">/, `<img src="${cover}" alt="$1">`);
  await fs.writeFile(file, content, 'utf8');
  console.log(`Updated cover: ${file}`);
}

async function findCover(sourceUrl) {
  const candidates = [
    steamAssetUrl(sourceUrl, 'library_hero.jpg'),
    steamAssetUrl(sourceUrl, 'capsule_616x353.jpg'),
    steamAssetUrl(sourceUrl, 'header.jpg'),
    sourceUrl,
  ];

  for (const candidate of candidates) {
    if (await imageExists(candidate)) return candidate;
  }
  return '';
}

async function imageExists(url) {
  const response = await fetch(url, { method: 'HEAD' });
  return response.ok && String(response.headers.get('content-type') || '').startsWith('image/');
}

function steamAssetUrl(sourceUrl, filename) {
  const [base, query = ''] = sourceUrl.split('?');
  const nextBase = base.replace(/\/[^/]+$/, `/${filename}`);
  return query ? `${nextBase}?${query}` : nextBase;
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : '';
}

function unquote(value) {
  return String(value || '').trim().replace(/^"|"$/g, '');
}
