import { invoke } from '@tauri-apps/api/core';

export type CommandResult = {
  ok: boolean;
  message: string;
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
