import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./notifications', () => ({
  notifyPausedByRateLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./tauriApi', () => ({
  applyPendingWrites: vi.fn().mockResolvedValue({ ok: true, message: 'applied' }),
  clearPendingWrites: vi.fn().mockResolvedValue({ ok: true, message: 'cleared' }),
  getLogs: vi.fn().mockResolvedValue(''),
  getStatus: vi.fn().mockResolvedValue('ready'),
  planWrites: vi.fn().mockResolvedValue({ ok: true, message: 'planned' }),
  readConfig: vi.fn().mockResolvedValue({
    steamId: '',
    steamApiKey: '',
    vaultDir: '',
    speedMode: 'balanced',
    previewMode: 'confirm_each_run',
    requestDelayMs: 10000,
    pageDelayMs: 15000,
  }),
  readPendingWrites: vi.fn().mockResolvedValue({ items: [] }),
  startWorkerLoop: vi.fn().mockResolvedValue({ ok: true, message: 'started' }),
  stopWorker: vi.fn().mockResolvedValue({ ok: true, message: 'stopped' }),
  writeConfig: vi.fn().mockResolvedValue({ ok: true, message: 'saved' }),
}));

describe('App', () => {
  it('renders worker control buttons', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: '连续运行' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeTruthy();
  });
});
