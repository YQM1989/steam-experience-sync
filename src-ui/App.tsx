import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { Logs } from './Logs';
import { notifyPausedByRateLimit } from './notifications';
import { Preview } from './Preview';
import { Settings } from './Settings';
import { getLogs, getStatus, startWorkerLoop, stopWorker, WorkerStatus } from './tauriApi';
import { listen } from '@tauri-apps/api/event';

type Tab = 'dashboard' | 'preview' | 'logs' | 'settings';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'preview', label: 'Preview' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [status, setStatus] = useState<WorkerStatus | string | null>(null);
  const [logs, setLogs] = useState('');
  const [liveOutput, setLiveOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [isWorkerRunning, setIsWorkerRunning] = useState(false);

  async function refresh() {
    try {
      const nextStatus = await getStatus();
      setStatus(nextStatus);
      if (typeof nextStatus === 'object' && nextStatus.pausedByRateLimit) {
        await notifyPausedByRateLimit();
      }
      setLogs(await getLogs());
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function runLoop() {
    setBusy(true);
    try {
      await startWorkerLoop();
      setIsWorkerRunning(true);
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
      setIsWorkerRunning(false);
      await refresh();
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  // Listen for real-time worker output via Tauri events
  useEffect(() => {
    const unlistenPromise = listen<string>('worker-output', (event) => {
      setLiveOutput((prev) => {
        const next = [...prev, event.payload];
        return next.length > 300 ? next.slice(-300) : next;
      });
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Listen for worker exit events
  useEffect(() => {
    const unlistenPromise = listen<string>('worker-exit', () => {
      setIsWorkerRunning(false);
      refresh().catch(console.error);
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Auto-poll status every 3 seconds while worker is running
  useEffect(() => {
    if (!isWorkerRunning) return;
    const timer = setInterval(() => {
      refresh().catch(console.error);
    }, 3000);
    return () => clearInterval(timer);
  }, [isWorkerRunning]);

  // Initial load
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
        <Dashboard
          busy={busy}
          isWorkerRunning={isWorkerRunning}
          liveOutput={liveOutput}
          status={status}
          onRefresh={refresh}
          onRunLoop={runLoop}
          onStop={stop}
        />
      ) : null}
      {activeTab === 'preview' ? <Preview /> : null}
      {activeTab === 'logs' ? <Logs busy={busy} logs={logs} onRefresh={refresh} /> : null}
      {activeTab === 'settings' ? <Settings /> : null}
    </main>
  );
}
