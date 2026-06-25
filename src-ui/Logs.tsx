type LogsProps = {
  busy: boolean;
  logs: string;
  onRefresh: () => void;
};

export function Logs({ busy, logs, onRefresh }: LogsProps) {
  return (
    <section className="panel">
      <p className="eyebrow">Logs</p>
      <h2>运行日志</h2>
      <div className="toolbar">
        <button disabled={busy} onClick={onRefresh}>刷新日志</button>
      </div>
      <pre>{logs || '暂无日志'}</pre>
    </section>
  );
}
