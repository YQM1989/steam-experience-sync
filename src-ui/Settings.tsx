import { useEffect, useState } from 'react';
import { type GuiConfig, readConfig, writeConfig } from './tauriApi';

const fallbackConfig: GuiConfig = {
  steamId: '',
  steamApiKey: '',
  vaultDir: '',
  speedMode: 'balanced',
  requestDelayMs: 30000,
  pageDelayMs: 60000,
  workerLoopDelayMs: 60000,
  workerMaxDetailScans: 3,
  workerMode: 'feed',
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
          <span>同步模式</span>
          <select
            value={config.workerMode}
            onChange={(event) => update('workerMode', event.target.value as GuiConfig['workerMode'])}
          >
            <option value="feed">截图流优先</option>
            <option value="appid">按 AppID 队列</option>
          </select>
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
        <label>
          <span>轮间隔 ms</span>
          <input
            type="number"
            value={config.workerLoopDelayMs}
            onChange={(event) => update('workerLoopDelayMs', Number(event.target.value))}
          />
        </label>
        <label>
          <span>每轮最多检查截图详情数</span>
          <input
            aria-label="每轮最多检查截图详情数"
            type="number"
            min="1"
            value={config.workerMaxDetailScans}
            onChange={(event) => update('workerMaxDetailScans', Math.max(1, Number(event.target.value)))}
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
