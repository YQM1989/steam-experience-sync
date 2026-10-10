export const SAFE_REQUEST_DELAY_MS = 30000;
export const SAFE_PAGE_DELAY_MS = 60000;
export const SAFE_WORKER_LOOP_DELAY_MS = 60000;

export const DEFAULT_GUI_CONFIG = {
  steamId: '',
  steamApiKey: '',
  vaultDir: '',
  experienceDir: '00_输入源/50_我是谁/Steam体验记录',
  statePath: '.obsidian/steam-experience-sync/state.json',
  workerLogPath: '.obsidian/steam-experience-sync/worker.log',
  stopWorkerPath: '.obsidian/steam-experience-sync/stop-worker',
  requestDelayMs: SAFE_REQUEST_DELAY_MS,
  pageDelayMs: SAFE_PAGE_DELAY_MS,
  workerLoopDelayMs: SAFE_WORKER_LOOP_DELAY_MS,
  workerPages: 3,
  workerMaxScreenshots: 20,
  workerMaxDetailScans: 3,
  workerMode: 'feed',
  speedMode: 'balanced',
  switch: {
    source: 'local',
    nxapiClientId: '',
    nxapiClientVersion: '',
    thirdPartyConsent: false,
    albumDir: '',
    experienceDir: '00_输入源/50_我是谁/Switch体验记录',
    attachmentDir: '附件/Switch体验记录',
    filenameTimezone: '+08:00',
    games: {},
  },
};

export function normalizeGuiConfig(input = {}) {
  const { previewMode: _legacyPreviewMode, ...rest } = input;
  const switchInput = input.switch || {};
  return {
    ...DEFAULT_GUI_CONFIG,
    ...rest,
    switch: {
      ...DEFAULT_GUI_CONFIG.switch,
      ...switchInput,
      games: switchInput.games || {},
    },
    requestDelayMs: numberAtLeast(input.requestDelayMs, SAFE_REQUEST_DELAY_MS),
    pageDelayMs: numberAtLeast(input.pageDelayMs, SAFE_PAGE_DELAY_MS),
    workerLoopDelayMs: numberAtLeast(input.workerLoopDelayMs, SAFE_WORKER_LOOP_DELAY_MS),
    workerPages: Number(input.workerPages || DEFAULT_GUI_CONFIG.workerPages),
    workerMaxScreenshots: Number(input.workerMaxScreenshots || DEFAULT_GUI_CONFIG.workerMaxScreenshots),
    workerMaxDetailScans: Number(input.workerMaxDetailScans || DEFAULT_GUI_CONFIG.workerMaxDetailScans),
    workerMode: normalizeWorkerMode(input.workerMode),
  };
}

export function normalizeWorkerMode(value) {
  return value === 'appid' ? 'appid' : 'feed';
}

function numberAtLeast(value, minimum) {
  const parsed = Number(value || minimum);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, parsed);
}
