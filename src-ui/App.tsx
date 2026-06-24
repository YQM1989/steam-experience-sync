import { useEffect, useState } from 'react';
import { getLogs, getStatus, startWorkerLoop, stopWorker } from './tauriApi';
import { Settings } from './Settings';

export function App() {
  const [status, setStatus] = useState('未读取');
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setStatus(await getStatus());
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
      <Settings />
    </main>
  );
}
