import { useEffect, useState } from 'react';
import { CommandResult, readConfig, SwitchConfig, SwitchGame, SwitchStatus, switchAction } from './tauriApi';

const defaults: SwitchConfig = {
  source: 'local', albumDir: '',
  nxapiClientId: '', nxapiClientVersion: '', thirdPartyConsent: false,
  experienceDir: '00_输入源/50_我是谁/Switch体验记录',
  attachmentDir: '附件/Switch体验记录', filenameTimezone: '+08:00', games: {},
};
type Preview = { games: SwitchGame[]; total: number; skipped: Array<{ file: string; reason: string }> };
type Tab = 'dashboard' | 'logs' | 'settings';

export function SwitchPanel({ tab }: { tab: Tab }) {
  const [config, setConfig] = useState<SwitchConfig>(defaults);
  const [vaultDir, setVaultDir] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SwitchStatus | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [logs, setLogs] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sessionAuthorised, setSessionAuthorised] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [callback, setCallback] = useState('');

  async function refreshAccount() {
    const next = await switchAction<{ connected: boolean; pending: boolean; sessionAuthorised?: boolean }>('account-status');
    setConnected(Boolean(next.connected));
    setSessionAuthorised(Boolean(next.sessionAuthorised));
    setLoginPending(Boolean(next.pending));
  }

  async function refresh() {
    const next = await switchAction<SwitchStatus>('status');
    setStatus(next);
    if (next.configured) setLogs(await switchAction<string>('logs'));
  }

  useEffect(() => {
    readConfig().then((full) => {
      setConfig({ ...defaults, ...full.switch });
      setVaultDir(full.vaultDir);
      setLoaded(true);
    }).catch((error) => setMessage(String(error)));
    refresh().catch((error) => setMessage(String(error)));
    refreshAccount().catch(() => {});
  }, []);

  useEffect(() => {
    if (!busy && !status?.running) return;
    const timer = setInterval(() => refresh().catch((error) => setMessage(String(error))), 2000);
    return () => clearInterval(timer);
  }, [busy, status?.running]);

  async function act(action: string) {
    setBusy(true);
    setMessage('');
    try {
      if (action === 'save-settings') {
        const result = await switchAction<CommandResult>(action, { vaultDir, switch: config });
        setMessage(result.message);
      } else if (action === 'verify-account') {
        await switchAction('save-settings', { vaultDir, switch: config });
        const result = await switchAction<Preview>('preview');
        setPreview(result);
        setMessage(`相册读取成功，共 ${result.total} 项素材；尚未下载媒体或写入游戏笔记。`);
        await refreshAccount();
      } else if (action === 'preview') {
        setPreview(await switchAction<Preview>(action));
      } else if (['login-start', 'login-finish', 'disconnect', 'check-service'].includes(action)) {
        if (['login-start', 'check-service'].includes(action)) await switchAction('save-settings', { vaultDir, switch: config });
        const result = await switchAction<CommandResult>(action, action === 'login-finish' ? { callback } : {});
        setCallback('');
        setMessage(result.message);
        await refreshAccount();
      } else {
        const result = await switchAction<CommandResult>(action);
        setMessage(result.message);
        if (action === 'sync') await refreshAccount();
      }
      await refresh();
    } catch (error) {
      setMessage(String(error));
      if (action === 'login-finish') setCallback('');
      await refreshAccount().catch(() => {});
    }
    finally { setBusy(false); }
  }

  const games = preview?.games || status?.games || [];
  const running = busy || Boolean(status?.running);

  if (tab === 'settings') return (
    <section className="panel">
      <p className="eyebrow">Settings · Switch 2</p>
      <h1>Switch 游戏回忆设置</h1>
      <div className="info-banner">连接一次 Nintendo 账号，之后点击「开始同步」自动查找新增截图和视频。应用已自带相册客户端。</div>
      <div className="settings-grid">
        <label className="wide"><span>Obsidian 仓库根目录（与 Steam 共用）</span><input value={vaultDir} onChange={(event) => setVaultDir(event.target.value)} /></label>
        <label className="wide"><span>素材来源</span><select value={config.source} onChange={(event) => { setConfig({ ...config, source: event.target.value as 'local' | 'account' }); setPreview(null); }}><option value="account">Nintendo 账号相册（Switch 2）</option><option value="local">本地导出相册</option></select></label>
        {config.source === 'local' && <label className="wide"><span>导出的相册目录</span><input placeholder="例如 /Users/你的用户名/Pictures/Nintendo Switch/Album" value={config.albumDir} onChange={(event) => setConfig({ ...config, albumDir: event.target.value })} /></label>}
        <label><span>Switch 笔记目录（仓库内）</span><input value={config.experienceDir} onChange={(event) => setConfig({ ...config, experienceDir: event.target.value })} /></label>
        <label><span>媒体附件目录（仓库内）</span><input value={config.attachmentDir} onChange={(event) => setConfig({ ...config, attachmentDir: event.target.value })} /></label>
        <label><span>拍摄日期显示时区</span><select value={config.filenameTimezone} onChange={(event) => setConfig({ ...config, filenameTimezone: event.target.value })}>
          <option value="+08:00">北京时间 UTC+8</option><option value="+09:00">日本时间 UTC+9</option><option value="+00:00">UTC</option>
        </select></label>
      </div>
      {config.source === 'account' && <div className="account-connect">
        <h2>Nintendo 账号连接</h2>
        <p className="muted">相册客户端由本应用在后台运行，完成后自动退出。已授权的账号可以直接验证连接或开始同步。</p>
        <p className="muted">nxapi 会处理 Nintendo 登录令牌、部分账号资料及相册请求／响应；媒体从返回的下载地址获取。登录信息保存在本机 macOS 钥匙串。云端相册只保留近 30 天、最多 100 项，需先在主机上传素材。</p>
        <label className="consent-label"><input type="checkbox" checked={Boolean(config.thirdPartyConsent)} onChange={(event) => setConfig({ ...config, thirdPartyConsent: event.target.checked })} /><span>我同意使用上述第三方认证服务</span></label>
        <p>账号状态：{connected ? '已连接，最近一次相册读取成功' : sessionAuthorised ? '账号授权已保存，可验证连接或开始同步' : '未连接'}</p>
        <div className="toolbar"><button disabled={!loaded || running || !config.thirdPartyConsent || !sessionAuthorised} onClick={() => act('verify-account')}>验证账号连接</button><button disabled={!loaded || running || !config.thirdPartyConsent} onClick={() => act('login-start')}>{connected || sessionAuthorised ? '重新连接 Nintendo 账号' : '打开 Nintendo 登录'}</button><button disabled={running || (!connected && !sessionAuthorised && !loginPending)} onClick={() => act('disconnect')}>移除本机登录信息</button></div>
        {loginPending && <><p className="muted">官方网页登录后，右键复制「使用此账号」按钮链接，粘贴下方完成连接。链接包含临时授权信息，请不要发送到聊天或保存到笔记。</p><label><span>本次授权完成链接</span><input type="password" autoComplete="off" value={callback} onChange={(event) => setCallback(event.target.value)} /></label><div className="toolbar"><button disabled={running || !callback} onClick={() => act('login-finish')}>完成账号连接</button></div></>}
      </div>}
      <div className="toolbar"><button disabled={!loaded || running} onClick={() => act('save-settings')}>保存 Switch 设置</button><button disabled={!status?.configured || running} onClick={() => act('install-style')}>安装 Obsidian 左右布局</button></div>
      <p className="muted">使用原始拍摄时间，不用导入日期替代。视频将复制到附件目录，请预留空间。</p>
      {message && <p role="status">{message}</p>}
    </section>
  );
  if (tab === 'logs') return (
    <section className="panel"><p className="eyebrow">Logs · Switch 2</p><h1>Switch 导入日志</h1><div className="toolbar"><button onClick={() => refresh().catch((error) => setMessage(String(error)))}>刷新日志</button></div><pre>{logs || '暂无日志'}</pre>{message && <p role="status">{message}</p>}</section>
  );
  return (
    <section className="panel">
      <p className="eyebrow">Dashboard · Switch 2</p><h1>Switch 游戏回忆</h1>
      <p className="muted">按游戏、拍摄日期整理截图和视频；感想留在 Obsidian 里自己写。</p>
      <div className="toolbar">
        <button disabled={!status?.configured || running} onClick={() => act('preview')}>扫描相册</button>
        <button disabled={!status?.configured || running || (config.source === 'account' && (!config.thirdPartyConsent || !sessionAuthorised))} onClick={() => act('sync')}>{running ? '同步中...' : '开始同步'}</button>
        <button disabled={!running} onClick={() => switchAction<CommandResult>('stop').then((result) => setMessage(result.message)).catch((error) => setMessage(String(error)))}>停止导入</button>
        <button disabled={busy} onClick={() => refresh().catch((error) => setMessage(String(error)))}>刷新状态</button>
      </div>
      {!status?.configured && <div className="info-banner">先在 Settings 保存仓库与素材来源；账号模式还需完成 Nintendo 登录。</div>}
      <p className="muted">当前素材来源：{config.source === 'account' ? 'Nintendo 账号相册' : '本地导出相册'}。开始同步会自动检查新增内容，并保留 Obsidian 中已有的感想。</p>
      <div className="status-grid"><div className="status-item"><span className="status-label">已归档素材</span><span>{status?.imported || 0}</span></div><div className="status-item"><span className="status-label">上次导入</span><span>{status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未导入'}</span></div></div>
      {message && <p role="status">{message}</p>}
      {status?.lastError && <div className="error-banner">{status.lastError}</div>}
      {preview && <p>扫描到 {preview.total} 项素材，{preview.skipped.length} 项待处理。扫描不会写入笔记。</p>}
      {games.length > 0 && <><h2>游戏名称与海报</h2><p className="muted">海报填写本地 JPG／PNG 图片路径。保存后导入素材，将海报复制到仓库。</p><div className="game-settings">{games.map((game) => <GameEditor key={game.id} game={game} saved={config.games[game.id]} disabled={running} onSaved={async () => { const full = await readConfig(); setConfig({ ...defaults, ...full.switch }); await refresh(); }} />)}</div></>}
      {[...(preview?.skipped || []), ...(!preview ? status?.lastResult?.skipped || [] : [])].length > 0 && <details><summary>未导入的文件</summary>{(preview?.skipped || status?.lastResult?.skipped || []).map((item) => <p key={item.file}>{item.file}：{item.reason}</p>)}</details>}
    </section>
  );
}

function GameEditor({ game, saved, disabled, onSaved }: { game: SwitchGame; saved?: { name?: string; coverFile?: string }; disabled: boolean; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(saved?.name || game.name);
  const [coverFile, setCoverFile] = useState(saved?.coverFile || game.coverFile || '');
  const [message, setMessage] = useState('');
  async function save() {
    try {
      const result = await switchAction<CommandResult>('save-game', { id: game.id, name, coverFile });
      await onSaved();
      setMessage(result.message);
    } catch (error) { setMessage(String(error)); }
  }
  return <div className="game-editor"><div><strong>{game.name}</strong><span className="muted"> · {game.count} 项</span><p className="mono muted">{game.id}</p></div><label><span>游戏名称</span><input aria-label={`${game.id} 游戏名称`} value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>本地海报路径</span><input aria-label={`${game.id} 海报路径`} value={coverFile} onChange={(event) => setCoverFile(event.target.value)} /></label><button disabled={disabled} onClick={save}>保存游戏</button>{message && <p role="status">{message}</p>}</div>;
}
