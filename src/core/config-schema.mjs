export const DEFAULT_GUI_CONFIG = {
  steamId: '',
  steamApiKey: '',
  vaultDir: '',
  experienceDir: '00_输入源/50_我是谁/Steam体验记录',
  statePath: '.obsidian/steam-experience-sync/state.json',
  workerLogPath: '.obsidian/steam-experience-sync/worker.log',
  stopWorkerPath: '.obsidian/steam-experience-sync/stop-worker',
  requestDelayMs: 10000,
  pageDelayMs: 15000,
  workerPages: 3,
  workerMaxScreenshots: 20,
  speedMode: 'balanced',
  previewMode: 'confirm_each_run',
};

export function normalizeGuiConfig(input = {}) {
  return {
    ...DEFAULT_GUI_CONFIG,
    ...input,
    requestDelayMs: Number(input.requestDelayMs || DEFAULT_GUI_CONFIG.requestDelayMs),
    pageDelayMs: Number(input.pageDelayMs || DEFAULT_GUI_CONFIG.pageDelayMs),
    workerPages: Number(input.workerPages || DEFAULT_GUI_CONFIG.workerPages),
    workerMaxScreenshots: Number(input.workerMaxScreenshots || DEFAULT_GUI_CONFIG.workerMaxScreenshots),
  };
}
