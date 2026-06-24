import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./tauriApi', () => ({
  getLogs: vi.fn().mockResolvedValue(''),
  getStatus: vi.fn().mockResolvedValue('ready'),
  startWorkerLoop: vi.fn().mockResolvedValue({ ok: true, message: 'started' }),
  stopWorker: vi.fn().mockResolvedValue({ ok: true, message: 'stopped' }),
}));

describe('App', () => {
  it('renders worker control buttons', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: '连续运行' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新状态' })).toBeTruthy();
  });
});
