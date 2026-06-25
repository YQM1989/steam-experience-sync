import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { Logs } from './Logs';
import { notifyPausedByRateLimit } from './notifications';
import { Preview } from './Preview';
import { Queue } from './Queue';
import { Settings } from './Settings';
import { getLogs, getStatus, startWorkerLoop, stopWorker } from './tauriApi';

type Tab = 'dashboard' | 'queue' | 'preview' | 'logs' | 'settings';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'queue', label: 'Queue' },
  { id: 'preview', label: 'Preview' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
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
      <nav className="tabbar" aria-label="Main navigation">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTab === 'dashboard' ? (
        <Dashboard busy={busy} status={status} onRefresh={refresh} onRunLoop={runLoop} onStop={stop} />
      ) : null}
      {activeTab === 'queue' ? <Queue /> : null}
      {activeTab === 'preview' ? <Preview /> : null}
      {activeTab === 'logs' ? <Logs busy={busy} logs={logs} onRefresh={refresh} /> : null}
      {activeTab === 'settings' ? <Settings /> : null}
    </main>
  );
}
