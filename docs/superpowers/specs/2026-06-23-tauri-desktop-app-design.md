# Steam Experience Sync Tauri Desktop App Design

日期：2026-06-23

## 背景

`steam-experience-sync` 当前是一个 Node.js 命令行工具，并附带一个绑定到 `127.0.0.1:8765` 的轻量本地网页 GUI。这个 GUI 只能在 `npm run gui` 正在运行时访问；电脑关机或重启后服务会退出，因此不适合作为长期使用入口。

下一阶段目标是把它升级为本地桌面应用：用 React 做前端，用 Tauri 做桌面壳和本地能力桥接，同时继续复用已经跑通的 Node 同步核心。

## 用户目标

1. 在 Windows 家用 PC、未来 MacBook、未来 Mac mini 上都能使用。
2. 打开应用后自动继续同步流程，但用户可以随时手动停止。
3. 不做系统开机自启，因为 Steam 截图增量不是高频任务。
4. 用 GUI 管理配置、运行状态、日志、写入预览和通知。
5. 减少当前 worker 的空跑问题，避免一直扫描没有用户截图的游戏。
6. 第一版视觉以工具型和 Obsidian 克制风为主，后续再升级为 Switch / PlayStation 风格的游戏库体验。
7. GitHub 交付既要源码和 README，也要逐步支持 Windows exe 和 macOS dmg。

## 非目标

1. 第一版不重写 Steam 同步核心为 Rust。
2. 第一版不绕过 Steam / Cloudflare 的风控，不使用 Cookie、代理池、验证码绕过或登录态抓取。
3. 第一版不做系统开机自启。
4. 第一版不做完整游戏库管理器，不导入所有 Steam 游戏。
5. 第一版不要求免安装 Node.js。用户可先安装 Node.js，桌面应用调用现有 Node worker。

## 推荐方案

采用 `React + Tauri + existing Node worker`：

```text
React UI
  |
  | Tauri command / event
  v
Tauri Rust shell
  |
  | spawn node src/index.mjs ...
  | read/write config files
  | read state/log files
  | send desktop notifications
  v
Existing Node sync core
  |
  | Steam public pages / Steam APIs
  v
Obsidian Markdown notes
```

这个方案保留当前已经验证过的同步逻辑，把主要风险控制在桌面壳、配置管理和进程控制上。后续如果项目成熟，再考虑把 Node worker 打包为 sidecar，或把核心同步逻辑迁移到 Rust。

## 第一版应用行为

### 启动行为

应用启动后进入 Dashboard，并自动检查：

1. Node.js 是否可用。
2. `.env` 或 GUI 配置是否完整。
3. Obsidian vault 路径是否存在。
4. state 文件和 worker log 是否可读写。
5. 是否存在 stop-worker 文件。
6. 是否处于 429 冷却状态。

如果配置完整且没有暂停标记，应用可以自动继续同步。自动继续需要遵守当前速度模式和冷却状态。

### 控制按钮

第一版只保留必要控制：

- 连续运行：启动连续 worker。
- 停止：写入 stop-worker 标记，并请求当前 worker 在安全点退出。
- 查看状态：展示当前队列、当前游戏、扫描页码、冷却状态、最近写入结果。
- 查看日志：展示 worker log 和当前运行输出。

“恢复”不作为独立主按钮。因为它的语义容易和“连续运行”混淆。设计上把恢复并入“连续运行”：

- 如果存在 stop-worker，点击连续运行时先提示“当前处于暂停状态，是否清除暂停并继续？”
- 用户确认后清除 stop-worker，再启动连续 worker。

## 配置管理

GUI 提供配置页，支持编辑：

- Steam ID64
- Steam API Key
- Obsidian vault 路径
- Steam 体验记录输出目录
- state 文件路径
- worker log 路径
- stop-worker 文件路径
- 请求间隔
- 翻页间隔
- worker 每轮页数
- worker 每轮最大截图数
- 速度模式
- 写入预览模式

API Key 默认隐藏，只显示占位状态，例如“已填写”或“未填写”。用户点击显示按钮后才短暂显示。

配置保存时写入本地配置文件。第一版可以继续兼容 `.env`，但 GUI 不应把真实 API Key 写入 README、日志、Markdown 笔记或 Git 跟踪文件。

## 写入预览

写入预览作为配置项，支持三种模式：

1. 自动写入：worker 匹配到新截图后直接写入 Obsidian。
2. 每轮确认：本轮扫描结束后展示待写入列表，用户确认后写入。
3. 预览后自动写入：展示预览并倒计时，倒计时结束后自动写入。

第一版默认使用“每轮确认”，因为它最适合验证桌面版写入路径和格式是否正确。用户可以在设置里切换为自动写入。

预览内容至少包括：

- 游戏名
- appid
- 截图数量
- 每张截图的发布日期
- 用户评价
- 目标 Markdown 文件路径
- 是否为新文件或追加写入

## 减少空跑策略

当前空跑的主要原因是按 appid 队列扫描；如果某个游戏没有用户公开截图，就会反复扫到 0。

桌面版第一阶段改成“先发现截图，再按游戏分组”：

1. 第一次运行执行全量发现：
   - 扫描用户公开 Steam 截图流。
   - 记录所有可见 screenshot publishedfileid。
   - 对每个截图详情页解析 appid、游戏名、发布时间、评价、图片地址。
   - 将真实存在截图的游戏写入本地 discovered games 索引。
2. 之后执行增量发现：
   - 从最新公开截图页开始扫描。
   - 遇到已处理 screenshot id 后停止或降速。
   - 只处理新截图。
3. worker 队列由 discovered games / new screenshots 生成，而不是由手工 appid 列表盲扫。

这样可以把“没有我截图的游戏”过滤掉，避免明显浪费请求。

## 速度和风控策略

第一版默认使用“平衡模式”：

- 正常请求使用中等间隔。
- 遇到 429 或疑似 Cloudflare 风控时，自动进入降速状态。
- 降速后继续尝试，但连续失败 3 次后暂停 worker。
- 暂停时发送桌面通知，并在 GUI 明确显示原因。

速度模式：

- 安全：更长间隔，适合全量首次扫描。
- 平衡：默认模式，效率和稳定性折中。
- 快速：更短间隔，仍然保留 429 自动降速，不做绕过。

所有模式都必须遵守同一条边界：不绕过 Steam / Cloudflare 防护。

## 错误处理

应用要区分这些状态：

- Node.js 未安装或版本不满足。
- Obsidian vault 路径不存在。
- API Key 缺失，但同步仍可运行，只是不补充游玩时长。
- Steam 页面请求失败。
- 429 / 风控冷却。
- 写入 Markdown 失败。
- stop-worker 人为暂停。
- 当前已有 worker 正在运行。

错误展示要可操作，例如：

- “安装 Node.js 后重启应用”
- “重新选择 Obsidian vault 路径”
- “当前已触发 429，已自动降速；连续失败 3 次后会暂停”

## 通知

第一版使用 Tauri 本地通知：

- 本轮完成：展示写入数量和游戏数量。
- 发现新截图：可选通知。
- 遇到 429 并降速：通知。
- 连续失败 3 次后暂停：强通知。
- 写入失败：强通知。

通知内容不能包含 API Key 或敏感路径的完整细节。

## UI 结构

第一版采用工具型 + Obsidian 克制风。

页面结构：

1. Dashboard
   - 当前状态
   - 当前游戏
   - 当前模式
   - 今日/本轮写入数量
   - 主要操作按钮
2. Queue
   - discovered games
   - 当前扫描进度
   - 每个游戏的截图数量和最后更新时间
3. Preview
   - 待写入截图列表
   - 目标 Markdown 文件
   - 确认写入 / 跳过本轮
4. Logs
   - worker log
   - 当前进程输出
   - 失败原因筛选
5. Settings
   - 路径配置
   - Steam 配置
   - 速度模式
   - 预览模式

第一版不做大面积游戏封面装饰。封面和 PS / Switch 风格留到第二阶段。

## 跨平台策略

第一版目标：

- Windows：开发和主要验证平台。
- macOS：结构兼容，README 写明安装 Node.js、运行和打包方式。

路径处理必须使用平台安全 API，不写死 `D:\` 或反斜杠。配置里保存用户选择的绝对路径。

后续发布：

1. 源码运行：`npm install` + `npm run tauri dev`。
2. Windows exe：Tauri build 产物。
3. macOS dmg：在 Mac mini 或 MacBook 上构建。
4. 免 Node 分发：后续通过 sidecar 或核心迁移实现，不放进第一版。

## 数据和文件

新增或保留的数据文件：

- `.env`：兼容现有命令行配置，默认不提交。
- GUI 配置文件：保存可编辑配置。
- `state.json`：保存已处理截图和进度。
- `worker.log`：保存 worker 日志。
- `discovered-games.json`：保存真实发现过截图的游戏索引。
- `pending-writes.json`：保存待确认写入的预览队列。

这些文件应默认位于 vault 的 `.obsidian/steam-experience-sync/` 或项目本地配置目录中。API Key 不应写入 Obsidian 笔记正文。

## 验收标准

第一版完成时必须满足：

1. Windows 上能启动 Tauri 桌面应用。
2. GUI 能读取和保存配置。
3. GUI 能检测 Node.js 是否可用。
4. GUI 能启动连续 worker。
5. GUI 能停止 worker。
6. GUI 能显示 worker 状态和日志。
7. GUI 能执行第一次全量发现，并生成 discovered games 索引。
8. GUI 能执行增量发现，避免重复导入已处理截图。
9. GUI 能在写入前展示预览，并按配置决定确认写入或自动写入。
10. 遇到 429 时能自动降速，连续失败 3 次后暂停并通知。
11. 生成的 Obsidian Markdown 仍保持当前游戏文档结构和 CSS class。
12. README 说明 Windows 和 macOS 的运行方式。
13. GitHub 仓库不包含真实 API Key、Cookie、日志中的敏感信息或本地个人配置。

## 实施分期

### Phase 1: Tauri 壳和基础控制

建立 React + Tauri 项目结构，接入现有 Node worker，实现配置读取、状态显示、连续运行、停止和日志读取。

### Phase 2: 配置页和通知

实现 GUI 配置编辑、API Key 隐藏显示、本地通知、错误状态展示。

### Phase 3: 截图发现和预览写入

实现 discovered games 索引、第一次全量发现、增量发现、pending writes、写入预览和确认写入。

### Phase 4: 跨平台文档和打包

整理 README，补充 Windows / macOS 运行说明，验证 Windows build，为未来 macOS dmg 保留构建路径。

## 风险

1. Tauri 打包后调用 Node worker 的路径处理会比开发模式复杂。
2. Steam 页面结构可能变化，截图解析逻辑需要保持可诊断日志。
3. 首次全量发现仍可能触发 429，因此默认速度不能过激。
4. macOS 权限、签名和 dmg 发布需要在真实 Mac 环境验证。
5. 如果未来要免 Node 安装，需要额外处理 sidecar 或重写同步核心。

## 决策记录

1. 第一版接受用户先安装 Node.js。
2. 第一版不做系统开机自启。
3. 第一版不使用 Cookie 或登录态。
4. 第一版以稳定控制台体验为主，不优先追求游戏库视觉。
5. 减少空跑是第一版核心功能，不推迟到纯美化阶段。
