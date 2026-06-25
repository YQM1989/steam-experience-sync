import { useEffect, useState } from 'react';
import {
  applyPendingWrites,
  clearPendingWrites,
  type PendingWrites,
  planWrites,
  readPendingWrites,
} from './tauriApi';

const emptyPending: PendingWrites = { items: [] };

export function Preview() {
  const [pending, setPending] = useState<PendingWrites>(emptyPending);
  const [message, setMessage] = useState('尚未读取预览队列');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const value = await readPendingWrites();
    setPending({ ...emptyPending, ...value, items: value.items || [] });
    setMessage(value.items?.length ? `待写入 ${value.items.length} 条` : '暂无待写入内容');
  }

  async function generatePreview() {
    setBusy(true);
    try {
      const result = await planWrites();
      setMessage(result.message.trim() || '预览已生成');
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmWrites() {
    setBusy(true);
    try {
      const result = await applyPendingWrites();
      setMessage(result.message.trim() || '写入完成');
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function skipBatch() {
    setBusy(true);
    try {
      const result = await clearPendingWrites();
      setMessage(result.message.trim() || '已跳过本轮');
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  return (
    <section className="panel preview-panel">
      <p className="eyebrow">Preview</p>
      <h2>写入预览</h2>
      <div className="toolbar">
        <button disabled={busy} onClick={generatePreview}>生成预览</button>
        <button disabled={busy || pending.items.length === 0} onClick={confirmWrites}>确认写入</button>
        <button disabled={busy || pending.items.length === 0} onClick={skipBatch}>跳过本轮</button>
        <button disabled={busy} onClick={refresh}>刷新预览</button>
      </div>
      <p className="muted">{message}</p>
      <div className="preview-list">
        {pending.items.length === 0 ? (
          <div className="empty-state">还没有待写入截图。可以先生成预览。</div>
        ) : (
          pending.items.map((item) => (
            <article className="preview-item" key={item.id}>
              {item.image ? (
                <img className="preview-image" src={item.image} alt={`${item.game} screenshot`} />
              ) : (
                <div className="preview-image preview-image-empty">无截图图片</div>
              )}
              <div className="preview-copy">
                <div className="preview-title-row">
                  <h3>{item.game}</h3>
                  <span>{item.date || '未知日期'}</span>
                </div>
                <p className="preview-caption">{item.caption || '无文字评价'}</p>
                <dl>
                  <div>
                    <dt>AppID</dt>
                    <dd>{item.appid}</dd>
                  </div>
                  <div>
                    <dt>目标文件</dt>
                    <dd>{item.targetFile || '未计算'}</dd>
                  </div>
                </dl>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
