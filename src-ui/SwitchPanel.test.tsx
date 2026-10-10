import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SwitchPanel } from './SwitchPanel';
import '@testing-library/jest-dom/vitest';

const { action, loadConfig } = vi.hoisted(() => ({ action: vi.fn(), loadConfig: vi.fn().mockResolvedValue({ vaultDir: '/fixture/vault', switch: { source: 'account', nxapiClientId: 'fixture-client', nxapiClientVersion: 'fixture-compat', thirdPartyConsent: false, games: {} } }) }));
vi.mock('./tauriApi', () => ({
  readConfig: loadConfig,
  switchAction: action,
}));
afterEach(() => { cleanup(); action.mockReset(); });

it('requires visible service consent before starting Nintendo login and handles callback locally', async () => {
  action.mockImplementation(async (name: string) => {
    if (name === 'status') return { configured: true, imported: 0, games: [], running: false };
    if (name === 'account-status') return { connected: false, pending: action.mock.calls.some(([call]) => call === 'login-start') };
    return { ok: true, message: 'fixture complete' };
  });
  render(<SwitchPanel tab="settings" />);
  const start = await screen.findByRole('button', { name: '打开 Nintendo 登录' });
  expect(screen.queryByLabelText('nxapi 兼容标识（服务签发）')).toBeNull();
  expect(start).toBeDisabled();
  expect(action.mock.calls.some(([name]) => name === 'login-start')).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: '我同意使用上述第三方认证服务' }));
  expect(start).toBeEnabled();
  fireEvent.click(start);
  const callback = await screen.findByLabelText('本次授权完成链接');
  fireEvent.change(callback, { target: { value: 'fixture-callback-only' } });
  fireEvent.click(screen.getByRole('button', { name: '完成账号连接' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith('login-finish', { callback: 'fixture-callback-only' }));
  await waitFor(() => expect(callback).toHaveValue(''));
  expect(action.mock.calls.find(([name]) => name === 'save-settings')?.[1]).toMatchObject({ switch: { thirdPartyConsent: true } });
});

it('uses an existing Nintendo login without requiring custom client registration', async () => {
  loadConfig.mockResolvedValueOnce({ vaultDir: '/fixture/vault', switch: { source: 'account', nxapiClientId: 'fixture-client', nxapiClientVersion: '', thirdPartyConsent: true, games: {} } });
  action.mockImplementation(async (name: string) => name === 'account-status' ? { connected: false, sessionAuthorised: true, pending: false } : name === 'status' ? { configured: true, games: [], running: false, imported: 0 } : '');
  render(<SwitchPanel tab="settings" />);
  expect(await screen.findByText(/账号授权已保存，可验证连接或开始同步/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新连接 Nintendo 账号' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '验证账号连接' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '移除本机登录信息' })).toBeEnabled();
  expect(action.mock.calls.some(([name]) => name === 'login-start')).toBe(false);
});

it('verifies the album with saved settings and the existing session, without login or import', async () => {
  loadConfig.mockResolvedValueOnce({ vaultDir: '/fixture/vault', switch: { source: 'account', nxapiClientId: 'fixture-client', nxapiClientVersion: 'fixture-compat', thirdPartyConsent: true, games: {} } });
  action.mockImplementation(async (name: string) => name === 'account-status' ? { connected: false, sessionAuthorised: true, pending: false } : name === 'status' ? { configured: true, games: [], running: false, imported: 0 } : name === 'preview' ? { total: 2, games: [], skipped: [] } : { ok: true, message: 'saved' });
  render(<SwitchPanel tab="settings" />);
  const verify = await screen.findByRole('button', { name: '验证账号连接' });
  await waitFor(() => expect(verify).toBeEnabled());
  fireEvent.click(verify);
  expect(await screen.findByText(/相册读取成功，共 2 项素材/)).toBeTruthy();
  expect(action.mock.calls.find(([name]) => name === 'save-settings')?.[1]).toMatchObject({ switch: { nxapiClientVersion: 'fixture-compat' } });
  expect(action.mock.calls.some(([name]) => ['login-start', 'sync'].includes(name))).toBe(false);
});

it('shows incomplete album auth separately and lets the user remove a partial login', async () => {
  action.mockImplementation(async (name: string) => name === 'account-status' ? { connected: false, sessionAuthorised: true, pending: false } : name === 'status' ? { configured: true, games: [], running: false, imported: 0 } : '');
  render(<SwitchPanel tab="settings" />);
  expect(await screen.findByText(/账号授权已保存，可验证连接或开始同步/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '移除本机登录信息' })).toBeEnabled();
});

it('runs incremental sync from one button, without a prerequisite album scan or second app', async () => {
  loadConfig.mockResolvedValueOnce({ vaultDir: '/fixture/vault', switch: { source: 'account', thirdPartyConsent: true, nxapiClientId: '', nxapiClientVersion: '', games: {} } });
  action.mockImplementation(async (name: string) => name === 'account-status' ? { connected: true, sessionAuthorised: true, pending: false } : name === 'status' ? { configured: true, games: [], running: false, imported: 32 } : name === 'sync' ? { ok: true, message: '同步完成' } : '');
  render(<SwitchPanel tab="dashboard" />);
  const sync = await screen.findByRole('button', { name: '开始同步' });
  await waitFor(() => expect(sync).toBeEnabled());
  fireEvent.click(sync);
  await screen.findByText('同步完成');
  expect(action.mock.calls.filter(([name]) => name === 'sync')).toHaveLength(1);
  expect(action.mock.calls.some(([name]) => ['preview', 'login-start', 'check-service'].includes(name))).toBe(false);
});
