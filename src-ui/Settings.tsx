import { useEffect, useState } from 'react';
import { type GuiConfig, readConfig, writeConfig } from './tauriApi';

const fallbackConfig: GuiConfig = {
  steamId: '',
  steamApiKey: '',
  vaultDir: '',
  speedMode: 'balanced',
  previewMode: 'confirm_each_run',
  requestDelayMs: 10000,
  pageDelayMs: 15000,
};

export function Settings() {
  const [config, setConfig] = useState<GuiConfig>(fallbackConfig);
  const [message, setMessage] = useState('配置未保存');

  useEffect(() => {
    readConfig()
      .then((value) => {
        setConfig({ ...fallbackConfig, ...value });
        setMessage('配置已加载');
      })
      .catch((error) => setMessage(String(error)));
  }, []);

  function update<K extends keyof GuiConfig>(key: K, value: GuiConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    try {
      await writeConfig(config);
      setMessage('配置已保存');
    } catch (error) {
      setMessage(String(error));
    }
  }

  return (
    <section className="panel settings-panel">
      <p className="eyebrow">Settings</p>
      <h2>同步配置</h2>
      <div className="settings-grid">
        <label>
          <span>Steam ID64</span>
          <input value={config.steamId} onChange={(event) => update('steamId', event.target.value)} />
        </label>
        <label>
          <span>Steam API Key</span>
          <input
            aria-label="Steam API Key"
            type="password"
            value={config.steamApiKey}
            onChange={(event) => update('steamApiKey', event.target.value)}
          />
        </label>
        <label className="wide">
          <span>Obsidian vault</span>
          <input value={config.vaultDir} onChange={(event) => update('vaultDir', event.target.value)} />
        </label>
        <label>
          <span>速度模式</span>
          <select value={config.speedMode} onChange={(event) => update('speedMode', event.target.value)}>
            <option value="safe">安全</option>
            <option value="balanced">平衡</option>
            <option value="fast">快速</option>
          </select>
        </label>
        <label>
          <span>写入预览</span>
          <select value={config.previewMode} onChange={(event) => update('previewMode', event.target.value)}>
            <option value="confirm_each_run">每轮确认</option>
            <option value="auto">自动写入</option>
            <option value="auto_after_preview">预览后自动写入</option>
          </select>
        </label>
        <label>
          <span>请求间隔 ms</span>
          <input
            type="number"
            value={config.requestDelayMs}
            onChange={(event) => update('requestDelayMs', Number(event.target.value))}
          />
        </label>
        <label>
          <span>翻页间隔 ms</span>
          <input
            type="number"
            value={config.pageDelayMs}
            onChange={(event) => update('pageDelayMs', Number(event.target.value))}
          />
        </label>
      </div>
      <div className="settings-actions">
        <button onClick={save}>保存配置</button>
        <span className="muted">{message}</span>
      </div>
    </section>
  );
}
