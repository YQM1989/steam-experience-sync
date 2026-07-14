import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const { MOCK_STATUS } = vi.hoisted(() => ({
  MOCK_STATUS: {
    workerMode: 'feed',
    queue: [],
    nextAppid: '',
    stopFilePresent: false,
    workerLockActive: false,
    cooldownActive: false,
    cooldownUntil: null,
    cooldownUntilBeijing: null,
    rateLimitFailures: 0,
    pausedByRateLimit: false,
    lastRunAt: null,
    lastRunAtBeijing: null,
    lastError: null,
    appProgress: [],
    feedProgress: {
      nextPage: 1,
      imported: 0,
      lastMatchedCount: null,
      lastProcessedCount: null,
      lastDetailScannedCount: null,
    },
    configuredBatchSize: 5,
    configuredPages: 3,
    configuredMaxDetailScans: 3,
    configuredLoopDelayMs: 10000,
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('./notifications', () => ({
  notifyPausedByRateLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./tauriApi', () => ({
  applyPendingWrites: vi.fn().mockResolvedValue({ ok: true, message: 'applied' }),
  clearPendingWrites: vi.fn().mockResolvedValue({ ok: true, message: 'cleared' }),
  getLogs: vi.fn().mockResolvedValue(''),
  getStatus: vi.fn().mockResolvedValue(MOCK_STATUS),
  planWrites: vi.fn().mockResolvedValue({ ok: true, message: 'planned' }),
  readDiscoveryIndex: vi.fn().mockResolvedValue({ games: {} }),
  readConfig: vi.fn().mockResolvedValue({
    steamId: '',
    steamApiKey: '',
    vaultDir: '',
    speedMode: 'balanced',
    previewMode: 'confirm_each_run',
    requestDelayMs: 30000,
    pageDelayMs: 60000,
    workerLoopDelayMs: 60000,
    workerMaxDetailScans: 3,
    workerMode: 'feed',
  }),
  readPendingWrites: vi.fn().mockResolvedValue({ items: [] }),
  startWorkerLoop: vi.fn().mockResolvedValue({ ok: true, message: 'started' }),
  stopWorker: vi.fn().mockResolvedValue({ ok: true, message: 'stopped' }),
  writeConfig: vi.fn().mockResolvedValue({ ok: true, message: 'saved' }),
}));

describe('App', () => {
  it('renders navigation tabs and worker control buttons', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Queue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '连续运行' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeTruthy();
  });
});
