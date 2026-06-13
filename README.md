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
node src/index.mjs --all --dry-run
node src/index.mjs --all
node src/index.mjs --all --request-delay-ms 8000
```

日期归档使用 Steam 截图详情页里的 `Posted` 时间。这个时间更准确地说是 Steam 公开截图的发布/上传时间，不一定等于本地截图文件的原始拍摄时间。当前脚本不会读取 Steam 客户端本地截图文件。

全量回扫会访问较多 Steam 页面，建议保留默认请求间隔；如果遇到 `429 Too Many Requests`，脚本会等待后重试。多次触发时不要立刻反复运行，等 30-60 分钟后用更大的 `--request-delay-ms` 重跑。

建议全量导入策略：

- 第一次先跑 `node src/index.mjs --all --dry-run --request-delay-ms 8000`。
- 确认输出目标正常后，再跑 `node src/index.mjs --all --request-delay-ms 8000`。
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
