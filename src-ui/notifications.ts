import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export async function notifyPausedByRateLimit() {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === 'granted';
  }

  if (granted) {
    sendNotification({
      title: 'Steam Experience Sync 已暂停',
      body: '连续 3 次触发限流或风控，已暂停同步。',
    });
  }
}
