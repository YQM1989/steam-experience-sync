import { describe, expect, it, vi } from 'vitest';
import { notifyPausedByRateLimit } from './notifications';

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  sendNotification: mocks.sendNotification,
}));

describe('notifyPausedByRateLimit', () => {
  it('sends a pause notification when permission is granted', async () => {
    await notifyPausedByRateLimit();

    expect(mocks.sendNotification).toHaveBeenCalledWith({
      title: 'Steam Experience Sync 已暂停',
      body: '连续 3 次触发限流或风控，已暂停同步。',
    });
  });
});
