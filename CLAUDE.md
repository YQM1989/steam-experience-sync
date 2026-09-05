# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

把公开 Steam 截图动态同步到 Obsidian vault 的轻量工具。不是备份完整游戏库，而是记录"主动截图并写过评价的游戏体验"。

技术栈：Node.js CLI 核心 + React (Tauri 桌面壳) + Rust (Tauri 桥接层)。

## 常用命令

```bash
# 运行同步（预览/正式）
npm start -- --dry-run                    # 预览模式
npm start -- --pages 2 --limit 10         # 限制页数和条目
npm start                                 # 正式写入

# Discovery → Plan → Apply 三步流水线
npm start -- --discover --pages 3 --request-delay-ms 10000
npm start -- --plan-writes --pages 1 --limit 5 --request-delay-ms 10000
npm start -- --apply-pending

# Worker 模式（低频分批历史同步）
npm run worker                            # 运行一轮
npm run worker:loop                       # 连续运行多轮
npm run worker:status                     # 查看队列进度
npm run worker:stop                       # 创建停止标记
npm run worker:resume                     # 清除停止标记
npm run worker:dry-run                    # Worker 预览

# 测试
npm test                                  # Node 原生 test runner
npm run test:ui                           # Vitest (React 组件)

# 语法检查 + 构建验证
npm run check                             # node --check + vite build

# Tauri 桌面应用
npm run tauri:dev                         # 开发模式
npm run tauri:build                       # 打包

# 旧版网页 GUI（fallback）
npm run gui                               # http://127.0.0.1:8765

# React 前端单独开发
npm run ui:dev                            # Vite dev server :1420
npm run ui:build                          # 构建到 dist/
```

## 架构

### 核心同步引擎 (`src/index.mjs`)

整个同步逻辑在一个 1200 行的单文件中，是一切的入口。内部按功能划分为：

- **配置解析** (`readConfig`, `parseArgs`)：从 `.env` + 命令行参数拼出运行时 config 对象。
- **页面抓取** (`collectScreenshotIdPages`)：遍历 Steam 公开截图列表页，正则提取 screenshot ID。
- **详情抓取** (`fetchScreenshotDetail`, `fetchGameCover`, `fetchOwnedGamePlaytimes`)：逐个请求 Steam 截图详情页、商店 API 获取封面图、GetOwnedGames 获取时长。
- **Obsidian 写入** (`upsertExperienceNote`, `createNote`, `createScreenshotBlock`)：生成/更新 Markdown 文件，含 YAML frontmatter + HTML 截图卡片。
- **Worker 模式** (`runWorker`, `runWorkerLoop`)：feed 模式从最新截图页增量处理；`--worker-loop` 连续处理积压，首轮确认最新页无未处理截图后自动退出。带冷却、停止标记、日志记录。
- **Discovery → Plan → Apply 流水线**：三步分离的写入流程 — 先发现游戏，再生成待写入队列，最后确认写入。仅用于历史补录，日常增量不走此流程。

### 核心模块 (`src/core/`)

| 文件 | 职责 |
|---|---|
| `config-store.mjs` | GUI 配置（JSON 文件读写），独立于 .env |
| `config-schema.mjs` | GUI 配置的默认值和规范化 |
| `discovery-store.mjs` | 已发现游戏的索引（appid → 截图列表） |
| `pending-writes.mjs` | 待写入队列（plan → apply 流程） |
| `rate-state.mjs` | 限流失败计数和暂停判断（3 次 → 停止） |
| `steam-date.mjs` | Steam 发布时间解析（英文月日格式） |
| `paths.mjs` | vault 内状态文件路径解析 |
| `status.mjs` | Worker 运行时状态读取 |
| `logs.mjs` | Worker JSON 日志读取 |
| `dotenv.mjs` | .env 文件加载（不覆盖已有环境变量） |

### 状态文件（位于 vault 的 `.obsidian/steam-experience-sync/`）

- `state.json`：已同步截图 ID 列表 + worker 进度（每个 appid 的页码、已导入数等）
- `discovered-games.json`：discovery 索引，减少后续空扫
- `pending-writes.json`：待确认写入队列
- `worker.log`：JSON 行格式的运行日志
- `stop-worker`：停止标记文件（存在即暂停）

### Tauri 桌面应用

**关键设计：Tauri Rust 端不重复实现同步逻辑。** Rust commands (`src-tauri/src/commands.rs`) 通过 `std::process::Command` 调 `node src/index.mjs` 来执行所有同步操作。项目根目录通过向上查找 `src/index.mjs` 定位。

- `src-tauri/src/main.rs` → 入口
- `src-tauri/src/lib.rs` → Tauri Builder，注册所有 commands
- `src-tauri/src/commands.rs` → 每个 Tauri command 对应一个 Node 子进程调用

React 前端 (`src-ui/`) 通过 `@tauri-apps/api` 的 `invoke` 调用 Rust commands：

| Tab | 功能 |
|---|---|
| Dashboard | 开始同步/停止/刷新状态 |
| Logs | 查看运行日志 |
| Settings | 编辑配置（Steam ID、API Key、vault 路径等） |

Preview 标签已在 2026-09-05 移除：日常 feed 同步直接写入笔记，不经过预览队列。历史补录仍用命令行流程（`--plan-writes` → `--read-pending` → `--apply-pending`）。

`notifications.ts` 使用 `@tauri-apps/plugin-notification` 在连续限流暂停时弹系统通知。

### 旧版 GUI (`src/gui.mjs`)

一个内嵌 HTML 的 HTTP 服务器（`127.0.0.1:8765`），提供运行控制和实时日志。已不作为主要界面，但保留为 fallback。

### 迁移脚本 (`scripts/`)

- `migrate-flat-game-notes.mjs`：将游戏子目录 + 日期子目录的旧格式合并为扁平单文件
- `convert-shot-cards.mjs`：将旧 Markdown 截图格式（`### 时间` + callout）转换为新 HTML 卡片格式

### Obsidian 输出

默认输出路径：`<vault>/00_输入源/50_我是谁/Steam体验记录/<游戏名>.md`

每个文件是 YAML frontmatter + HTML hero 区域 + 按日期分段的截图卡片。样式片段见 `docs/obsidian-steam-experience.css`。

## 运行环境要求

- Node.js >= 18
- Windows：无需额外依赖
- macOS：需 Rust toolchain + Xcode Command Line Tools（仅 Tauri 构建需要）
- `.env` 中 `STEAM_ID` 和 `OBSIDIAN_VAULT_DIR` 为必填；`STEAM_API_KEY` 仅用于补充游玩时长

## 关键约束

- 只读取公开 Steam 页面，不保存/复用 Cookie 和登录态
- 不绕过验证码、Cloudflare 或 Steam 风控
- 遇到 429 自动冷却；连续 3 次限流写 stop file 并暂停
- API Key 不能写入 Obsidian 笔记、README、日志或 Git（`.env` 已在 `.gitignore`）
- `.steam-experience-sync/config.json` 已在 `.gitignore`，存储 GUI 配置（含 API Key）
- 内部 JSON 时间存 ISO 格式；显示时统一用北京时间
- 状态文件路径使用 vault-relative 路径，通过 `fromVaultPath()` 转换为系统路径
- `src-tauri/src/main.rs` 的 `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 不能删：删了 release exe 双击会弹终端窗口
- Node 子进程必须通过 `commands.rs` 的 `node_command()` 创建（自带 Windows `CREATE_NO_WINDOW`）：直接 `Command::new("node")` 会在 GUI 模式下闪现控制台窗口
- 网络注意：Node 原生 fetch 不读 Windows 系统代理，同步要求代理软件开 TUN/增强模式，否则 Steam 页面抓取报 `fetch failed`

## 近期变更

### 2026-09-05

- **防终端窗口**：`main.rs` 补上 `windows_subsystem = "windows"`（仅 release），双击 exe 不再弹出控制台；`commands.rs` 新增 `node_command()` 统一给 4 处 Node 子进程加 `CREATE_NO_WINDOW`，避免同步时闪现控制台。
- **移除 Preview 标签页**：日常 feed 同步直接写入，预览确认流程从 GUI 移除；相关 Tauri 命令（`plan_writes`、`read_pending_writes`、`apply_pending_writes`、`clear_pending_writes`）一并删除，命令行入口保留。
- **移除死配置 previewMode**：Settings 的"写入预览"下拉框后端从未读取，已从前端、`config-schema.mjs` 删除；`normalizeGuiConfig` 读取旧配置时自动剔除残留字段。
- **feed 循环自动结束**（7-29 遗留改动一并入库）：`--worker-loop` 处理完当前积压、确认最新页无未处理截图后自动退出，不再无限轮询；GUI 按钮"连续运行"改名"开始同步"。

### 2026-07-29（前一版本）

- release exe 修复启动时配置保存失败；GUI worker 与限流控制稳定化；优先同步最新 Steam 截图。
