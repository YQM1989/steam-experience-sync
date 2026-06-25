import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Preview } from './Preview';

vi.mock('./tauriApi', () => ({
  applyPendingWrites: vi.fn().mockResolvedValue({ ok: true, message: 'applied' }),
  clearPendingWrites: vi.fn().mockResolvedValue({ ok: true, message: 'cleared' }),
  planWrites: vi.fn().mockResolvedValue({ ok: true, message: 'planned' }),
  readPendingWrites: vi.fn().mockResolvedValue({
    items: [
      {
        id: '3739717708',
        appid: '2358720',
        game: 'Black Myth: Wukong',
        date: '2024-09-30',
        caption: '沙大郎？傻大郎！',
        image: 'https://example.com/screenshot.jpg',
        targetFile: 'D:/YQM-Obsidian/Steam体验记录/Black Myth_ Wukong.md',
      },
    ],
  }),
}));

describe('Preview', () => {
  it('renders pending write details and actions', async () => {
    render(<Preview />);

    expect(await screen.findByText('Black Myth: Wukong')).toBeTruthy();
    expect(screen.getByText('沙大郎？傻大郎！')).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认写入' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '跳过本轮' })).toBeTruthy();
  });
});
