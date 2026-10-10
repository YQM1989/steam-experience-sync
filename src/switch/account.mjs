// Protocol reference: Dycool/NSO-Album-Sync (MIT), revision 4fc4915.
// Credentials are supplied by the native Keychain bridge, never the JSON config.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';
import { hashFile } from './archive.mjs';

const NINTENDO_CLIENT = '71b963c1b7b6d119';
const REDIRECT = `npf${NINTENDO_CLIENT}://auth`;
const CORAL = 'https://api-lp1.znc.srv.nintendo.net';
const ZNCA = 'https://nxapi-znca-api.fancy.org.uk/api/znca';
const NXAUTH = 'https://nxapi-auth.fancy.org.uk/api/oauth/token';
const AGENT = 'steam-experience-sync/0.1.0 (+https://github.com/YQM1989/game-memories)';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const REQUEST_STAGES = new Map([
  ['https://accounts.nintendo.com/connect/1.0.0/api/session_token', 'Nintendo 授权码兑换'],
  ['https://accounts.nintendo.com/connect/1.0.0/api/token', 'Nintendo 登录令牌兑换'],
  ['https://api.accounts.nintendo.com/2.0.0/users/me', 'Nintendo 账号资料读取'],
  [NXAUTH, 'nxapi 客户端认证'],
  [ZNCA + '/config', 'nxapi 服务配置读取'],
  [ZNCA + '/f', 'nxapi 相册登录认证参数'],
  [ZNCA + '/encrypt-request', 'nxapi 相册请求加密'],
  [ZNCA + '/decrypt-response', 'nxapi 相册响应解密'],
]);
const SAFE_ERROR_CODES = new Set(['invalid_request', 'invalid_grant', 'invalid_client', 'invalid_token', 'insufficient_scope', 'incompatible_client', 'unsupported_version', 'unsupported_platform', 'unauthorised', 'unauthorized_client', 'request_parameter_not_set', 'unsupported_grant_type']);
// Protocol support and the service-issued client identifier are separate values.
export const SUPPORTED_CORAL_VERSION = '3.5.0';
// The legacy header is only used for configuration discovery, never attestation.
const CONFIG_DISCOVERY_COMPATIBILITY = '3.0.3';

export function clientCompatibility(config) {
  const value = String(config.nxapiClientVersion || '').trim();
  if (value && !/^[a-zA-Z0-9_.-]{1,200}$/.test(value)) throw new Error('认证服务兼容配置无效。');
  return value;
}

export function requireClientCompatibility(config) {
  const value = clientCompatibility(config);
  if (!value) throw new Error('本应用尚缺少 nxapi 服务签发的兼容标识。请在 Switch 设置填写；已有 Nintendo 网页授权保留，无需重新登录。');
  if (/^\d+\.\d+\.\d+$/.test(value)) throw new Error('nxapi 兼容标识不能使用 Nintendo App 版本号或旧兼容值；请填写服务为本应用签发的标识。已有网页授权保留。');
  return value;
}

export function requireAccountConsent(config) {
  if (config.thirdPartyConsent !== true) throw new Error('请先阅读并主动同意第三方认证的数据流向，再连接 Nintendo 账号。');
  clientCompatibility(config);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(config.nxapiClientId || '')) throw new Error('请填写为本项目登记的 nxapi 客户端 ID；不要借用其他应用的身份。');
}

export function beginNintendoLogin(now = Date.now()) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL('https://accounts.nintendo.com/connect/1.0.0/authorize');
  url.search = new URLSearchParams({
    state, redirect_uri: REDIRECT, client_id: NINTENDO_CLIENT,
    scope: 'openid user user.birthday user.screenName', response_type: 'session_token_code',
    session_token_code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    session_token_code_challenge_method: 'S256', theme: 'login_form',
  }).toString();
  return { url: url.href, state, verifier, createdAt: now };
}

export function validateCallback(callback, pending, now = Date.now()) {
  if (!pending?.state || !pending?.verifier || now - pending.createdAt > 5 * 60 * 1000 || pending.createdAt > now) throw new Error('登录已过期，请重新打开 Nintendo 登录。');
  let url;
  try { url = new URL(callback.trim()); } catch { throw new Error('授权链接格式无效。'); }
  if (`${url.protocol}//${url.hostname}` !== REDIRECT) throw new Error('请粘贴 Nintendo 授权完成链接。');
  const params = new URLSearchParams(url.hash.slice(1) || url.search.slice(1));
  if (params.get('state') !== pending.state) throw new Error('授权链接不属于本次登录。');
  const code = params.get('session_token_code');
  if (!code) throw new Error('授权链接中没有授权码。');
  return code;
}

export function accountClient(config, credentials = {}, options = {}) {
  const request = options.fetch || fetch;
  const now = options.now || Date.now;
  const cache = { ...credentials };
  const compatibility = clientCompatibility(config);
  const zncaHeaders = (endpoint) => ({ 'X-znca-Platform': 'Android', ...(cache.version === SUPPORTED_CORAL_VERSION ? { 'X-znca-Version': cache.version } : {}), 'X-znca-Client-Version': endpoint === '/config' ? compatibility || CONFIG_DISCOVERY_COMPATIBILITY : requireClientCompatibility(config) });

  async function call(url, init = {}, parse = 'json') {
    if (cache.cooldownUntil > now()) throw new Error(`认证服务冷却中，请在 ${new Date(cache.cooldownUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 后重试。`);
    let response;
    try {
      response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': AGENT, Accept: parse === 'text' ? 'text/plain' : 'application/json', ...init.headers } });
    } catch { throw new Error('账号服务连接失败，请检查网络后重试。'); }
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const seconds = Number(retry);
      const date = Date.parse(retry || '');
      const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.isFinite(date) ? Math.max(date - now(), 1000) : 15 * 60 * 1000;
      cache.cooldownUntil = now() + wait;
      throw new Error('账号服务返回限流，已暂停自动请求并记录冷却时间。');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { cache.coralToken = ''; cache.coralExpiresAt = 0; }
      // Only report a known enum, never bodies/descriptions that may echo tokens.
      const body = await response.json().catch(() => ({}));
      const code = SAFE_ERROR_CODES.has(body?.error) ? body.error : '';
      const stage = REQUEST_STAGES.get(url) || '账号服务';
      cache.lastAuthError = { stage, status: response.status, code, at: new Date(now()).toISOString() };
      throw new Error(`${stage}失败（HTTP ${response.status}${code ? `，${code}` : ''}），未自动重试。`);
    }
    try { return parse === 'text' ? await response.text() : await response.json(); }
    catch { throw new Error('账号服务返回了无法解析的数据。'); }
  }

  const jsonPost = (url, body, headers = {}) => call(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });

  async function znca(endpoint, body, parse = 'json') {
    requireAccountConsent(config);
    const headers = zncaHeaders(endpoint);
    if (!cache.nxToken || cache.nxExpiresAt <= now()) {
      const auth = await call(NXAUTH, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.nxapiClientId, scope: 'ca:gf ca:er ca:dr' }).toString(),
      });
      if (!auth.access_token || !Number.isFinite(Number(auth.expires_in))) throw new Error('第三方服务认证响应不完整。');
      cache.nxToken = auth.access_token;
      cache.nxExpiresAt = now() + Number(auth.expires_in) * 1000;
    }
    const init = { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${cache.nxToken}`, ...headers } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return call(ZNCA + endpoint, init, parse);
  }

  async function version(refresh = false) {
    if (!refresh && cache.version === SUPPORTED_CORAL_VERSION && cache.versionExpiresAt > now()) return;
    const response = await znca('/config');
    if (!response.nso_version) throw new Error('第三方服务没有提供支持的 Nintendo App 版本。');
    const available = Array.isArray(response.versions) ? response.versions.some((item) => item.platform === 'Android' && item.version === SUPPORTED_CORAL_VERSION) : response.nso_version === SUPPORTED_CORAL_VERSION;
    if (!available) throw new Error(`nxapi 服务当前未提供本版程序支持的 Nintendo App ${SUPPORTED_CORAL_VERSION}，已停止相册认证；已有网页授权保留。`);
    if (cache.version && cache.version !== SUPPORTED_CORAL_VERSION) { cache.coralToken = ''; cache.coralExpiresAt = 0; }
    cache.version = SUPPORTED_CORAL_VERSION;
    cache.versionExpiresAt = now() + 6 * 60 * 60 * 1000;
  }

  async function exchangeSession() {
    if (cache.idToken && cache.profile && cache.nintendoExpiresAt > now()) return;
    if (!cache.sessionToken) throw new Error('请先连接 Nintendo 账号。');
    const tokens = await jsonPost('https://accounts.nintendo.com/connect/1.0.0/api/token', {
      client_id: NINTENDO_CLIENT, session_token: cache.sessionToken,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token',
    }, { 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12)' });
    if (!tokens.id_token || !tokens.access_token) throw new Error('Nintendo 登录响应不完整。');
    cache.idToken = tokens.id_token;
    cache.nintendoAccessToken = tokens.access_token;
    cache.nintendoExpiresAt = now() + Math.max(1, Number(tokens.expires_in || 900) - 10) * 1000;
    cache.profile = await call('https://api.accounts.nintendo.com/2.0.0/users/me', { headers: { Authorization: `Bearer ${tokens.access_token}`, 'Accept-Language': 'en-GB', 'User-Agent': 'NASDKAPI; Android' } });
    if (!cache.profile.id || !cache.profile.birthday || !cache.profile.country) {
      cache.profile = null;
      throw new Error('Nintendo 账号资料不完整，未推测填写生日或地区。');
    }
  }

  async function decode(response) {
    let decoded;
    try { decoded = JSON.parse(await znca('/decrypt-response', { data: Buffer.from(await response.arrayBuffer()).toString('base64') }, 'text')); }
    catch (error) { if (error instanceof SyntaxError) throw new Error('Nintendo 相册响应无法解密为有效 JSON。'); throw error; }
    if (decoded.status !== 0) {
      cache.coralToken = ''; cache.coralExpiresAt = 0;
      throw new Error('Nintendo 拒绝了相册请求，请重新连接账号；未自动重试。');
    }
    return decoded;
  }

  async function coralPost(url, binary, token = '') {
    let response;
    try {
      response = await request(url, {
        method: 'POST', body: Buffer.from(binary, 'base64'), redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/octet-stream', 'X-Platform': 'Android', 'X-ProductVersion': cache.version, 'User-Agent': `com.nintendo.znca/${cache.version}(Android/12)`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
    } catch { throw new Error('Nintendo 相册服务连接失败。'); }
    if (!response.ok) {
      if (response.status === 429) cache.cooldownUntil = now() + 15 * 60 * 1000;
      if (response.status === 401 || response.status === 403) { cache.coralToken = ''; cache.coralExpiresAt = 0; }
      throw new Error(`Nintendo 相册请求失败（HTTP ${response.status}），未自动重试。`);
    }
    return decode(response);
  }

  async function ensureCoral() {
    requireAccountConsent(config);
    await version();
    requireClientCompatibility(config);
    if (cache.coralToken && cache.coralExpiresAt > now()) return;
    await exchangeSession();
    const profile = cache.profile;
    const login = await znca('/f', {
      token: cache.idToken, hash_method: '1', na_id: profile.id,
      encrypt_token_request: { url: CORAL + '/v4/Account/Login', parameter: {
        naIdToken: cache.idToken, naBirthday: profile.birthday, naCountry: profile.country,
        language: profile.language || 'en-GB', f: '', requestId: '', timestamp: 0,
      } },
    });
    if (!login.encrypted_token_request) throw new Error('第三方认证响应不完整。');
    const response = await coralPost(CORAL + '/v4/Account/Login', login.encrypted_token_request);
    const token = response.result?.webApiServerCredential;
    if (!token?.accessToken) throw new Error('Nintendo 相册认证没有返回访问令牌。');
    cache.coralToken = token.accessToken;
    cache.coralExpiresAt = now() + Math.max(1, Number(token.expiresIn || 7200) - 10) * 1000;
    delete cache.lastAuthError;
  }

  return {
    credentials: cache,
    async checkService() {
      requireAccountConsent(config);
      await version(true);
      requireClientCompatibility(config);
      return { ok: true, message: '服务网络、客户端登记及接口版本检查通过；兼容标识是否被服务接受，仍需验证相册连接。' };
    },
    async completeLogin(callback, pending) {
      requireAccountConsent(config);
      requireClientCompatibility(config);
      const code = validateCallback(callback, pending, now());
      const token = await call('https://accounts.nintendo.com/connect/1.0.0/api/session_token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NASDKAPI; Android' },
        body: new URLSearchParams({ client_id: NINTENDO_CLIENT, session_token_code: code, session_token_code_verifier: pending.verifier }).toString(),
      });
      if (!token.session_token) throw new Error('Nintendo 未返回会话令牌。');
      for (const key of Object.keys(cache)) delete cache[key];
      cache.sessionToken = token.session_token;
      await ensureCoral();
      return { ok: true, message: 'Nintendo 账号已连接，凭据保存在本机钥匙串。' };
    },
    async listMedia() {
      await ensureCoral();
      const url = CORAL + '/v4/Media/List';
      const encrypted = await znca('/encrypt-request', { url, token: cache.coralToken, data: JSON.stringify({ parameter: {} }) });
      if (!encrypted.data) throw new Error('第三方加密响应不完整。');
      const response = await coralPost(url, encrypted.data, cache.coralToken);
      const media = response.result?.media;
      if (!Array.isArray(media)) throw new Error('Nintendo 相册响应缺少媒体列表，未当作空相册处理。');
      return media;
    },

  };
}

export function normaliseAccountMedia(media, timezone = '+08:00') {
  const offset = /^([+-])(0\d|1[0-4]):(00|15|30|45)$/.exec(timezone);
  if (!offset) throw new Error('拍摄时间显示时区无效。');
  const offsetMs = (Number(offset[2]) * 60 + Number(offset[3])) * 60000 * (offset[1] === '+' ? 1 : -1);
  return media.map((item) => {
    const captured = Number(item.capturedAt);
    if (typeof item.id !== 'string' || item.id.length > 200 || !item.id || !item.appName || !Number.isFinite(captured) || captured <= 0 || !item.contentUri) throw new Error('相册项目缺少媒体标识、游戏名称或拍摄时间，未推测补全。');
    const kind = item.type === 'video' ? 'video' : item.type === 'image' ? 'image' : null;
    if (!kind) throw new Error('相册包含尚不支持的媒体类型。');
    const titleId = String(item.titleId || item.applicationId || '');
    if (!titleId) throw new Error('相册项目缺少游戏标识。');
    validateMediaUrl(item.contentUri);
    const date = new Date(captured * 1000 + offsetMs);
    if (!Number.isFinite(date.getTime())) throw new Error('相册拍摄时间无效。');
    return {
      source: 'nintendo_album', uploadedAt: epoch(item.uploadedAt), expiresAt: epoch(item.expiresAt),
      id: `nintendo-${hash(String(item.id))}`, gameId: /^[a-z\d_-]+$/i.test(titleId) ? titleId.toLowerCase() : `title-${hash(titleId).slice(0, 20)}`,
      game: String(item.appName), kind,
      capturedAt: date.toISOString().slice(0, 19) + timezone,
      contentUri: item.contentUri, contentLength: Number(item.contentLength),
    };
  });
}

function epoch(value) {
  const date = new Date(Number(value) * 1000);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function persistentCredentials(credentials) {
  const { nxToken: _token, nxExpiresAt: _expiry, ...persistent } = credentials;
  return persistent;
}

export function validateMediaUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['nintendo.net', 'nintendo.com', 'nintendo.co.jp', 'cloudfront.net'].some((suffix) => host === suffix || host.endsWith('.' + suffix))) throw new Error('媒体下载地址不在允许的 Nintendo／CDN 域名中。');
  return url;
}

export async function downloadMedia(item, staging, shouldStop = async () => false, options = {}) {
  const url = validateMediaUrl(item.contentUri);
  if (!Number.isSafeInteger(item.contentLength) || item.contentLength <= 0 || item.contentLength > 256 * 1024 * 1024) throw new Error('媒体大小无效或超过 256 MiB。');
  await fs.mkdir(staging, { recursive: true });
  const file = path.join(staging, `${item.id}-${randomBytes(8).toString('hex')}${item.kind === 'video' ? '.mp4' : '.jpg'}`);
  const temporary = file + '.part';
  let addresses;
  try { addresses = await (options.lookup || dns.lookup)(url.hostname, { all: true, family: 4 }); } catch { throw new Error('媒体下载域名解析失败。'); }
  const publicAddress = addresses.find(({ address, family }) => family === 4 && !/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|2(2[4-9]|[3-5]\d)\.)/i.test(address));
  if (!publicAddress) throw new Error('媒体域名未解析为可用的公网地址。');
  let request;
  let fileHandle;
  try {
    const response = await new Promise((resolve, reject) => {
      request = (options.get || https.get)(url, { lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [publicAddress]);
        else callback(null, publicAddress.address, publicAddress.family);
      } }, resolve);
      request.on('error', reject);
      request.setTimeout(60000, () => request.destroy(new Error('媒体下载超时。')));
    });
    if (response.statusCode !== 200) { response.destroy(); throw new Error(`媒体下载失败（HTTP ${response.statusCode}），未跟随重定向。`); }
    fileHandle = await fs.open(temporary, 'wx', 0o600);
    let bytes = 0;
    for await (const chunk of response) {
      if (await shouldStop()) { response.destroy(); throw new Error('已停止下载。'); }
      bytes += chunk.length;
      if (bytes > item.contentLength) { response.destroy(); throw new Error('媒体下载超过声明大小。'); }
      await fileHandle.writeFile(chunk);
    }
    if (bytes !== item.contentLength) throw new Error('媒体下载不完整。');
    await fileHandle.close(); fileHandle = null;
    const header = Buffer.alloc(32);
    const inspect = await fs.open(temporary, 'r');
    try { await inspect.read(header, 0, 32, 0); } finally { await inspect.close(); }
    const valid = item.kind === 'video' ? header.toString('ascii', 4, 8) === 'ftyp' : header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    if (!valid) throw new Error('下载内容不是预期的截图／视频格式，未写入笔记。');
    await fs.rename(temporary, file);
    return { sourceFile: file, hash: await hashFile(file) };
  } finally {
    request?.destroy();
    await fileHandle?.close();
    await fs.unlink(temporary).catch(() => {});
  }
}
