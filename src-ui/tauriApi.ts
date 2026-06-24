import { invoke } from '@tauri-apps/api/core';

export type CommandResult = {
  ok: boolean;
  message: string;
};

export type GuiConfig = {
  steamId: string;
  steamApiKey: string;
  vaultDir: string;
  speedMode: string;
  previewMode: string;
  requestDelayMs: number;
  pageDelayMs: number;
};

export async function getStatus(): Promise<string> {
  return invoke<string>('get_status');
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

export async function readConfig(): Promise<GuiConfig> {
  const raw = await invoke<string>('read_config');
  return JSON.parse(raw) as GuiConfig;
}

export async function writeConfig(config: GuiConfig): Promise<CommandResult> {
  return invoke<CommandResult>('write_config', { payload: JSON.stringify(config) });
}
