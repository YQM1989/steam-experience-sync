import { useEffect, useState } from 'react';
import { notifyPausedByRateLimit } from './notifications';
import { Preview } from './Preview';
import { Settings } from './Settings';
import { getLogs, getStatus, startWorkerLoop, stopWorker } from './tauriApi';

export function App() {
  const [status, setStatus] = useState('未读取');
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const nextStatus = await getStatus();
    setStatus(nextStatus);
    if (nextStatus.includes('paused by rate limit: yes')) {
      await notifyPausedByRateLimit();
    }
    setLogs(await getLogs());
  }

  async function runLoop() {
    setBusy(true);
    try {
      await startWorkerLoop();
      await refresh();
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await stopWorker();
      await refresh();
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(String(error)));
  }, []);

  return (
    <main className="app-shell">
      <section className="panel">
        <p className="eyebrow">Steam Experience Sync</p>
        <h1>Steam 体验记录控制台</h1>
        <div className="toolbar">
          <button disabled={busy} onClick={runLoop}>连续运行</button>
          <button disabled={busy} onClick={stop}>停止</button>
          <button disabled={busy} onClick={refresh}>刷新状态</button>
        </div>
        <h2>状态</h2>
        <pre>{status}</pre>
        <h2>日志</h2>
        <pre>{logs || '暂无日志'}</pre>
      </section>
      <Preview />
      <Settings />
    </main>
  );
}
