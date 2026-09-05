#!/usr/bin/env node

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { readDiscoveryIndex, upsertDiscoveredScreenshot, writeDiscoveryIndex } from './core/discovery-store.mjs';
import { clearPendingWrites, readPendingWrites, writePendingWrites } from './core/pending-writes.mjs';
import {
  computePageDelay,
  computeRequestDelay,
  formatRateLimiterSummary,
  loadRateLimiterState,
  record429,
  record5xx,
  recordSuccess,
  saveRateLimiterState,
} from './core/rate-limiter.mjs';
import { recordRateFailure, resetRateFailures } from './core/rate-state.mjs';
import { parseSteamPostedAt } from './core/steam-date.mjs';
import {
  acquireWorkerLock,
  isWorkerLockActive,
  releaseWorkerLock,
} from './core/worker-lock.mjs';
import {
  computeNewestFeedCursor,
  computeWorkerCursor,
  normalizeNewestFeedState,
  shouldStopFeedWorkerLoop,
  shouldStopScreenshotPagination,
} from './core/worker-progress.mjs';

const DEFAULT_EXPERIENCE_DIR = '00_输入源/50_我是谁/Steam体验记录';
const DEFAULT_STATE_PATH = '.obsidian/steam-experience-sync/state.json';
const DEFAULT_DISCOVERY_PATH = '.obsidian/steam-experience-sync/discovered-games.json';
const DEFAULT_PENDING_WRITES_PATH = '.obsidian/steam-experience-sync/pending-writes.json';
const DEFAULT_REQUEST_DELAY_MS = 1200;
const DEFAULT_RETRY_AFTER_MS = 60000;
const DEFAULT_WORKER_COOLDOWN_ON_429_MS = 8 * 60 * 60 * 1000;
const DEFAULT_WORKER_LOOP_DELAY_MS = 60000;
const SCREENSHOT_LIST_PATH = '/screenshots/';

// Module-level rate limiter reference, set by main() for use in fetchWithBackoff
let globalRateLimiter = null;

main().catch((error) => {
  console.error('[steam-experience-sync] failed:', error.message);
  process.exitCode = 1;
});

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(args);

  // Load adaptive rate limiter; attach to config so all modes can use it
  if (config.adaptiveEnabled) {
    config.rateLimiter = await loadRateLimiterState(
      config.rateLimiterFile,
      config.requestDelayMs,
    );
    globalRateLimiter = config.rateLimiter;
    console.error(`Rate limiter: ${formatRateLimiterSummary(config.rateLimiter)}`);
  }

  if (args.stopWorker) {
    await requestWorkerStop(config);
    return;
  }
  if (args.clearWorkerStop) {
    await clearWorkerStop(config);
    return;
  }
  if (args.workerStatus) {
    await printWorkerStatus(config);
    return;
  }
  if (args.workerStatusJson) {
    await printWorkerStatusJson(config);
    return;
  }
  if (args.workerLogTail) {
    await printWorkerLog(config);
    return;
  }
  if (args.discover) {
    await runDiscovery(config, args);
    return;
  }
  if (args.readDiscovery) {
    await printDiscoveryIndex(config);
    return;
  }
  if (args.readPending) {
    await printPendingWrites(config);
    return;
  }
  if (args.planWrites) {
    await planWrites(config, args);
    return;
  }
  if (args.applyPending) {
    await applyPendingWrites(config);
    return;
  }
  if (args.clearPending) {
    await clearPendingQueue(config);
    return;
  }
  if (config.workerLoop) {
    await runWorkerLoop(config, args);
    await saveRateLimiterIfNeeded(config);
    return;
  }
  if (config.worker) {
    await runWorker(config, args);
    await saveRateLimiterIfNeeded(config);
    return;
  }

  const state = await readState(config.stateFile);
  await runOnce(config, args, state);
  await saveRateLimiterIfNeeded(config);
}

async function saveRateLimiterIfNeeded(config) {
  if (config.adaptiveEnabled && globalRateLimiter) {
    config.rateLimiter = globalRateLimiter;
    await saveRateLimiterState(config.rateLimiterFile, globalRateLimiter);
  }
}

async function planWrites(config, args) {
  const state = await readState(config.stateFile);
  const existingIds = await collectExistingScreenshotIds(config.outputDir);
  state.seenPublishedFileIds = unique([...state.seenPublishedFileIds, ...existingIds]);
  const items = await collectCandidateItems(config, args, state);
  const pending = {
    createdAt: new Date().toISOString(),
    outputDir: config.outputDir,
    items: items.map((item) => ({
      ...item,
      targetFile: path.join(config.outputDir, `${safeFileName(item.game)}.md`),
    })),
  };
  await writePendingWrites(config.pendingWritesFile, pending);
  console.log(`Planned ${pending.items.length} pending write(s) at ${config.pendingWritesFile}`);
}

async function applyPendingWrites(config) {
  const pending = await readPendingWrites(config.pendingWritesFile);
  const items = Array.isArray(pending.items) ? pending.items : [];
  const state = await readState(config.stateFile);
  const processed = [];

  for (const item of items) {
    const target = await upsertExperienceNote(config.outputDir, item);
    processed.push(String(item.id));
    console.log(`Wrote ${target}`);
  }

  if (processed.length > 0) {
    state.seenPublishedFileIds = unique([...state.seenPublishedFileIds, ...processed]);
    state.updatedAt = new Date().toISOString();
    await writeState(config.stateFile, state);
  }

  await clearPendingWrites(config.pendingWritesFile);
  console.log(`Applied ${processed.length} pending write(s).`);
}

async function printPendingWrites(config) {
  const pending = await readPendingWrites(config.pendingWritesFile);
  console.log(JSON.stringify(pending, null, 2));
}

async function clearPendingQueue(config) {
  await clearPendingWrites(config.pendingWritesFile);
  console.log(`Cleared pending writes at ${config.pendingWritesFile}`);
}

async function collectCandidateItems(config, args, state) {
  const playtimeMap = config.steamApiKey
    ? await fetchOwnedGamePlaytimes(config.steamId, config.steamApiKey).catch((error) => {
        console.warn('Playtime enrichment skipped:', error.message);
        return new Map();
      })
    : new Map();

  const coverMap = new Map();
  const items = [];
  const seenListIds = new Set();
  const selectedAppids = new Set(config.appids);
  const autoSelectGames = config.appids.length === 0 && config.maxGames !== 'all';
  let matchedCount = 0;
  let scannedCount = 0;

  screenshotPages:
  for await (const pageResult of collectScreenshotIdPages(config)) {
    for (const id of pageResult.ids) {
      if (seenListIds.has(id)) continue;
      seenListIds.add(id);
      if (args.sinceId && id === String(args.sinceId)) break screenshotPages;
      if (!config.resync && state.seenPublishedFileIds.includes(id)) continue;
      if (config.limit !== 'all' && scannedCount >= config.limit) break screenshotPages;

      scannedCount += 1;
      if (scannedCount > 1) {
        const delayMs = getRequestDelay(config);
        if (delayMs > 0) await sleep(delayMs);
      }

      const item = await fetchScreenshotDetail(id);
      if (config.appids.length > 0 && !config.appids.includes(String(item.appid))) continue;
      if (autoSelectGames && !selectedAppids.has(String(item.appid))) {
        if (selectedAppids.size >= config.maxGames) continue;
        selectedAppids.add(String(item.appid));
      }

      matchedCount += 1;
      item.playtimeMinutes = playtimeMap.get(String(item.appid)) ?? null;
      if (!coverMap.has(String(item.appid))) {
        coverMap.set(String(item.appid), await fetchGameCover(item.appid).catch(() => null));
      }
      item.cover = coverMap.get(String(item.appid));
      items.push(item);

      if (config.maxMatches !== 'all' && matchedCount >= config.maxMatches) break screenshotPages;
    }
  }

  return items;
}

async function runDiscovery(config, args) {
  const index = await readDiscoveryIndex(config.discoveryFile);
  const seenListIds = new Set();
  let discoveredScreenshots = 0;
  let scannedCount = 0;
  let lastScannedPage = config.startPage - 1;

  screenshotPages:
  for await (const pageResult of collectScreenshotIdPages(config)) {
    lastScannedPage = pageResult.page;
    for (const id of pageResult.ids) {
      if (seenListIds.has(id)) continue;
      seenListIds.add(id);
      if (args.sinceId && id === String(args.sinceId)) break screenshotPages;
      if (config.limit !== 'all' && scannedCount >= config.limit) break screenshotPages;

      scannedCount += 1;
      if (scannedCount > 1) {
        const delayMs = getRequestDelay(config);
        if (delayMs > 0) await sleep(delayMs);
      }

      const item = await fetchScreenshotDetail(id);
      upsertDiscoveredScreenshot(index, item);
      discoveredScreenshots += 1;
      console.log(`Discovered ${item.game} (${item.appid}) screenshot ${item.id}`);
    }
  }

  if (!config.dryRun) {
    await writeDiscoveryIndex(config.discoveryFile, index);
  }

  const gameCount = Object.keys(index.games || {}).length;
  console.log(`Discovered ${gameCount} game(s), ${discoveredScreenshots} screenshot(s), last page ${lastScannedPage}.`);
}

async function printDiscoveryIndex(config) {
  const index = await readDiscoveryIndex(config.discoveryFile);
  console.log(JSON.stringify(index, null, 2));
}

async function runOnce(config, args, state) {
  const existingIds = await collectExistingScreenshotIds(config.outputDir);
  state.seenPublishedFileIds = unique([...state.seenPublishedFileIds, ...existingIds]);

  const playtimeMap = config.steamApiKey
    ? await fetchOwnedGamePlaytimes(config.steamId, config.steamApiKey).catch((error) => {
        console.warn('Playtime enrichment skipped:', error.message);
        return new Map();
      })
    : new Map();

  const coverMap = new Map();
  const processed = [];
  const seenListIds = new Set();
  const selectedAppids = new Set(config.appids);
  const autoSelectGames = config.appids.length === 0 && config.maxGames !== 'all';
  let matchedCount = 0;
  let scannedCount = 0;
  let lastScannedPage = config.startPage - 1;
  let stoppedByMaxMatches = false;
  let stoppedByStopFile = false;
  let stoppedByScanLimit = false;
  const scannedIds = [];
  const skipDetailIds = new Set((config.skipDetailIds || []).map(String));

  screenshotPages:
  for await (const pageResult of collectScreenshotIdPages(config)) {
    lastScannedPage = pageResult.page;
    const { ids } = pageResult;
    for (const id of ids) {
      if (config.worker && fsSync.existsSync(config.workerStopFile)) {
        stoppedByStopFile = true;
        break screenshotPages;
      }
      if (seenListIds.has(id)) continue;
      seenListIds.add(id);
      if (skipDetailIds.has(String(id))) continue;

      if (args.sinceId && id === String(args.sinceId)) break screenshotPages;
      if (!config.resync && state.seenPublishedFileIds.includes(id)) continue;
      if (config.limit !== 'all' && scannedCount >= config.limit) {
        stoppedByScanLimit = true;
        break screenshotPages;
      }

      scannedCount += 1;
      scannedIds.push(String(id));
      if (scannedCount > 1) {
        const delayMs = getRequestDelay(config);
        if (delayMs > 0) await sleep(delayMs);
      }

      const item = await fetchScreenshotDetail(id);
      if (config.appids.length > 0 && !config.appids.includes(String(item.appid))) {
        continue;
      }
      if (autoSelectGames && !selectedAppids.has(String(item.appid))) {
        if (selectedAppids.size >= config.maxGames) continue;
        selectedAppids.add(String(item.appid));
      }

      matchedCount += 1;
      item.playtimeMinutes = playtimeMap.get(String(item.appid)) ?? null;
      if (!coverMap.has(String(item.appid))) {
        coverMap.set(String(item.appid), await fetchGameCover(item.appid).catch(() => null));
      }
      item.cover = coverMap.get(String(item.appid));

      if (config.dryRun) {
        console.log(formatDryRun(item, config.outputDir));
      } else {
        const target = await upsertExperienceNote(config.outputDir, item);
        processed.push(id);
        console.log(`Wrote ${target}`);
      }

      if (config.maxMatches !== 'all' && matchedCount >= config.maxMatches) {
        stoppedByMaxMatches = true;
        break screenshotPages;
      }
    }
  }

  if (matchedCount === 0) {
    console.log('No new public Steam screenshots found.');
    return { processed, matchedCount, scannedCount, scannedIds, lastScannedPage, stoppedByMaxMatches, stoppedByStopFile, stoppedByScanLimit };
  }

  if (!config.dryRun && processed.length > 0) {
    state.seenPublishedFileIds = unique([...state.seenPublishedFileIds, ...processed]);
    state.updatedAt = new Date().toISOString();
    await writeState(config.stateFile, state);
  }

  return { processed, matchedCount, scannedCount, scannedIds, lastScannedPage, stoppedByMaxMatches, stoppedByStopFile, stoppedByScanLimit };
}

async function runWorker(config, args) {
  if (fsSync.existsSync(config.workerStopFile)) {
    console.log(`Worker stopped by ${config.workerStopFile}`);
    return;
  }

  const state = await readState(config.stateFile);
  state.worker = normalizeWorkerState(state.worker);
  const now = Date.now();
  const forceRateLimit = process.env.STEAM_TEST_FORCE_429 === '1';

  if (!forceRateLimit && state.worker.pausedByRateLimit) {
    console.log('Worker paused by repeated Steam rate limits. Clear the stop file after reviewing the logs.');
    return;
  }

  if (!forceRateLimit && state.worker.cooldownUntil && Date.parse(state.worker.cooldownUntil) > now) {
    await writeWorkerLog(config, {
      level: 'info',
      event: 'cooldown_skip',
      cooldownUntil: state.worker.cooldownUntil,
    });
    console.log(`Worker skipped: cooldown until ${formatBeijingDateTime(state.worker.cooldownUntil)}`);
    return;
  }

  if (config.workerMode === 'feed') {
    return runFeedWorker(config, args, state, forceRateLimit);
  }

  return runAppidWorker(config, args, state, forceRateLimit);
}

async function runFeedWorker(config, args, state, forceRateLimit) {
  const feedState = normalizeNewestFeedState(state.worker.feed);
  const startPage = 1;
  const checkedIds = (feedState.checkedIds || []).map(String);
  const workerConfig = {
    ...config,
    appids: [],
    pages: 1,
    startPage,
    limit: config.workerMaxDetailScans,
    maxMatches: config.workerBatchSize,
    maxGames: 'all',
    resync: false,
    skipDetailIds: checkedIds,
  };

  console.log(`Worker batch: newest screenshot feed page, max ${workerConfig.maxMatches} match(es), max ${workerConfig.limit} detail check(s).`);

  await writeWorkerLog(config, {
    level: 'info',
    event: 'worker_start',
    mode: 'feed',
    startPage: workerConfig.startPage,
    pages: workerConfig.pages,
    batchSize: workerConfig.maxMatches,
    maxDetailScans: workerConfig.limit,
    dryRun: config.dryRun,
  });

  try {
    if (forceRateLimit) {
      throw new HttpStatusError(429, 'Forced Rate Limit', 'STEAM_TEST_FORCE_429');
    }

    const summary = await runOnce(workerConfig, args, state);
    const cursor = computeNewestFeedCursor({ checkedIds, summary });

    state.worker.feed = {
      ...feedState,
      nextPage: cursor.nextPage,
      imported: Number(feedState.imported || 0) + summary.processed.length,
      lastRunAt: new Date().toISOString(),
      lastMatchedCount: summary.matchedCount,
      lastProcessedCount: summary.processed.length,
      lastDetailScannedCount: summary.scannedCount,
      lastScannedPage: summary.lastScannedPage,
      checkedPage: cursor.checkedPage,
      checkedIds: cursor.checkedIds,
    };
    state.worker.lastRunAt = new Date().toISOString();
    state.worker = {
      ...resetRateFailures(state.worker),
      lastError: null,
      consecutiveFailures: 0,
    };
    if (!config.dryRun) await writeState(config.stateFile, state);

    await writeWorkerLog(config, {
      level: 'info',
      event: 'worker_done',
      mode: 'feed',
      processed: summary.processed.length,
      matched: summary.matchedCount,
      detailScanned: summary.scannedCount,
      nextPage: cursor.nextPage,
      stoppedByStopFile: summary.stoppedByStopFile,
      stoppedByScanLimit: summary.stoppedByScanLimit,
    });
    console.log(`Worker done: newest screenshot feed, wrote ${summary.processed.length}, matched ${summary.matchedCount}.`);
    return summary;
  } catch (error) {
    await handleWorkerFailure(config, state, error, { mode: 'feed' });
    return null;
  }
}

async function runAppidWorker(config, args, state, forceRateLimit) {
  let queue = config.workerAppids.length > 0 ? config.workerAppids : config.appids;
  if (queue.length === 0) {
    const discovery = await readDiscoveryIndex(config.discoveryFile);
    queue = Object.keys(discovery.games || {});
    if (queue.length === 0) {
      throw new Error(
        'No worker appids configured and discovery index is empty. ' +
        'Run --discover first to build the index, or configure STEAM_WORKER_APPIDS.',
      );
    }
    console.log(`Auto-loaded ${queue.length} appid(s) from discovery index.`);
  }

  const index = state.worker.nextAppidIndex % queue.length;
  const appid = String(queue[index]);
  const appState = state.worker.appids[appid] || { nextPage: 1, imported: 0 };
  const startPage = appState.nextPage || 1;
  const checkedIds = Number(appState.checkedPage) === Number(startPage)
    ? (appState.checkedIds || []).map(String)
    : [];
  const pageEnd = startPage + config.workerPages - 1;
  const workerConfig = {
    ...config,
    appids: [appid],
    pages: config.workerPages,
    startPage,
    limit: config.workerMaxDetailScans,
    maxMatches: config.workerBatchSize,
    maxGames: 'all',
    resync: false,
    skipDetailIds: checkedIds,
  };

  console.log(`Worker batch: appid ${appid}, pages ${workerConfig.startPage}-${pageEnd}, max ${workerConfig.maxMatches} match(es), max ${workerConfig.limit} detail check(s).`);

  await writeWorkerLog(config, {
    level: 'info',
    event: 'worker_start',
    appid,
    startPage: workerConfig.startPage,
    pages: workerConfig.pages,
    batchSize: workerConfig.maxMatches,
    maxDetailScans: workerConfig.limit,
    dryRun: config.dryRun,
  });

  try {
    if (forceRateLimit) {
      throw new HttpStatusError(429, 'Forced Rate Limit', 'STEAM_TEST_FORCE_429');
    }

    const summary = await runOnce(workerConfig, args, state);
    const cursor = computeWorkerCursor({ startPage, checkedIds, summary });

    state.worker.appids[appid] = {
      ...appState,
      nextPage: cursor.nextPage,
      imported: Number(appState.imported || 0) + summary.processed.length,
      lastRunAt: new Date().toISOString(),
      lastMatchedCount: summary.matchedCount,
      lastProcessedCount: summary.processed.length,
      lastDetailScannedCount: summary.scannedCount,
      lastScannedPage: summary.lastScannedPage,
      checkedPage: cursor.checkedPage,
      checkedIds: cursor.checkedIds,
    };
    state.worker.nextAppidIndex = (index + 1) % queue.length;
    state.worker.lastRunAt = new Date().toISOString();
    state.worker = {
      ...resetRateFailures(state.worker),
      lastError: null,
      consecutiveFailures: 0,
    };
    if (!config.dryRun) await writeState(config.stateFile, state);

    await writeWorkerLog(config, {
      level: 'info',
      event: 'worker_done',
      appid,
      processed: summary.processed.length,
      matched: summary.matchedCount,
      detailScanned: summary.scannedCount,
      nextPage: cursor.nextPage,
      stoppedByStopFile: summary.stoppedByStopFile,
      stoppedByScanLimit: summary.stoppedByScanLimit,
    });
    console.log(`Worker done: appid ${appid}, wrote ${summary.processed.length}, matched ${summary.matchedCount}, next page ${cursor.nextPage}.`);
    console.log(`Next worker run will start with appid ${queue[state.worker.nextAppidIndex]}.`);
  } catch (error) {
    await handleWorkerFailure(config, state, error, { mode: 'appid', appid });
  }
}

async function handleWorkerFailure(config, state, error, context) {
  if (error.status === 429) {
    state.worker = recordRateFailure(state.worker, new Date().toISOString());
    const cooldownMultiplier = Math.min(Number(state.worker.consecutiveRateFailures || 1), 3);
    state.worker.cooldownUntil = new Date(Date.now() + config.workerCooldownOn429Ms * cooldownMultiplier).toISOString();
    if (state.worker.pausedByRateLimit && !config.dryRun) {
      await requestWorkerStop(config);
    }
  }
  state.worker.lastError = {
    message: error.message,
    status: error.status || null,
    ...serializeErrorDetails(error),
    at: new Date().toISOString(),
  };
  state.worker.consecutiveFailures = Number(state.worker.consecutiveFailures || 0) + 1;
  if (!config.dryRun) await writeState(config.stateFile, state);

  await writeWorkerLog(config, {
    level: 'error',
    event: 'worker_failed',
    ...context,
    status: error.status || null,
    message: error.message,
    error: serializeErrorDetails(error),
    cooldownUntil: state.worker.cooldownUntil || null,
    consecutiveRateFailures: state.worker.consecutiveRateFailures || 0,
    pausedByRateLimit: Boolean(state.worker.pausedByRateLimit),
  });

  if (error.status === 429) {
    const pauseMessage = state.worker.pausedByRateLimit ? ' Repeated failures reached 3; worker stop requested.' : '';
    console.warn(`Worker stopped on 429; cooldown until ${formatBeijingDateTime(state.worker.cooldownUntil)}.${pauseMessage}`);
    return;
  }
  throw error;
}

async function runWorkerLoop(config, args) {
  const lock = await acquireWorkerLock(config.workerLockFile);
  if (!lock.acquired) {
    const message = `Worker loop already running; lock file active at ${config.workerLockFile}`;
    console.log(message);
    await writeWorkerLog(config, {
      level: 'warn',
      event: 'worker_lock_active',
      lockFile: config.workerLockFile,
      existing: lock.existing || null,
    });
    return;
  }

  console.log(`Worker loop started. Delay between rounds: ${Math.round(config.workerLoopDelayMs / 1000)}s.`);
  console.log('Use `npm.cmd run worker:stop` in another terminal to stop after the current step.');

  try {
    while (true) {
      const summary = await runWorker({ ...config, worker: true }, args);

      if (config.dryRun) {
        console.log('Worker loop dry-run stops after one round.');
        return;
      }
      if (fsSync.existsSync(config.workerStopFile)) {
        console.log(`Worker loop stopped by ${config.workerStopFile}`);
        return;
      }
      if (config.workerMode === 'feed' && shouldStopFeedWorkerLoop(summary)) {
        await writeWorkerLog(config, {
          level: 'info',
          event: 'worker_loop_complete',
          mode: 'feed',
          reason: 'no_unseen_screenshots',
        });
        console.log('Sync complete: newest screenshot page has no unseen screenshots.');
        return;
      }

      const state = await readState(config.stateFile);
      const worker = normalizeWorkerState(state.worker);
      if (worker.cooldownUntil && Date.parse(worker.cooldownUntil) > Date.now()) {
        console.log(`Worker loop paused by cooldown until ${formatBeijingDateTime(worker.cooldownUntil)}`);
        return;
      }

      console.log(`Worker loop waiting ${Math.round(config.workerLoopDelayMs / 1000)}s before next round...`);
      await sleep(config.workerLoopDelayMs);
    }
  } finally {
    await releaseWorkerLock(config.workerLockFile);
  }
}

async function requestWorkerStop(config) {
  await fs.mkdir(path.dirname(config.workerStopFile), { recursive: true });
  await fs.writeFile(config.workerStopFile, new Date().toISOString() + '\n', 'utf8');
  console.log(`Worker stop requested: ${config.workerStopFile}`);
}

async function clearWorkerStop(config) {
  try {
    await fs.unlink(config.workerStopFile);
    console.log(`Worker stop cleared: ${config.workerStopFile}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(`Worker stop was not set: ${config.workerStopFile}`);
  }
}

async function printWorkerStatus(config) {
  const state = await readState(config.stateFile);
  const worker = normalizeWorkerState(state.worker);
  let queue = [];
  if (config.workerMode === 'appid') {
    queue = config.workerAppids.length > 0 ? config.workerAppids : config.appids;
  }
  if (config.workerMode === 'appid' && queue.length === 0) {
    try {
      const discovery = await readDiscoveryIndex(config.discoveryFile);
      queue = Object.keys(discovery.games || {});
    } catch { /* discovery file may not exist */ }
  }
  const nextAppid = queue.length > 0 ? queue[worker.nextAppidIndex % queue.length] : '(not configured)';
  const stopExists = fsSync.existsSync(config.workerStopFile);
  const lockExists = await isWorkerLockActive(config.workerLockFile);
  const cooldownActive = worker.cooldownUntil ? Date.parse(worker.cooldownUntil) > Date.now() : false;
  const feed = normalizeNewestFeedState(worker.feed);

  console.log('Worker status');
  console.log(`  mode: ${config.workerMode}`);
  console.log(`  queue: ${queue.length > 0 ? queue.join(',') : '(empty)'}`);
  console.log('  feed scan: newest screenshot page');
  console.log(`  feed imported: ${feed.imported || 0}`);
  console.log(`  next appid: ${nextAppid}`);
  console.log(`  stop file: ${stopExists ? 'present' : 'absent'}`);
  console.log(`  worker lock: ${lockExists ? 'active' : 'inactive'}`);
  console.log(`  timezone: 北京时间`);
  console.log(`  cooldown: ${cooldownActive ? formatBeijingDateTime(worker.cooldownUntil) : 'inactive'}`);
  console.log(`  rate limit failures: ${worker.consecutiveRateFailures}`);
  console.log(`  paused by rate limit: ${worker.pausedByRateLimit ? 'yes' : 'no'}`);
  console.log(`  last run: ${worker.lastRunAt ? formatBeijingDateTime(worker.lastRunAt) : '(never)'}`);
  console.log(`  last error: ${worker.lastError ? worker.lastError.message : '(none)'}`);
  for (const appid of queue) {
    const item = worker.appids[String(appid)] || {};
    console.log(`  appid ${appid}: nextPage=${item.nextPage || 1}, imported=${item.imported || 0}, lastMatched=${item.lastMatchedCount ?? '(none)'}`);
  }
}

async function printWorkerStatusJson(config) {
  const state = await readState(config.stateFile);
  const worker = normalizeWorkerState(state.worker);
  let queue = [];
  if (config.workerMode === 'appid') {
    queue = config.workerAppids.length > 0 ? config.workerAppids : config.appids;
  }
  if (config.workerMode === 'appid' && queue.length === 0) {
    try {
      const discovery = await readDiscoveryIndex(config.discoveryFile);
      queue = Object.keys(discovery.games || {});
    } catch { /* discovery file may not exist */ }
  }
  const nextAppid = queue.length > 0 ? queue[worker.nextAppidIndex % queue.length] : '';
  const stopExists = fsSync.existsSync(config.workerStopFile);
  const lockExists = await isWorkerLockActive(config.workerLockFile);
  const cooldownActive = worker.cooldownUntil ? Date.parse(worker.cooldownUntil) > Date.now() : false;

  const appProgress = queue.map((appid) => {
    const item = worker.appids[String(appid)] || {};
    return {
      appid: String(appid),
      nextPage: item.nextPage || 1,
      imported: item.imported || 0,
      lastMatchedCount: item.lastMatchedCount ?? null,
      lastProcessedCount: item.lastProcessedCount ?? null,
    };
  });
  const feed = normalizeNewestFeedState(worker.feed);

  console.log(JSON.stringify({
    workerMode: config.workerMode,
    queue: queue.map(String),
    nextAppid,
    stopFilePresent: stopExists,
    workerLockActive: lockExists,
    cooldownActive,
    cooldownUntil: worker.cooldownUntil || null,
    cooldownUntilBeijing: cooldownActive ? formatBeijingDateTime(worker.cooldownUntil) : null,
    rateLimitFailures: worker.consecutiveRateFailures || 0,
    pausedByRateLimit: Boolean(worker.pausedByRateLimit),
    lastRunAt: worker.lastRunAt || null,
    lastRunAtBeijing: worker.lastRunAt ? formatBeijingDateTime(worker.lastRunAt) : null,
    lastError: worker.lastError?.message || null,
    appProgress,
    feedProgress: {
      nextPage: feed.nextPage || 1,
      imported: feed.imported || 0,
      lastMatchedCount: feed.lastMatchedCount ?? null,
      lastProcessedCount: feed.lastProcessedCount ?? null,
      lastDetailScannedCount: feed.lastDetailScannedCount ?? null,
    },
    configuredBatchSize: config.workerBatchSize,
    configuredPages: config.workerMode === 'feed' ? 1 : config.workerPages,
    configuredMaxDetailScans: config.workerMaxDetailScans,
    configuredLoopDelayMs: config.workerLoopDelayMs,
  }));
}

async function printWorkerLog(config) {
  try {
    const raw = await fs.readFile(config.workerLogFile, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-80);
    console.log(lines.join('\n'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('');
  }
}

function readConfig(args) {
  const steamId = args.steamId || process.env.STEAM_ID;
  const vaultDir = args.vault || process.env.OBSIDIAN_VAULT_DIR;
  if (!steamId) throw new Error('STEAM_ID is required. Set it in .env or pass --steam-id.');
  if (!vaultDir) throw new Error('OBSIDIAN_VAULT_DIR is required. Set it in .env or pass --vault.');

  const experienceDir = args.output || process.env.STEAM_EXPERIENCE_DIR || DEFAULT_EXPERIENCE_DIR;
  const statePath = args.state || process.env.STEAM_SYNC_STATE || DEFAULT_STATE_PATH;
  const discoveryPath = args.discoveryFile || process.env.STEAM_DISCOVERY_FILE || DEFAULT_DISCOVERY_PATH;
  const pendingWritesPath = args.pendingWritesFile || process.env.STEAM_PENDING_WRITES_FILE || DEFAULT_PENDING_WRITES_PATH;
  const requestDelayMs = parseNonNegativeInteger(args.requestDelayMs || process.env.STEAM_REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS);
  const workerLogPath = args.workerLog || process.env.STEAM_WORKER_LOG || '.obsidian/steam-experience-sync/worker.log';
  const workerStopPath = args.workerStop || process.env.STEAM_WORKER_STOP_FILE || '.obsidian/steam-experience-sync/stop-worker';
  const workerLockPath = args.workerLock || process.env.STEAM_WORKER_LOCK_FILE || '.obsidian/steam-experience-sync/worker.lock';
  const rateLimiterPath = args.rateLimiterFile || process.env.STEAM_RATE_LIMITER_FILE || '.obsidian/steam-experience-sync/rate-limiter.json';
  const adaptiveEnabled = !(args.noAdaptive || process.env.STEAM_NO_ADAPTIVE_RATE === '1');
  const workerMode = parseWorkerMode(args.workerMode || process.env.STEAM_WORKER_MODE || 'feed');

  return {
    steamId,
    vaultDir,
    steamApiKey: args.apiKey || process.env.STEAM_API_KEY || '',
    outputDir: path.resolve(vaultDir, fromVaultPath(experienceDir)),
    stateFile: path.resolve(vaultDir, fromVaultPath(statePath)),
    discoveryFile: path.resolve(vaultDir, fromVaultPath(discoveryPath)),
    pendingWritesFile: path.resolve(vaultDir, fromVaultPath(pendingWritesPath)),
    pages: parseCount(args.pages || process.env.STEAM_LOOKBACK_PAGES || 1),
    startPage: parseCount(args.startPage || process.env.STEAM_START_PAGE || 1),
    limit: parseCount(args.limit || process.env.STEAM_LIMIT || 20),
    maxMatches: parseCount(args.maxMatches || process.env.STEAM_MAX_MATCHES || 'all'),
    maxGames: parseCount(args.maxGames || process.env.STEAM_MAX_GAMES || 'all'),
    requestDelayMs,
    pageDelayMs: parseNonNegativeInteger(args.pageDelayMs || process.env.STEAM_PAGE_DELAY_MS || requestDelayMs),
    appids: parseList(args.appid || args.appids || process.env.STEAM_APPIDS || ''),
    worker: Boolean(args.worker),
    workerLoop: Boolean(args.workerLoop),
    workerMode,
    workerAppids: parseList(args.workerAppids || process.env.STEAM_WORKER_APPIDS || process.env.STEAM_SYNC_APPIDS || ''),
    workerBatchSize: parseCount(args.workerBatchSize || process.env.STEAM_WORKER_BATCH_SIZE || 5),
    workerPages: parseCount(args.workerPages || process.env.STEAM_WORKER_PAGES || 3),
    workerMaxDetailScans: parsePositiveInteger(args.workerMaxDetailScans || process.env.STEAM_WORKER_MAX_DETAIL_SCANS, 3),
    workerCooldownOn429Ms: parseNonNegativeInteger(args.workerCooldownOn429Ms || process.env.STEAM_WORKER_COOLDOWN_ON_429_MS || DEFAULT_WORKER_COOLDOWN_ON_429_MS),
    workerLoopDelayMs: parseNonNegativeInteger(args.workerLoopDelayMs || process.env.STEAM_WORKER_LOOP_DELAY_MS || DEFAULT_WORKER_LOOP_DELAY_MS),
    workerLogFile: path.resolve(vaultDir, fromVaultPath(workerLogPath)),
    workerStopFile: path.resolve(vaultDir, fromVaultPath(workerStopPath)),
    workerLockFile: path.resolve(vaultDir, fromVaultPath(workerLockPath)),
    rateLimiterFile: path.resolve(vaultDir, fromVaultPath(rateLimiterPath)),
    adaptiveEnabled,
    resync: Boolean(args.resync),
    dryRun: Boolean(args.dryRun),
  };
}

function getRequestDelay(config) {
  if (config.adaptiveEnabled && config.rateLimiter) {
    return computeRequestDelay(config.rateLimiter);
  }
  return config.requestDelayMs;
}

function getPageDelay(config) {
  if (config.adaptiveEnabled && config.rateLimiter) {
    return computePageDelay(config.rateLimiter);
  }
  return config.pageDelayMs;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--resync') out.resync = true;
    else if (arg === '--worker') out.worker = true;
    else if (arg === '--worker-loop') out.workerLoop = true;
    else if (arg === '--stop-worker') out.stopWorker = true;
    else if (arg === '--clear-worker-stop') out.clearWorkerStop = true;
    else if (arg === '--worker-status') out.workerStatus = true;
    else if (arg === '--worker-status-json') out.workerStatusJson = true;
    else if (arg === '--worker-log-tail') out.workerLogTail = true;
    else if (arg === '--no-adaptive') out.noAdaptive = true;
    else if (arg === '--discover') out.discover = true;
    else if (arg === '--read-discovery') out.readDiscovery = true;
    else if (arg === '--read-pending') out.readPending = true;
    else if (arg === '--plan-writes') out.planWrites = true;
    else if (arg === '--apply-pending') out.applyPending = true;
    else if (arg === '--clear-pending') out.clearPending = true;
    else if (arg === '--all') {
      out.pages = 'all';
      out.limit = 'all';
    }
    else if (arg === '--steam-id') out.steamId = argv[++i];
    else if (arg === '--api-key') out.apiKey = argv[++i];
    else if (arg === '--vault') out.vault = argv[++i];
    else if (arg === '--output') out.output = argv[++i];
    else if (arg === '--state') out.state = argv[++i];
    else if (arg === '--discovery-file') out.discoveryFile = argv[++i];
    else if (arg === '--pending-writes-file') out.pendingWritesFile = argv[++i];
    else if (arg === '--appid') out.appid = argv[++i];
    else if (arg === '--appids') out.appids = argv[++i];
    else if (arg === '--worker-appids') out.workerAppids = argv[++i];
    else if (arg === '--worker-mode') out.workerMode = argv[++i];
    else if (arg === '--pages') out.pages = argv[++i];
    else if (arg === '--start-page') out.startPage = argv[++i];
    else if (arg === '--limit') out.limit = argv[++i];
    else if (arg === '--max-matches') out.maxMatches = argv[++i];
    else if (arg === '--max-games') out.maxGames = argv[++i];
    else if (arg === '--worker-batch-size') out.workerBatchSize = argv[++i];
    else if (arg === '--worker-pages') out.workerPages = argv[++i];
    else if (arg === '--worker-max-detail-scans') out.workerMaxDetailScans = argv[++i];
    else if (arg === '--worker-cooldown-on-429-ms') out.workerCooldownOn429Ms = argv[++i];
    else if (arg === '--worker-loop-delay-ms') out.workerLoopDelayMs = argv[++i];
    else if (arg === '--worker-log') out.workerLog = argv[++i];
    else if (arg === '--worker-stop-file') out.workerStop = argv[++i];
    else if (arg === '--worker-lock-file') out.workerLock = argv[++i];
    else if (arg === '--rate-limiter-file') out.rateLimiterFile = argv[++i];
    else if (arg === '--request-delay-ms') out.requestDelayMs = argv[++i];
    else if (arg === '--page-delay-ms') out.pageDelayMs = argv[++i];
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
  --worker           Run one low-frequency worker batch and exit
  --worker-loop      Keep running worker batches until stop file, cooldown, or error
  --stop-worker      Create stop file so future worker runs exit immediately
    --clear-worker-stop Remove worker stop file
  --worker-status    Print worker queue, page, cooldown, and stop status
  --worker-log-tail  Print recent worker log lines
  --discover         Scan public screenshots and update discovered-games index only
  --read-discovery   Print discovered games index as JSON
  --read-pending     Print pending write queue as JSON
  --plan-writes      Scan screenshots and save pending writes without changing notes
  --apply-pending    Write pending screenshots to notes and clear pending queue
  --clear-pending    Clear pending write queue without changing notes
  --all              Scan all public screenshot pages and write missing blocks
  --steam-id ID      Override STEAM_ID
  --api-key KEY      Override STEAM_API_KEY, avoid using this in shell history
  --vault PATH       Override OBSIDIAN_VAULT_DIR
    --output PATH      Vault-relative output directory
  --state PATH       Vault-relative state file
  --discovery-file PATH Vault-relative discovered games index
  --pending-writes-file PATH Vault-relative pending writes queue
  --appid ID         Only write screenshots from one Steam appid
  --appids IDS       Only write screenshots from comma-separated Steam appids
  --worker-appids IDS Appid queue for worker mode
  --worker-mode MODE feed or appid, default feed
  --pages N          Screenshot list pages to scan
  --start-page N     Screenshot list page to start from
  --limit N          Max new screenshots to process
  --max-matches N    Stop after N matching screenshots are written or previewed
  --max-games N      Auto-select up to N games when --appid/--appids is not set
  --worker-batch-size N Stop a worker run after N matching screenshots, default 5
  --worker-pages N   Screenshot list pages per worker run, default 3
  --worker-max-detail-scans N Max screenshot detail pages checked per worker run, default 3
  --worker-cooldown-on-429-ms N Cooldown after 429, default 8 hours
  --worker-loop-delay-ms N Delay between worker loop rounds, default 60s
  --worker-log PATH  Vault-relative worker log path
  --worker-stop-file PATH Vault-relative worker stop file
  --worker-lock-file PATH Vault-relative worker lock file
  --rate-limiter-file PATH Vault-relative adaptive limiter state path
  --no-adaptive      Disable adaptive rate limiter for this run
  --request-delay-ms Delay between screenshot detail requests, default 1200
  --page-delay-ms    Delay between screenshot list page requests, default request delay
  --since-id ID      Only process screenshots newer than this id in the current list
`);
}

async function* collectScreenshotIdPages(config) {
  const seen = new Set();
  const allPages = config.pages === 'all';
  const startPage = config.startPage || 1;
  const pageLimit = allPages ? 200 : startPage + config.pages - 1;
  for (let page = startPage; page <= pageLimit; page += 1) {
    if (page > startPage) {
      const delayMs = getPageDelay(config);
      if (delayMs > 0) await sleep(delayMs);
    }

    const url = `https://steamcommunity.com/profiles/${config.steamId}${SCREENSHOT_LIST_PATH}?p=${page}&sort=newest&l=english`;
    const html = await fetchText(url);
    const matches = html.matchAll(/sharedfiles\/filedetails\/\?id=(\d+)|data-publishedfileid="(\d+)"/g);
    const ids = [];
    for (const match of matches) {
      const id = match[1] || match[2];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (shouldStopScreenshotPagination(ids)) break;
    yield { page, ids };
  }
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
      worker: parsed.worker || null,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { seenPublishedFileIds: [], updatedAt: null, worker: null };
  }
}

async function writeState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function normalizeWorkerState(value) {
  return {
    nextAppidIndex: Number.isInteger(value?.nextAppidIndex) ? value.nextAppidIndex : 0,
    cooldownUntil: value?.cooldownUntil || null,
    lastRunAt: value?.lastRunAt || null,
    lastError: value?.lastError || null,
    consecutiveFailures: Number(value?.consecutiveFailures || 0),
    consecutiveRateFailures: Number(value?.consecutiveRateFailures || 0),
    lastRateFailureAt: value?.lastRateFailureAt || null,
    pausedByRateLimit: Boolean(value?.pausedByRateLimit),
    appids: value?.appids && typeof value.appids === 'object' ? value.appids : {},
    feed: normalizeNewestFeedState(
      value?.feed && typeof value.feed === 'object' ? value.feed : {},
    ),
  };
}

async function writeWorkerLog(config, entry) {
  if (config.dryRun) return;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...entry,
  });
  await fs.mkdir(path.dirname(config.workerLogFile), { recursive: true });
  await fs.appendFile(config.workerLogFile, line + '\n', 'utf8');
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
  const networkRetryAfterMs = settings.networkRetryAfterMs ?? 5000;
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;

      const waitMs = networkRetryAfterMs * attempt;
      console.warn(`Steam request failed (${error.message}); waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${maxAttempts}.`);
      await sleep(waitMs);
      continue;
    }

    if (response.ok) {
      if (globalRateLimiter) globalRateLimiter = recordSuccess(globalRateLimiter);
      return response;
    }

    lastResponse = response;
    if (globalRateLimiter) {
      if (response.status === 429) {
        globalRateLimiter = record429(globalRateLimiter);
      } else if (shouldRetry(response.status)) {
        globalRateLimiter = record5xx(globalRateLimiter);
      }
    }

    if (!shouldRetry(response.status) || attempt === maxAttempts) break;

    const waitMs = retryAfterMs(response) ?? DEFAULT_RETRY_AFTER_MS * attempt;
    console.warn(`Steam request ${response.status}; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${maxAttempts}.`);
    await sleep(waitMs);
  }

  if (throwOnError) {
    if (lastError) throw new SteamNetworkError(lastError, url);
    throw new HttpStatusError(lastResponse.status, lastResponse.statusText, url);
  }
  return lastResponse;
}

class SteamNetworkError extends Error {
  constructor(error, url) {
    super(`${error.message} for ${url}`);
    this.name = 'SteamNetworkError';
    this.status = null;
    this.url = url;
    this.cause = error;
  }
}

class HttpStatusError extends Error {
  constructor(status, statusText, url) {
    super(`${status} ${statusText} for ${url}`);
    this.name = 'HttpStatusError';
    this.status = status;
    this.url = url;
  }
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

function serializeErrorDetails(error) {
  const cause = error?.cause || {};
  return {
    name: error?.name || null,
    code: error?.code || cause.code || null,
    errno: error?.errno || cause.errno || null,
    syscall: error?.syscall || cause.syscall || null,
    hostname: error?.hostname || cause.hostname || null,
    causeMessage: cause.message || null,
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

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function parseWorkerMode(value) {
  return value === 'appid' ? 'appid' : 'feed';
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

function formatBeijingDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')} 北京时间`;
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
