type DashboardProps = {
  busy: boolean;
  status: string;
  onRefresh: () => void;
  onRunLoop: () => void;
  onStop: () => void;
};

export function Dashboard({ busy, status, onRefresh, onRunLoop, onStop }: DashboardProps) {
  return (
    <section className="panel">
      <p className="eyebrow">Dashboard</p>
      <h1>Steam 体验记录控制台</h1>
      <div className="toolbar">
        <button disabled={busy} onClick={onRunLoop}>连续运行</button>
        <button disabled={busy} onClick={onStop}>停止</button>
        <button disabled={busy} onClick={onRefresh}>刷新状态</button>
      </div>
      <h2>状态</h2>
      <pre>{status}</pre>
    </section>
  );
}
