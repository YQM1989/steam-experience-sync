# Steam 截图与评价同步

Game Memories 的 Steam 部分记录公开截图动态与评价。桌面安装和双平台使用入口见 [项目首页](../README.md)。

## Steam 当前能力

- 读取公开 Steam 截图页面，提取截图 ID、游戏名、appid、评价文字、截图图片和发布时间。
- 按游戏归档到 Obsidian：一款游戏一个 Markdown 文件，截图在文件内按日期分段。
- 通过 Steam 商店接口补充横版封面图。
- 如果提供 `STEAM_API_KEY`，额外补充累计游玩时长。
- 使用 state 文件去重，避免重复写入同一张截图。
- 连续运行时每轮重新检查最新截图页，不遍历没有截图的游戏库。
- 截图列表遇到空页立即停止，不会继续递增无效页码。
- 支持 pending write preview：先用 `--plan-writes` 生成待写入队列，检查后再写入（`--apply-pending`）或跳过（`--clear-pending`）。
- 遇到 429 会冷却；连续 3 次限流失败会暂停 worker 并通知。

## Steam 读取边界

- 不读取好友可见或私密内容。
- 不保存 Cookie、不复用 Steam 登录态。
- 不绕过验证码、Cloudflare 或 Steam 风控。
- 不全量导入没有截图评价的游戏库。
- 不把 API Key 写入 Obsidian 笔记、README、日志或 Git。

## 准备

复制配置文件：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```env
STEAM_ID=your_steamid64
OBSIDIAN_VAULT_DIR=D:\Path\To\Your\ObsidianVault
STEAM_API_KEY=可留空
```

`STEAM_API_KEY` 只用于补充游玩时长；截图动态来自公开网页，本身不依赖 API Key。

默认运行数据写入：

```text
<your-vault>\.obsidian\steam-experience-sync\
```

这里保存 `state.json`、`discovered-games.json`、`pending-writes.json`、worker 日志和 stop file。它们是运行状态，不是正文笔记。

## 命令行运行

Windows / macOS 都可以运行：

```bash
node src/index.mjs --dry-run
node src/index.mjs
```

常用命令：

```bash
node src/index.mjs --dry-run --limit 5
node src/index.mjs --pages 2
node src/index.mjs --discover --pages 3 --request-delay-ms 10000
node src/index.mjs --plan-writes --pages 1 --limit 5 --request-delay-ms 10000
node src/index.mjs --read-pending
node src/index.mjs --apply-pending
node src/index.mjs --clear-pending
node src/index.mjs --all --request-delay-ms 30000 --page-delay-ms 60000
```

## Worker 模式

Worker 用于日常增量同步。默认 `feed` 模式每轮从最新截图页开始，只打开尚未处理的截图详情；不会沿着历史页码无限向后扫描。它不是常驻监控服务：连续处理完当前积压后，首次确认最新页没有未处理截图就自动退出。

```bash
npm run worker:dry-run
npm run worker
npm run worker:loop
npm run worker:status
npm run worker:stop
npm run worker:resume
```

推荐配置：

```env
STEAM_WORKER_MODE=feed
STEAM_WORKER_BATCH_SIZE=5
STEAM_WORKER_MAX_DETAIL_SCANS=3
STEAM_REQUEST_DELAY_MS=30000
STEAM_PAGE_DELAY_MS=60000
STEAM_WORKER_LOOP_DELAY_MS=60000
STEAM_WORKER_COOLDOWN_ON_429_MS=28800000
```

说明：

- `npm run worker`：检查一次最新截图页，处理一小批新截图后退出。
- `npm run worker:loop`：连续处理当前积压；每轮结束后等待 `STEAM_WORKER_LOOP_DELAY_MS`，首次确认没有未处理截图后自动退出。
- `npm run worker:status`：查看最新截图同步、冷却和暂停状态。
- `npm run worker:stop`：创建 stop file，后续 worker 启动会退出。
- `npm run worker:resume`：删除 stop file。
- 遇到 429 后会冷却；连续 3 次 429 会写 stop file，并在桌面 GUI 中触发通知。

历史补录与日常增量同步分开。需要补录旧截图时手动运行 `node src/index.mjs --all`；扫描遇到第一个空页即结束。旧的 discovery/appid 命令仍保留为兼容入口，但不再是桌面应用的默认工作流。

状态时间显示统一使用北京时间；内部 JSON 仍保存 ISO 时间，方便跨设备判断。

## 本地网页 GUI

旧版网页 GUI 仍保留为 fallback：

```bash
npm run gui
```

打开：

```text
http://127.0.0.1:8765
```

它只绑定本机 `127.0.0.1`，不提供外网访问。

## Obsidian 输出

默认输出：

```text
<your-vault>\00_输入源\50_我是谁\Steam体验记录\<游戏名>.md
```

同一游戏的多张截图追加到同一文件，日期只作为文件内 `## YYYY-MM-DD` 分段。截图 ID 不作为标题显示，只保留在来源链接和内部去重标记里。

脚本会写入 `cssclasses: steam-experience`。样式参考：

```text
docs\obsidian-steam-experience.css
```

可复制到：

```text
<your-vault>\.obsidian\snippets\steam-experience.css
```

然后在 Obsidian `设置 -> 外观 -> CSS snippets` 启用。

## 全量导入建议

全量回扫会访问较多 Steam 页面，建议保守运行：

1. 先 discovery：`node src/index.mjs --discover --pages 3 --request-delay-ms 10000`
2. 再预览：`node src/index.mjs --plan-writes --pages 1 --limit 5 --request-delay-ms 10000`
3. 检查待写入列表：`node src/index.mjs --read-pending`
4. 确认无误后写入：`node src/index.mjs --apply-pending`
5. 历史很多时按 `--appid` 一款游戏一款游戏处理。

不要连续高频全量回扫。遇到 429 时先等待冷却，再提高 `STEAM_REQUEST_DELAY_MS` 和 `STEAM_PAGE_DELAY_MS`。
