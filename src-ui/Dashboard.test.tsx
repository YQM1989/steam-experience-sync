import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { WorkerStatus } from './tauriApi';

const baseStatus: WorkerStatus = {
  workerMode: 'feed',
  queue: ['2758000'],
  nextAppid: '2758000',
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
};

afterEach(() => {
  cleanup();
});

describe('Dashboard feed mode', () => {
  it('shows screenshot feed progress in feed mode', () => {
    renderDashboard({
      ...baseStatus,
      queue: [],
      nextAppid: '',
      feedProgress: {
        nextPage: 4,
        imported: 12,
        lastMatchedCount: 2,
        lastProcessedCount: 2,
        lastDetailScannedCount: 3,
      },
    });

    expect(screen.getByText('截图流进度')).toBeTruthy();
    expect(screen.getByText('扫描范围')).toBeTruthy();
    expect(screen.getByText('最新截图页')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });
});

describe('Dashboard worker lock', () => {
  it('shows when a worker lock is active', () => {
    renderDashboard({ ...baseStatus, workerLockActive: true });

    expect(screen.getByText('已有 worker 运行')).toBeTruthy();
  });
});

function renderDashboard(status: WorkerStatus = baseStatus, isWorkerRunning = false) {
  render(
    <Dashboard
      busy={false}
      isWorkerRunning={isWorkerRunning}
      liveOutput={[]}
      status={status}
      onRefresh={vi.fn()}
      onRunLoop={vi.fn()}
      onStop={vi.fn()}
    />,
  );
}

describe('Dashboard', () => {
  it('disables continuous run while worker is already running', () => {
    renderDashboard(baseStatus, true);

    const button = screen.getByRole('button', { name: '运行中...' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('explains that stop file pause can be resumed by continuous run', () => {
    renderDashboard({ ...baseStatus, stopFilePresent: true });

    expect(screen.getByText('已暂停，点击连续运行会清除停止标记并恢复')).toBeTruthy();
  });

  it('does not show an expired cooldown timestamp when cooldown is inactive', () => {
    renderDashboard({
      ...baseStatus,
      cooldownActive: false,
      cooldownUntil: '2026-06-25T23:35:45.510Z',
      cooldownUntilBeijing: null,
    });

    const cooldownItem = screen.getByText('冷却').closest('.status-item');
    expect(cooldownItem).toBeTruthy();
    expect(within(cooldownItem as HTMLElement).getByText('无')).toBeTruthy();
  });
});
