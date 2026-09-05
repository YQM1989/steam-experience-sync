import { WorkerStatus } from './tauriApi';

type DashboardProps = {
  busy: boolean;
  isWorkerRunning: boolean;
  liveOutput: string[];
  status: WorkerStatus | string | null;
  onRefresh: () => void;
  onRunLoop: () => void;
  onStop: () => void;
};

function isWorkerStatus(s: WorkerStatus | string | null): s is WorkerStatus {
  return s !== null && typeof s === 'object';
}

function badge(text: string, kind: 'ok' | 'warn' | 'danger' | 'info') {
  return { text, kind };
}

function statusBadges(status: WorkerStatus) {
  const badges: Array<{ text: string; kind: 'ok' | 'warn' | 'danger' | 'info' }> = [];

  if (status.workerLockActive) {
    badges.push({ text: '\u5df2\u6709 worker \u8fd0\u884c', kind: 'info' });
  }

  // Worker running state
  if (status.pausedByRateLimit) {
    badges.push({ text: '已暂停（限流）', kind: 'danger' });
  } else if (status.stopFilePresent) {
    badges.push({ text: '已暂停', kind: 'warn' });
  } else if (status.cooldownActive) {
    badges.push({ text: '冷却中', kind: 'warn' });
  } else {
    badges.push({ text: '可运行', kind: 'ok' });
  }

  // Rate limit counter
  if (status.rateLimitFailures > 0) {
    badges.push({
      text: `限流 ${status.rateLimitFailures}/3`,
      kind: status.rateLimitFailures >= 3 ? 'danger' : 'warn',
    });
  }

  // Queue info
  badges.push({ text: `队列 ${status.queue.length} 个游戏`, kind: 'info' });

  return badges;
}

export function Dashboard({ busy, isWorkerRunning, liveOutput, status, onRefresh, onRunLoop, onStop }: DashboardProps) {
  const data = isWorkerStatus(status) ? status : null;

  return (
    <section className="panel">
      <p className="eyebrow">Dashboard</p>
      <h1>Steam 体验记录控制台</h1>

      <div className="toolbar">
        <button disabled={busy || isWorkerRunning} onClick={onRunLoop}>
          {isWorkerRunning ? '同步中...' : '开始同步'}
        </button>
        <button disabled={busy} onClick={onStop}>
          停止
        </button>
        <button disabled={busy} onClick={onRefresh}>
          刷新状态
        </button>
      </div>

      {data ? (
        <>
          {/* Status badges */}
          <div className="status-badges">
            {statusBadges(data).map((b) => (
              <span className={`badge badge-${b.kind}`} key={b.text}>
                {b.text}
              </span>
            ))}
          </div>

          {data.stopFilePresent && !data.pausedByRateLimit && (
            <div className="info-banner">
              已暂停，点击开始同步会清除停止标记并恢复
            </div>
          )}

          {/* Detail grid */}
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">下一 AppID</span>
              <span className="status-value">{data.nextAppid || '无'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">冷却</span>
              <span className="status-value">
                {data.cooldownActive && data.cooldownUntilBeijing
                  ? data.cooldownUntilBeijing
                  : '无'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">上次运行</span>
              <span className="status-value">{data.lastRunAtBeijing || '无'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">每轮配置</span>
              <span className="status-value">
                最多 {data.configuredMaxDetailScans} 个详情 · {data.configuredBatchSize} 个匹配 · {data.configuredPages} 页
              </span>
            </div>
          </div>

          {data.workerMode === 'feed' && (
            <>
              <h2>截图流进度</h2>
              <div className="status-grid">
                <div className="status-item">
                  <span className="status-label">扫描范围</span>
                  <span className="status-value">最新截图页</span>
                </div>
                <div className="status-item">
                  <span className="status-label">已写入</span>
                  <span className="status-value">{data.feedProgress.imported}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">上次匹配</span>
                  <span className="status-value">{data.feedProgress.lastMatchedCount ?? '-'}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">上次检查详情</span>
                  <span className="status-value">{data.feedProgress.lastDetailScannedCount ?? '-'}</span>
                </div>
              </div>
            </>
          )}

          {/* Error banner */}
          {data.lastError && (
            <div className="error-banner">
              <strong>上次错误：</strong> {data.lastError}
            </div>
          )}

          {/* Queue progress table */}
          {data.appProgress.length > 0 && (
            <>
              <h2>队列进度</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>AppID</th>
                      <th>下一页</th>
                      <th>已写入</th>
                      <th>上次匹配</th>
                      <th>上次写入</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.appProgress.map((row) => (
                      <tr key={row.appid}>
                        <td className="mono">{row.appid}</td>
                        <td>{row.nextPage}</td>
                        <td>{row.imported}</td>
                        <td>{row.lastMatchedCount ?? '-'}</td>
                        <td>{row.lastProcessedCount ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Live output */}
          {liveOutput.length > 0 && (
            <>
              <h2>实时输出</h2>
              <pre className="live-output">{liveOutput.join('\n')}</pre>
            </>
          )}
        </>
      ) : (
        /* Fallback when status hasn't loaded or is an error string */
        <pre className="live-output">
          {typeof status === 'string' ? status : '正在加载状态...'}
        </pre>
      )}
    </section>
  );
}
