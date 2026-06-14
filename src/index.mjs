#!/usr/bin/env node

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_EXPERIENCE_DIR = '00_输入源/50_我是谁/Steam体验记录';
const DEFAULT_STATE_PATH = '.obsidian/steam-experience-sync/state.json';
const DEFAULT_REQUEST_DELAY_MS = 1200;
const DEFAULT_RETRY_AFTER_MS = 60000;
const SCREENSHOT_LIST_PATH = '/screenshots/';

main().catch((error) => {
  console.error('[steam-experience-sync] failed:', error.message);
  process.exitCode = 1;
});

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(args);

  const state = await readState(config.stateFile);
  const existingIds = await collectExistingScreenshotIds(config.outputDir);
  state.seenPublishedFileIds = unique([...state.seenPublishedFileIds, ...existingIds]);
  const ids = await collectScreenshotIds(config.steamId, config.pages, config.limit);
  const candidates = args.sinceId
    ? ids.slice(0, Math.max(0, ids.indexOf(String(args.sinceId))))
    : ids;
  const sourceIds = config.resync
    ? candidates
    : candidates.filter((id) => !state.seenPublishedFileIds.includes(id));
  const unseen = config.limit === 'all' ? sourceIds : sourceIds.slice(0, config.limit);

  if (unseen.length === 0) {
    console.log('No new public Steam screenshots found.');
    return;
  }

  const playtimeMap = config.steamApiKey
    ? await fetchOwnedGamePlaytimes(config.steamId, config.steamApiKey).catch((error) => {
        console.warn('Playtime enrichment skipped:', error.message);
        return new Map();
      })
    : new Map();

  const coverMap = new Map();
  const processed = [];
  let matchedCount = 0;
  for (const [index, id] of unseen.reverse().entries()) {
    if (index > 0 && config.requestDelayMs > 0) {
      await sleep(config.requestDelayMs);
    }
    const item = await fetchScreenshotDetail(id);
    if (config.appids.length > 0 && !config.appids.includes(String(item.appid))) {
      continue;
    }
    matchedCount += 1;
    item.playtimeMinutes = playtimeMap.get(String(item.appid)) ?? null;
    if (!coverMap.has(String(item.appid))) {
      coverMap.set(String(item.appid), await fetchGameCover(item.appid).catch(() => null));
    }
    item.cover = coverMap.get(String(item.appid));

    if (config.dryRun) {
      console.log(formatDryRun(item, config.outputDir));
      if (config.maxMatches !== 'all' && matchedCount >= config.maxMatches) break;
      continue;
    }

    const target = await upsertExperienceNote(config.outputDir, item);
    processed.push(id);
    console.log(`Wrote ${target}`);
    if (config.maxMatches !== 'all' && matchedCount >= config.maxMatches) break;
  }

  if (!config.dryRun && processed.length > 0) {
    state.seenPublishedFileIds = unique([...state.seenPublishedFileIds, ...processed]);
    state.updatedAt = new Date().toISOString();
    await writeState(config.stateFile, state);
  }
}

function readConfig(args) {
  const steamId = args.steamId || process.env.STEAM_ID;
  const vaultDir = args.vault || process.env.OBSIDIAN_VAULT_DIR;
  if (!steamId) throw new Error('STEAM_ID is required. Set it in .env or pass --steam-id.');
  if (!vaultDir) throw new Error('OBSIDIAN_VAULT_DIR is required. Set it in .env or pass --vault.');

  const experienceDir = args.output || process.env.STEAM_EXPERIENCE_DIR || DEFAULT_EXPERIENCE_DIR;
  const statePath = args.state || process.env.STEAM_SYNC_STATE || DEFAULT_STATE_PATH;

  return {
    steamId,
    vaultDir,
    steamApiKey: args.apiKey || process.env.STEAM_API_KEY || '',
    outputDir: path.resolve(vaultDir, fromVaultPath(experienceDir)),
    stateFile: path.resolve(vaultDir, fromVaultPath(statePath)),
    pages: parseCount(args.pages || process.env.STEAM_LOOKBACK_PAGES || 1),
    limit: parseCount(args.limit || process.env.STEAM_LIMIT || 20),
    maxMatches: parseCount(args.maxMatches || process.env.STEAM_MAX_MATCHES || 'all'),
    requestDelayMs: parseNonNegativeInteger(args.requestDelayMs || process.env.STEAM_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS),
    appids: parseList(args.appid || args.appids || process.env.STEAM_APPIDS || ''),
    resync: Boolean(args.resync),
    dryRun: Boolean(args.dryRun),
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--resync') out.resync = true;
    else if (arg === '--all') {
      out.pages = 'all';
      out.limit = 'all';
    }
    else if (arg === '--steam-id') out.steamId = argv[++i];
    else if (arg === '--api-key') out.apiKey = argv[++i];
    else if (arg === '--vault') out.vault = argv[++i];
    else if (arg === '--output') out.output = argv[++i];
    else if (arg === '--state') out.state = argv[++i];
    else if (arg === '--appid') out.appid = argv[++i];
    else if (arg === '--appids') out.appids = argv[++i];
    else if (arg === '--pages') out.pages = argv[++i];
    else if (arg === '--limit') out.limit = argv[++i];
    else if (arg === '--max-matches') out.maxMatches = argv[++i];
    else if (arg === '--request-delay-ms') out.requestDelayMs = argv[++i];
    else if (arg === '--since-id') out.sinceId = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Steam Experience Sync

Usage:
  node src/index.mjs --dry-run
  node src/index.mjs --limit 10

Options:
  --dry-run          Preview writes without changing files
  --resync           Re-scan selected pages and write missing blocks even if state has seen them
  --all              Scan all public screenshot pages and write missing blocks
  --steam-id ID      Override STEAM_ID
  --api-key KEY      Override STEAM_API_KEY, avoid using this in shell history
  --vault PATH       Override OBSIDIAN_VAULT_DIR
  --output PATH      Vault-relative output directory
  --state PATH       Vault-relative state file
  --appid ID         Only write screenshots from one Steam appid
  --appids IDS       Only write screenshots from comma-separated Steam appids
  --pages N          Screenshot list pages to scan
  --limit N          Max new screenshots to process
  --max-matches N    Stop after N matching screenshots are written or previewed
  --request-delay-ms Delay between screenshot detail requests, default 1200
  --since-id ID      Only process screenshots newer than this id in the current list
`);
}

async function collectScreenshotIds(steamId, pages, limit) {
  const ids = [];
  const seen = new Set();
  const allPages = pages === 'all';
  const pageLimit = allPages ? 200 : pages;
  const itemLimit = limit === 'all' ? Number.POSITIVE_INFINITY : limit;
  for (let page = 1; page <= pageLimit; page += 1) {
    const url = `https://steamcommunity.com/profiles/${steamId}${SCREENSHOT_LIST_PATH}?p=${page}&sort=newest&l=english`;
    const html = await fetchText(url);
    const matches = html.matchAll(/sharedfiles\/filedetails\/\?id=(\d+)|data-publishedfileid="(\d+)"/g);
    let addedOnPage = 0;
    for (const match of matches) {
      const id = match[1] || match[2];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      addedOnPage += 1;
    }
    if (ids.length >= itemLimit) break;
    if (allPages && addedOnPage === 0) break;
  }
  return ids;
}

async function fetchScreenshotDetail(id) {
  const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
  const html = await fetchText(`${url}&l=english`);
  const description = firstMatch(html, /<meta\s+name="Description"\s+content="([^"]*)"/i);
  const ogTitle = firstMatch(html, /<meta\s+property="og:title"\s+content="([^"]*)"/i);
  const ogImage = firstMatch(html, /<meta\s+property="og:image"\s+content="([^"]*)"/i);
  const appid = firstMatch(html, /data-appid="(\d+)"/) || firstMatch(html, /appid=(\d+)/);
  const posted = extractPostedAt(html);

  if (!appid) throw new Error(`Could not parse appid for screenshot ${id}`);

  const decodedDescription = decodeHtml(description || '');
  const { game, caption } = parseSteamDescription(decodedDescription, ogTitle);
  const postedAt = parseSteamPostedAt(posted, new Date());
  const date = formatDate(postedAt);

  return {
    id,
    url,
    appid,
    game: game || `Steam App ${appid}`,
    caption: caption || '',
    image: decodeHtml(ogImage || ''),
    postedRaw: posted || '',
    postedAt,
    date,
    time: formatTime(postedAt),
  };
}

async function fetchGameCover(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&l=schinese`;
  const json = await fetchJson(url);
  const data = json?.[appid]?.data;
  const candidates = unique([
    steamAssetUrl(data?.header_image, 'library_hero.jpg'),
    steamAssetUrl(data?.header_image, 'capsule_616x353.jpg'),
    steamAssetUrl(data?.header_image, 'header.jpg'),
    data?.header_image,
    data?.capsule_image,
    steamAssetUrl(data?.header_image, 'library_600x900.jpg'),
    data?.library_600x900,
    data?.capsule_imagev5,
  ]);

  for (const candidate of candidates) {
    if (await imageExists(candidate)) return candidate;
  }
  return null;
}

async function fetchOwnedGamePlaytimes(steamId, apiKey) {
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamid', steamId);
  url.searchParams.set('include_appinfo', 'true');
  url.searchParams.set('format', 'json');
  const json = await fetchJson(url.href);
  const map = new Map();
  for (const game of json?.response?.games || []) {
    map.set(String(game.appid), game.playtime_forever ?? null);
  }
  return map;
}

async function upsertExperienceNote(outputDir, item) {
  const dir = outputDir;
  await fs.mkdir(dir, { recursive: true });

  const file = path.join(dir, `${safeFileName(item.game)}.md`);
  let content = '';
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (!content) {
    content = createNote(item);
  } else {
    content = updateFrontmatter(content, item);
    content = updateHero(content, item);
    if (!hasScreenshot(content, item.id)) {
      content = `${content.trimEnd()}\n\n${createDatedScreenshotBlock(content, item)}\n`;
    }
  }

  await fs.writeFile(file, content, 'utf8');
  return file;
}

function createNote(item) {
  const yaml = [
    '---',
    'type: raw_steam_experience',
    'status: raw',
    'domain: "我是谁"',
    `created: ${item.date}`,
    `updated: ${item.date}`,
    'platform: steam',
    `game: ${yamlString(item.game)}`,
    `steam_appid: ${item.appid}`,
    item.cover ? `cover: ${yamlString(item.cover)}` : 'cover:',
    item.playtimeMinutes != null ? `playtime_hours: ${(item.playtimeMinutes / 60).toFixed(1)}` : 'playtime_hours:',
    'source: steam_screenshot',
    'cssclasses: steam-experience',
    'tags: []',
    '---',
  ].join('\n');

  return `${yaml}\n\n${createHero(item)}\n\n## ${item.date}\n\n${createScreenshotBlock(item)}\n`;
}

function createDatedScreenshotBlock(content, item) {
  const block = createScreenshotBlock(item);
  return content.includes(`## ${item.date}`) ? block : `## ${item.date}\n\n${block}`;
}

function createHero(item) {
  if (!item.cover) return `# ${item.game}`;
  return [
    '<div class="steam-hero">',
    `  <img src="${item.cover}" alt="${escapeHtml(item.game)} cover">`,
    '  <div class="steam-hero-info">',
    `    <div class="steam-game-title">${escapeHtml(item.game)}</div>`,
    `    <div class="steam-game-meta">Steam · App ${item.appid}${formatPlaytimeMeta(item.playtimeMinutes)}</div>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function createScreenshotBlock(item) {
  const caption = item.caption || '无文字评价';
  const image = item.image
    ? `  <img class="steam-shot-image" src="${item.image}" alt="screenshot">`
    : '  <div class="steam-shot-image steam-shot-image-empty"></div>';
  return [
    '<div class="steam-shot">',
    image,
    '  <div class="steam-shot-side">',
    '    <div class="steam-shot-label">我的评价</div>',
    `    <p>${escapeHtml(caption)}</p>`,
    `    <a href="${item.url}">Steam 截图</a>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function hasScreenshot(content, id) {
  return [
    `steam-screenshot-id: ${id}`,
    `id=${id}`,
    `Steam 截图 ${id}`,
  ].some((marker) => content.includes(marker));
}

function updateFrontmatter(content, item) {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return content;
  let fm = content.slice(0, end + 4);
  fm = replaceYamlLine(fm, 'updated', item.date);
  if (item.cover && shouldReplaceCover(fm)) fm = replaceYamlLine(fm, 'cover', yamlString(item.cover));
  if (item.playtimeMinutes != null) fm = replaceYamlLine(fm, 'playtime_hours', (item.playtimeMinutes / 60).toFixed(1));
  return fm + content.slice(end + 4);
}

function updateHero(content, item) {
  if (!item.cover) return content;
  const heroPattern = /<div class="steam-hero">[\s\S]*?<\/div>\s*(?=\n\n## )/;
  return heroPattern.test(content) ? content.replace(heroPattern, createHero(item)) : content;
}

function shouldReplaceCover(frontmatter) {
  const match = frontmatter.match(/^cover:\s*(.*)$/m);
  if (!match) return true;
  const value = match[1].trim();
  return !value || /(capsule_(184x69|231x87)|library_600x900)/.test(value);
}

function replaceYamlLine(frontmatter, key, value) {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${escapeRegExp(key)}:.*$`, 'm');
  return re.test(frontmatter) ? frontmatter.replace(re, line) : frontmatter.replace(/\n---$/, `\n${line}\n---`);
}

async function readState(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      seenPublishedFileIds: Array.isArray(parsed.seenPublishedFileIds) ? parsed.seenPublishedFileIds.map(String) : [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { seenPublishedFileIds: [], updatedAt: null };
  }
}

async function writeState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function collectExistingScreenshotIds(outputDir) {
  const ids = [];
  for (const file of await findMarkdownFiles(outputDir)) {
    const content = await fs.readFile(file, 'utf8');
    for (const match of content.matchAll(/(?:id=|Steam 截图\s+|steam-screenshot-id:\s*)(\d+)/g)) {
      ids.push(match[1]);
    }
  }
  return unique(ids);
}

async function findMarkdownFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    return files;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function fetchText(url) {
  const response = await fetchWithBackoff(url, { headers: defaultHeaders() });
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithBackoff(url, { headers: defaultHeaders() });
  return response.json();
}

async function imageExists(url) {
  if (!url) return false;
  const response = await fetchWithBackoff(url, { method: 'HEAD', headers: defaultHeaders() }, { throwOnError: false });
  return response.ok && String(response.headers.get('content-type') || '').startsWith('image/');
}

async function fetchWithBackoff(url, options = {}, settings = {}) {
  const maxAttempts = settings.maxAttempts ?? 3;
  const throwOnError = settings.throwOnError ?? true;
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    lastResponse = response;
    if (!shouldRetry(response.status) || attempt === maxAttempts) break;

    const waitMs = retryAfterMs(response) ?? DEFAULT_RETRY_AFTER_MS * attempt;
    console.warn(`Steam request ${response.status}; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${maxAttempts}.`);
    await sleep(waitMs);
  }

  if (throwOnError) {
    throw new Error(`${lastResponse.status} ${lastResponse.statusText} for ${url}`);
  }
  return lastResponse;
}

function shouldRetry(status) {
  return status === 429 || status === 503 || status === 502 || status === 500;
}

function retryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function defaultHeaders() {
  return {
    'User-Agent': 'steam-experience-sync/0.1 (+https://github.com/)',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

function parseSteamDescription(description, fallbackTitle) {
  const normalized = description.replace(/^(Steam Community|Steam 社区):\s*/i, '').trim();
  const split = normalized.match(/^(.+?)\.\s*(.*)$/s);
  if (split) {
    return { game: split[1].trim(), caption: split[2].trim() };
  }
  const titleCaption = decodeHtml(fallbackTitle || '').replace(/^Steam Community :: Screenshot ::\s*/i, '').trim();
  return { game: normalized || '', caption: titleCaption };
}

function extractPostedAt(html) {
  const statLabels = [...html.matchAll(/<div class="detailsStatLeft">\s*([^<]+?)\s*<\/div>/g)].map((m) => decodeHtml(m[1]).trim());
  const statValues = [...html.matchAll(/<div class="detailsStatRight">\s*([^<]+?)\s*<\/div>/g)].map((m) => decodeHtml(m[1]).trim());
  const index = statLabels.findIndex((label) => label.toLowerCase() === 'posted');
  return index >= 0 ? statValues[index] : '';
}

function parseSteamPostedAt(value, now) {
  if (!value) return now;
  const normalized = value.replace(',', '').replace(/\s+/g, ' ').trim();
  const withYear = normalized.match(/^([A-Za-z]{3,9}) (\d{1,2}) (\d{4}) @ (\d{1,2}):(\d{2})(am|pm)$/i);
  const withoutYear = normalized.match(/^([A-Za-z]{3,9}) (\d{1,2}) @ (\d{1,2}):(\d{2})(am|pm)$/i);
  const match = withYear || withoutYear;
  if (!match) return now;

  const month = monthIndex(match[1]);
  if (month < 0) return now;
  const hasYear = match.length === 7;
  const year = hasYear ? Number(match[3]) : now.getFullYear();
  const day = Number(match[2]);
  const hourIndex = hasYear ? 4 : 3;
  let hour = Number(match[hourIndex]);
  const minute = Number(match[hourIndex + 1]);
  const ampm = match[hourIndex + 2].toLowerCase();
  if (ampm === 'pm' && hour !== 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  const parsed = new Date(year, month, day, hour, minute, 0);

  if (!hasYear && parsed.getTime() - now.getTime() > 1000 * 60 * 60 * 24 * 30) {
    parsed.setFullYear(year - 1);
  }
  return parsed;
}

function monthIndex(name) {
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(name.slice(0, 3).toLowerCase());
}

function loadDotEnv(file) {
  if (!fsSync.existsSync(file)) return;
  const raw = fsSync.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function decodeHtml(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function steamAssetUrl(sourceUrl, filename) {
  if (!sourceUrl) return '';
  const [base, query = ''] = sourceUrl.split('?');
  const nextBase = base.replace(/\/[^/]+$/, `/${filename}`);
  return query ? `${nextBase}?${query}` : nextBase;
}

function formatPlaytimeMeta(minutes) {
  return minutes != null ? ` · ${(minutes / 60).toFixed(1)}h` : '';
}

function safeFileName(name) {
  return String(name || 'untitled')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'untitled';
}

function fromVaultPath(value) {
  return String(value).replace(/[\\/]+/g, path.sep);
}

function parseCount(value) {
  if (value === 'all') return 'all';
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : DEFAULT_REQUEST_DELAY_MS;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function yamlString(value) {
  return JSON.stringify(String(value || ''));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDryRun(item, outputDir) {
  const rel = `${safeFileName(item.game)}.md`;
  return [
    '--- dry run ---',
    `target: ${path.join(outputDir, rel)}`,
    `id: ${item.id}`,
    `game: ${item.game}`,
    `appid: ${item.appid}`,
    `posted: ${item.date} ${item.time}`,
    `caption: ${item.caption || '(empty)'}`,
    `image: ${item.image}`,
  ].join('\n');
}
