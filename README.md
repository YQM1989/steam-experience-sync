# Steam Experience Sync

把公开 Steam 截图动态同步到 Obsidian 的轻量工具。目标不是全量游戏库备份，而是记录“我主动截图并写过评价的游戏体验”。

## 当前能力

- 读取公开 Steam 截图页。
- 抽取 `publishedfileid`、游戏名、appid、截图说明、截图图片、发布时间。
- 通过 Steam 商店 `appdetails` 补充封面图。
- 如果提供 `STEAM_API_KEY`，额外补充累计游玩时长。
- 自动按游戏归档，一款游戏一个 Markdown 文件，截图在文件内按日期分段。
- 用 state 文件去重，避免重复追加同一张截图。
- 支持 `--dry-run`，先预览不写入。
- 支持 `--all` 回扫全部公开截图页，补齐历史截图评价。

## 不做什么

- 不抓好友可见或私密内容。
- 不保存 Cookie。
- 不处理 Steam 登录态。
- 不全量导入游戏库。
- 不把 API Key 写进 Obsidian。

## 准备

复制配置文件：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```env
STEAM_ID=your_steamid64
OBSIDIAN_VAULT_DIR=D:\Path\To\Your\ObsidianVault
STEAM_API_KEY=你的key，可留空
```

`STEAM_API_KEY` 只用于补充累计游玩时长；截图动态本身不依赖它。

同步状态默认写到：

```text
<your-vault>\.obsidian\steam-experience-sync\state.json
```

这个文件只记录已处理过的 Steam 截图 ID，用于减少重复请求；它不是内容笔记。

## 运行

Windows / macOS 都一样：

```bash
node src/index.mjs --dry-run
node src/index.mjs
```

常用参数：

```bash
node src/index.mjs --dry-run --limit 5
node src/index.mjs --pages 2
node src/index.mjs --since-id 3739718595
node src/index.mjs --all --appid 2358720 --dry-run --request-delay-ms 10000
node src/index.mjs --all --appid 2358720 --max-matches 5 --request-delay-ms 10000
node src/index.mjs --all --max-games 5 --limit 5 --dry-run --request-delay-ms 15000 --page-delay-ms 15000
node src/index.mjs --all --dry-run
node src/index.mjs --all
node src/index.mjs --all --request-delay-ms 8000
```

## Worker 模式

Worker 模式用于把历史同步拆成低频小批次。它不是常驻进程，每次运行只处理一小批截图，然后自动退出，适合手动执行、Windows 任务计划程序或 macOS launchd。

```bash
npm run worker:dry-run
npm run worker
npm run worker:stop
npm run worker:resume
```

推荐配置：

```env
STEAM_WORKER_APPIDS=2758000,4181110,1091500
STEAM_WORKER_BATCH_SIZE=5
STEAM_WORKER_PAGES=3
STEAM_REQUEST_DELAY_MS=30000
STEAM_PAGE_DELAY_MS=60000
STEAM_WORKER_COOLDOWN_ON_429_MS=28800000
```

- `npm run worker`：运行一轮，处理队列中当前 appid 的一小批截图，完成后退出。
- `npm run worker:stop`：创建停止文件，后续 worker 启动后会立刻退出。
- `npm run worker:resume`：删除停止文件，允许 worker 继续运行。
- 遇到 `429 Too Many Requests` 时，worker 会记录冷却时间并退出。默认冷却 8 小时，下次启动时如果还在冷却期，会直接跳过。
- 日志默认写入 `<your-vault>\.obsidian\steam-experience-sync\worker.log`。
- 停止文件默认是 `<your-vault>\.obsidian\steam-experience-sync\stop-worker`。

日期归档使用 Steam 截图详情页里的 `Posted` 时间。这个时间更准确地说是 Steam 公开截图的发布/上传时间，不一定等于本地截图文件的原始拍摄时间。当前脚本不会读取 Steam 客户端本地截图文件。

全量回扫会访问较多 Steam 页面，建议保留默认请求间隔；如果遇到 `429 Too Many Requests`，脚本会等待后重试。多次触发时不要立刻反复运行，等 30-60 分钟后用更大的 `--request-delay-ms` 重跑。

建议全量导入策略：

- 第一次先跑 `node src/index.mjs --all --dry-run --request-delay-ms 8000`。
- 确认输出目标正常后，再跑 `node src/index.mjs --all --request-delay-ms 8000`。
- 想一款游戏一款游戏补历史时，用 `--appid`。如果仍然遇到限流，再加 `--max-matches` 分批，例如 `node src/index.mjs --all --appid 2358720 --max-matches 5 --request-delay-ms 10000`。
- 想让脚本自动挑选前几款有新截图的游戏时，用 `--max-games`。例如 `node src/index.mjs --all --max-games 5 --limit 5 --request-delay-ms 15000 --page-delay-ms 15000`。
- `--request-delay-ms` 控制截图详情页请求间隔，`--page-delay-ms` 控制截图列表翻页间隔。Steam 开始返回 429 时，优先把这两个值都调大。
- 如果截图很多，把 `--all` 拆成 `--pages 3`、`--pages 5` 逐步增加，而不是连续高频全量回扫。
- 不使用 Cookie、登录态、代理池或绕过 Cloudflare / Steam 防护的方式；这个工具只同步公开页面。

如果已经运行过普通同步，state 文件会记住已处理截图。需要补齐历史时使用 `--all`，它会扫描所有公开截图页，但仍会跳过 state 和现有 Markdown 来源链接里已经记录过的截图 `id`。只有同时传 `--resync` 才会强制重扫已记录项。

## 默认输出

```text
<your-vault>\00_输入源\50_我是谁\Steam体验记录\游戏名.md
```

同一游戏的多张截图会追加到同一个文件，日期只作为文件内 `## YYYY-MM-DD` 分段。截图 ID 不作为标题显示，只保留在来源链接里用于回溯和去重。

## Obsidian 样式

脚本会给笔记写入 `cssclasses: steam-experience`，并输出可被 CSS 美化的封面区域。项目内样式源文件见：

```text
docs\obsidian-steam-experience.css
```

使用时可把这份 CSS 复制到 Obsidian 的 snippets 目录，例如：

```text
<your-vault>\.obsidian\snippets\steam-experience.css
```

然后在 Obsidian `设置 -> 外观 -> CSS snippets` 中启用 `steam-experience`。

## 建议入库方式

第一阶段先手动运行：

```bash
node src/index.mjs --dry-run
node src/index.mjs
```

确认稳定后，再做 Windows 计划任务或 macOS launchd。不要一开始就做后台常驻。
