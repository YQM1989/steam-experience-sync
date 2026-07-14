import { invoke } from '@tauri-apps/api/core';

export type CommandResult = {
  ok: boolean;
  message: string;
};

export type WorkerAppProgress = {
  appid: string;
  nextPage: number;
  imported: number;
  lastMatchedCount: number | null;
  lastProcessedCount: number | null;
};

export type WorkerStatus = {
  workerMode: 'feed' | 'appid';
  queue: string[];
  nextAppid: string;
  stopFilePresent: boolean;
  workerLockActive: boolean;
  cooldownActive: boolean;
  cooldownUntil: string | null;
  cooldownUntilBeijing: string | null;
  rateLimitFailures: number;
  pausedByRateLimit: boolean;
  lastRunAt: string | null;
  lastRunAtBeijing: string | null;
  lastError: string | null;
  appProgress: WorkerAppProgress[];
  feedProgress: {
    nextPage: number;
    imported: number;
    lastMatchedCount: number | null;
    lastProcessedCount: number | null;
    lastDetailScannedCount: number | null;
  };
  configuredBatchSize: number;
  configuredPages: number;
  configuredMaxDetailScans: number;
  configuredLoopDelayMs: number;
};

export type GuiConfig = {
  steamId: string;
  steamApiKey: string;
  vaultDir: string;
  speedMode: string;
  previewMode: string;
  requestDelayMs: number;
  pageDelayMs: number;
  workerLoopDelayMs: number;
  workerMaxDetailScans: number;
  workerMode: 'feed' | 'appid';
};

export type PendingWrite = {
  id: string;
  appid: string;
  game: string;
  date?: string;
  caption?: string;
  image?: string;
  targetFile?: string;
  url?: string;
};

export type PendingWrites = {
  createdAt?: string;
  outputDir?: string;
  items: PendingWrite[];
};

export type DiscoveredGame = {
  appid: string;
  name: string;
  screenshotIds?: string[];
  lastSeenAt?: string;
};

export type DiscoveryIndex = {
  games: Record<string, DiscoveredGame>;
};

export async function getStatus(): Promise<WorkerStatus> {
  const raw = await invoke<string>('get_status');
  return JSON.parse(raw) as WorkerStatus;
}

export async function getLogs(): Promise<string> {
  return invoke<string>('get_logs');
}

export async function startWorkerLoop(): Promise<CommandResult> {
  return invoke<CommandResult>('start_worker_loop');
}

export async function stopWorker(): Promise<CommandResult> {
  return invoke<CommandResult>('stop_worker');
}

export async function readPendingWrites(): Promise<PendingWrites> {
  const raw = await invoke<string>('read_pending_writes');
  return JSON.parse(raw) as PendingWrites;
}

export async function planWrites(): Promise<CommandResult> {
  return invoke<CommandResult>('plan_writes');
}

export async function applyPendingWrites(): Promise<CommandResult> {
  return invoke<CommandResult>('apply_pending_writes');
}

export async function clearPendingWrites(): Promise<CommandResult> {
  return invoke<CommandResult>('clear_pending_writes');
}

export async function readDiscoveryIndex(): Promise<DiscoveryIndex> {
  const raw = await invoke<string>('read_discovery_index');
  return JSON.parse(raw) as DiscoveryIndex;
}

export async function readConfig(): Promise<GuiConfig> {
  const raw = await invoke<string>('read_config');
  return JSON.parse(raw) as GuiConfig;
}

export async function writeConfig(config: GuiConfig): Promise<CommandResult> {
  return invoke<CommandResult>('write_config', { payload: JSON.stringify(config) });
}
