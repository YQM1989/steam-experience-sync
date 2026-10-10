// SPDX-License-Identifier: AGPL-3.0-or-later
// Storage/privacy adapter for the separately bundled, unchanged nxapi CLI.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/nxapi-client');
const require = createRequire(path.join(helper, 'package.json'));
const values = new Map(Array.isArray(input.cache) ? input.cache : []);
values.set('SelectedUser', 'desktop-account');
values.set('NintendoAccountToken.desktop-account', input.sessionToken);
delete input.sessionToken;
require('node-persist').create = (options) => ({
  options,
  async init() { return options; },
  async getItem(key) { return values.get(key); },
  async setItem(key, value) {
    values.set(key, key.startsWith('RateLimitAttempts-') && Array.isArray(value)
      ? value.map((entry) => typeof entry === 'number' ? { time: entry } : { time: entry.time }) : value);
    return { key };
  },
  async removeItem(key) { values.delete(key); },
});
// Account settings and debugging must not be inherited from another nxapi installation.
require('dotenv').config = () => ({ parsed: {} });
const { default: envPaths } = await import(pathToFileURL(require.resolve('env-paths')));
const externalCache = envPaths('nxapi').cache;
const ownCache = path.join(path.dirname(process.env.NXAPI_DATA_PATH), 'nxapi-public-cache');
const fsp = require('node:fs/promises');
const redirectCache = (target) => typeof target === 'string' && (target === externalCache || target.startsWith(externalCache + path.sep))
  ? path.join(ownCache, path.relative(externalCache, target)) : target;
for (const method of ['readFile', 'writeFile', 'mkdir']) {
  const original = fsp[method];
  fsp[method] = (target, ...args) => original(redirectCache(target), ...args);
}
syncBuiltinESMExports();
const codes = new Set(['invalid_request', 'invalid_grant', 'invalid_client', 'invalid_token', 'insufficient_scope', 'incompatible_client', 'unsupported_version', 'unsupported_platform', 'unauthorised', 'unauthorized_client', 'request_parameter_not_set', 'unsupported_grant_type', 'service_unavailable']);
const stages = new Map([
  ['/connect/1.0.0/api/token', 'Nintendo 账号授权'], ['/2.0.0/users/me', 'Nintendo 账号资料'],
  ['/api/oauth/token', '认证服务登录'], ['/api/znca/f', '相册认证'],
  ['/v4/Account/Login', 'Nintendo 相册登录'], ['/v4/Media/List', '相册列表'],
  ['/api/znca/encrypt-request', '相册请求加密'], ['/api/znca/decrypt-response', '相册响应解密'],
]);
const trace = (data) => process.stderr.write('__SWITCH_DIAGNOSTIC__' + JSON.stringify(data) + '\n');
const undici = require('undici');
const originalFetch = undici.fetch;
undici.fetch = async (url, options) => {
  const address = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
  const stage = stages.get(address.pathname) || '客户端服务配置';
  try {
    const response = await originalFetch(url, options);
    let code;
    if (!response.ok && response.headers.get('content-type')?.includes('json')) {
      const data = await response.clone().json().catch(() => null);
      if (codes.has(data?.error)) code = data.error;
    }
    const seconds = Number(response.headers.get('retry-after'));
    trace({ stage, status: response.status, ...(code ? { code } : {}), ...(response.status === 429 && seconds > 0 && seconds < 86400 ? { retryAfterSeconds: seconds } : {}) });
    return response;
  } catch (error) {
    trace({ stage, networkError: true });
    throw error;
  }
};

// The album command fetches six unrelated resources and discards their results.
// Narrow those calls inside this album-only child; retain the upstream auth/media protocol.
const { default: CoralApi, AbstractCoralApi } = await import(pathToFileURL(path.join(helper, 'node_modules/nxapi/dist/api/coral.js')));
for (const method of ['getFriendList', 'getChats', 'getWebServices', 'getActiveEvent', 'getAnnouncements', 'getCurrentUser']) {
  AbstractCoralApi.prototype[method] = async () => undefined;
  CoralApi.prototype[method] = async () => undefined;
}
let emitted = false;
process.on('beforeExit', () => {
  if (emitted) return;
  emitted = true;
  process.stdout.write('__SWITCH_PRIVATE_CACHE__' + JSON.stringify([...values.entries()]) + '\n');
});
