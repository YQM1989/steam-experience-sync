/* Game Experience Sync: independent Switch reflection editor */
const mediaId = String(input?.mediaId || '');
const notePath = dv.current()?.file?.path;
const file = notePath && dv.app.vault.getAbstractFileByPath(notePath);
const metadata = file && dv.app.metadataCache.getFileCache(file)?.frontmatter;
if (!file || metadata?.type !== 'raw_switch_experience' || metadata?.platform !== 'switch' || !/^(?:nintendo|local)-[a-f0-9]{64}$/.test(mediaId)) {
  dv.paragraph('感想编辑区域暂不可用，请重新打开这份 Switch 游戏笔记。');
} else {
  const key = 'switch_reflection_' + mediaId;
  const saved = typeof metadata[key] === 'string' ? metadata[key] : '';
  // Keep in-progress drafts across Dataview refreshes, without persistent browser storage.
  const drafts = dv.app.__switchReflectionDrafts || (dv.app.__switchReflectionDrafts = new Map());
  const draftKey = notePath + ':' + mediaId;
  let draft = drafts.get(draftKey);
  if (!draft || draft.value === draft.saved) draft = { value: saved, saved, focused: false, start: 0, end: 0 };
  drafts.set(draftKey, draft);
  const wrapper = document.createElement('div');
  wrapper.className = 'switch-reflection-editor';
  const area = document.createElement('textarea');
  area.className = 'switch-reflection-input';
  area.setAttribute('aria-label', '我的感想');
  area.placeholder = '点击这里，写下这一刻的回忆…';
  area.value = draft.value;
  const toolbar = document.createElement('div');
  toolbar.className = 'switch-reflection-tools';
  const save = document.createElement('button');
  save.textContent = '保存感想';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = draft.value === draft.saved ? '离开输入框自动保存' : '尚未保存';
  toolbar.append(save, status);
  wrapper.append(area, toolbar);
  dv.container.append(wrapper);
  let saving = false;
  async function commit() {
    if (saving) return;
    if (area.value === draft.saved) { status.textContent = '已保存'; return; }
    saving = true; save.disabled = true;
    const value = area.value;
    try {
      await dv.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const current = typeof frontmatter[key] === 'string' ? frontmatter[key] : '';
        if (current !== draft.saved) throw new Error('这条感想已在其他位置更新，请先保留当前输入再重新打开笔记。');
        frontmatter[key] = value;
        frontmatter.updated = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      });
      draft.saved = value;
      status.textContent = draft.value === value ? '已保存' : '尚未保存';
    } catch {
      status.textContent = '保存未完成，输入内容仍保留；请检查同步冲突或重新打开笔记。';
    } finally { saving = false; save.disabled = false; }
  }
  area.addEventListener('input', () => {
    draft.value = area.value; draft.start = area.selectionStart; draft.end = area.selectionEnd;
    draft.focused = true; draft.lastInput = Date.now(); status.textContent = '尚未保存';
  });
  area.addEventListener('focus', () => { draft.focused = true; });
  area.addEventListener('blur', () => { draft.focused = false; commit(); });
  area.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commit(); }
  });
  save.addEventListener('click', commit);
  if (draft.focused && Date.now() - (draft.lastInput || 0) < 5000) requestAnimationFrame(() => {
    if (area.isConnected) { area.focus(); area.setSelectionRange(draft.start, draft.end); }
  });
}
