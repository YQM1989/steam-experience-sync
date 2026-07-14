import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';

vi.mock('./tauriApi', () => ({
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
  writeConfig: vi.fn().mockResolvedValue({ ok: true, message: 'saved' }),
}));

afterEach(() => {
  cleanup();
});

describe('Settings', () => {
  it('renders Steam API key as password input', async () => {
    render(<Settings />);

    const input = await screen.findByLabelText('Steam API Key');

    expect(input.getAttribute('type')).toBe('password');
  });

  it('renders worker max detail scans as a numeric setting', async () => {
    render(<Settings />);

    const input = await screen.findByLabelText('每轮最多检查截图详情数');

    expect(input.getAttribute('type')).toBe('number');
    expect((input as HTMLInputElement).value).toBe('3');
  });

  it('renders worker mode selector with screenshot feed as default', async () => {
    render(<Settings />);

    const option = await screen.findByRole('option', { name: '截图流优先' });

    expect((option as HTMLOptionElement).selected).toBe(true);
  });
});
