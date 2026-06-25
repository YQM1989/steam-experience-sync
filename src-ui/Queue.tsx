import { useEffect, useMemo, useState } from 'react';
import { type DiscoveryIndex, readDiscoveryIndex } from './tauriApi';

const emptyIndex: DiscoveryIndex = { games: {} };

export function Queue() {
  const [index, setIndex] = useState<DiscoveryIndex>(emptyIndex);
  const [message, setMessage] = useState('发现索引未读取');

  async function refresh() {
    const value = await readDiscoveryIndex();
    setIndex({ ...emptyIndex, ...value, games: value.games || {} });
    setMessage('发现索引已读取');
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  const games = useMemo(
    () =>
      Object.values(index.games).sort((a, b) =>
        String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')),
      ),
    [index.games],
  );

  return (
    <section className="panel">
      <p className="eyebrow">Queue</p>
      <h2>截图游戏队列</h2>
      <div className="toolbar">
        <button onClick={refresh}>刷新队列</button>
      </div>
      <p className="muted">{message}</p>
      <div className="queue-list">
        {games.length === 0 ? (
          <div className="empty-state">还没有发现索引。可以先运行截图发现或生成预览。</div>
        ) : (
          games.map((game) => (
            <article className="queue-item" key={game.appid}>
              <div>
                <h3>{game.name || `Steam App ${game.appid}`}</h3>
                <p className="muted">App {game.appid}</p>
              </div>
              <div className="queue-meta">
                <span>{game.screenshotIds?.length || 0} 张截图</span>
                <span>{formatDateTime(game.lastSeenAt)}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function formatDateTime(value?: string) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}
