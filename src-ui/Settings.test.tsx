import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';

vi.mock('./tauriApi', () => ({
  readConfig: vi.fn().mockResolvedValue({
    steamId: '',
    steamApiKey: '',
    vaultDir: '',
    speedMode: 'balanced',
    previewMode: 'confirm_each_run',
    requestDelayMs: 10000,
    pageDelayMs: 15000,
  }),
  writeConfig: vi.fn().mockResolvedValue({ ok: true, message: 'saved' }),
}));

describe('Settings', () => {
  it('renders Steam API key as password input', async () => {
    render(<Settings />);

    const input = await screen.findByLabelText('Steam API Key');

    expect(input.getAttribute('type')).toBe('password');
  });
});
