import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Queue } from './Queue';

vi.mock('./tauriApi', () => ({
  readDiscoveryIndex: vi.fn().mockResolvedValue({
    games: {
      '2358720': {
        appid: '2358720',
        name: 'Black Myth: Wukong',
        screenshotIds: ['3739717708', '3739718445'],
        lastSeenAt: '2024-09-30T01:04:00.000Z',
      },
    },
  }),
}));

describe('Queue', () => {
  it('renders discovered games with screenshot counts', async () => {
    render(<Queue />);

    expect(await screen.findByText('Black Myth: Wukong')).toBeTruthy();
    expect(screen.getByText('2 张截图')).toBeTruthy();
  });
});
