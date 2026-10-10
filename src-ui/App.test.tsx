import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  getLogs: vi.fn().mockResolvedValue(''),
  getStatus: vi.fn().mockResolvedValue(MOCK_STATUS),
  readDiscoveryIndex: vi.fn().mockResolvedValue({ games: {} }),
  readConfig: vi.fn().mockResolvedValue({
    steamId: '',
    steamApiKey: '',
    vaultDir: '',
    speedMode: 'balanced',
    requestDelayMs: 30000,
    pageDelayMs: 60000,
    workerLoopDelayMs: 60000,
    workerMaxDetailScans: 3,
    workerMode: 'feed',
  }),
  startWorkerLoop: vi.fn().mockResolvedValue({ ok: true, message: 'started' }),
  stopWorker: vi.fn().mockResolvedValue({ ok: true, message: 'stopped' }),
  writeConfig: vi.fn().mockResolvedValue({ ok: true, message: 'saved' }),
  switchAction: vi.fn().mockImplementation(async (action: string) => action === 'status' ? { configured: false, running: false, imported: 0, games: [] } : ''),
}));

afterEach(cleanup);

describe('App', () => {
  it('renders navigation tabs and worker control buttons', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Queue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始同步' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeTruthy();
  });

  it('switches platforms without replacing Steam settings or controls', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch 2' }));
    expect(await screen.findByRole('heading', { name: 'Switch 游戏回忆' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '开始同步' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^停止$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByLabelText('导出的相册目录')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Steam' }));
    expect(await screen.findByLabelText('Steam API Key')).toBeTruthy();
  });
});
