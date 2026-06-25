# Steam Experience Sync

把公开 Steam 截图动态同步到 Obsidian 的轻量工具。目标不是备份完整游戏库，而是记录“我主动截图并写过评价的游戏体验”。

## 当前能力

- 读取公开 Steam 截图页面，提取截图 ID、游戏名、appid、评价文字、截图图片和发布时间。
- 按游戏归档到 Obsidian：一款游戏一个 Markdown 文件，截图在文件内按日期分段。
- 通过 Steam 商店接口补充横版封面图。
- 如果提供 `STEAM_API_KEY`，额外补充累计游玩时长。
- 使用 state 文件去重，避免重复写入同一张截图。
- 支持 discovery index，减少后续空扫。
- 支持 pending write preview：先生成待写入队列，再由 GUI 确认写入或跳过。
- 遇到 429 会冷却；连续 3 次限流失败会暂停 worker 并通知。

## 不做什么

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
node src/index.mjs --all --appid 2358720 --max-matches 5 --request-delay-ms 10000
```

## Worker 模式

Worker 用于把历史同步拆成低频小批次。它不是开机自启服务，每轮处理一小批后退出或等待下一轮。

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
STEAM_WORKER_APPIDS=2758000,4181110,1091500
STEAM_WORKER_BATCH_SIZE=5
STEAM_WORKER_PAGES=3
STEAM_REQUEST_DELAY_MS=10000
STEAM_PAGE_DELAY_MS=15000
STEAM_WORKER_LOOP_DELAY_MS=10000
STEAM_WORKER_COOLDOWN_ON_429_MS=28800000
```

说明：

- `npm run worker`：运行一轮，处理当前 appid 的一小批截图后退出。
- `npm run worker:loop`：连续运行多轮；每轮结束后等待 `STEAM_WORKER_LOOP_DELAY_MS`，默认 10 秒。
- `npm run worker:status`：查看队列、下一个 appid、页码、冷却和暂停状态。
- `npm run worker:stop`：创建 stop file，后续 worker 启动会退出。
- `npm run worker:resume`：删除 stop file。
- 遇到 429 后会冷却；连续 3 次 429 会写 stop file，并在桌面 GUI 中触发通知。

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

## Desktop App

第一版桌面应用使用 React + Tauri。当前仍要求本机已安装 Node.js，因为 Tauri 壳会调用现有 Node 同步核心。

### Windows

```powershell
npm install
npm run tauri:dev
```

打包：

```powershell
npm run tauri:build
```

构建产物在：

```text
src-tauri\target\release\bundle\
```

### macOS

```bash
npm install
npm run tauri:dev
```

打包：

```bash
npm run tauri:build
```

macOS 需要 Rust toolchain 和 Xcode Command Line Tools。Apple Silicon / Intel 都应保持源码兼容，但安装包签名、公证不在第一版范围内。

### 桌面应用界面

- Dashboard：查看状态，连续运行、停止、刷新。
- Queue：查看 discovery index 里有截图的游戏。
- Preview：生成待写入队列，确认写入或跳过本轮。
- Logs：查看运行日志。
- Settings：编辑 Steam ID、API Key、vault 路径和请求间隔。

API Key 在 GUI 中默认以密码框显示；`.steam-experience-sync/config.json` 已被 `.gitignore` 忽略，不要提交真实密钥。

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
3. 在 GUI Preview 中确认内容。
4. 确认无误后写入：`node src/index.mjs --apply-pending`
5. 历史很多时按 `--appid` 一款游戏一款游戏处理。

不要连续高频全量回扫。遇到 429 时先等待冷却，再提高 `STEAM_REQUEST_DELAY_MS` 和 `STEAM_PAGE_DELAY_MS`。