# Steam Experience Sync Tauri Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React + Tauri desktop app that controls the existing Node.js Steam screenshot sync workflow, supports editable configuration, logs/status, notifications, discovery-based scanning, and write previews.

**Architecture:** Keep the existing Node.js sync core as the source of truth for Steam/Obsidian logic. Add a Tauri desktop shell that calls focused Node commands through Rust commands, while React renders status, queue, preview, logs, and settings. Avoid rewriting the sync core in Rust in this version.

**Tech Stack:** Node.js >= 18, React, Vite, TypeScript, Tauri v2, Rust, existing `src/index.mjs`, Obsidian Markdown output.

## Global Constraints

- First version must work on Windows and remain structurally compatible with macOS.
- First version may require users to install Node.js separately.
- Do not add system startup/autostart.
- Do not use Steam cookies, login state, proxy pools, CAPTCHA bypass, or Cloudflare bypass.
- API Key must be hidden by default and never written into README, Markdown notes, worker logs, or Git-tracked files.
- GUI starts in a tool-like, restrained Obsidian style; Switch/PlayStation visual style is deferred.
- Encountering 429 must trigger adaptive slowdown; after 3 consecutive failed slowed attempts, pause and notify.
- Obsidian output must keep the current per-game Markdown document structure and `steam-experience` CSS class.
- Keep changes incremental and commit after each independently testable task.

---

## File Structure

Create or modify these areas:

- `package.json`: add React/Tauri scripts and test scripts.
- `index.html`: Vite root HTML.
- `vite.config.ts`: Vite config for React and Tauri dev.
- `tsconfig.json`, `tsconfig.node.json`: TypeScript config.
- `src-ui/`: React frontend source.
- `src-tauri/`: Tauri Rust shell.
- `src/core/`: focused Node modules extracted from `src/gui.mjs` and `src/index.mjs`.
- `tests/`: Node core tests.
- `docs/superpowers/specs/2026-06-23-tauri-desktop-app-design.md`: source spec.
- `README.md`: updated run/build instructions.

Do not delete `src/gui.mjs` in the first pass. Keep it as a fallback until the Tauri app is verified.

---

### Task 1: Add React + Tauri Project Skeleton

**Files:**
- Modify: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src-ui/main.tsx`
- Create: `src-ui/App.tsx`
- Create: `src-ui/styles.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `npm run tauri:dev`, `npm run tauri:build`, `npm run ui:dev`, `npm run ui:build`.
- Produces a Tauri app window named `Steam Experience Sync`.
- No worker integration yet.

- [ ] **Step 1: Install dependencies**

Run:

```powershell
npm install react react-dom @tauri-apps/api @tauri-apps/plugin-notification
npm install -D @vitejs/plugin-react vite typescript @types/react @types/react-dom @tauri-apps/cli vitest jsdom @testing-library/react @testing-library/jest-dom
```

Expected:

```text
added ... packages
found 0 vulnerabilities
```

- [ ] **Step 2: Update `package.json` scripts**

Add these scripts while preserving existing scripts:

```json
{
  "scripts": {
    "ui:dev": "vite",
    "ui:build": "vite build",
    "ui:preview": "vite preview",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "test": "node --test tests/**/*.test.mjs",
    "test:ui": "vitest run",
    "check": "node --check src/index.mjs && node --check src/gui.mjs && npm run ui:build"
  }
}
```

- [ ] **Step 3: Create Vite entry files**

`index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Steam Experience Sync</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src-ui/main.tsx"></script>
  </body>
</html>
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
```

- [ ] **Step 4: Create TypeScript config**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src-ui"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create first React app**

`src-ui/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src-ui/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <section className="panel">
        <p className="eyebrow">Steam Experience Sync</p>
        <h1>Steam 体验记录控制台</h1>
        <p className="muted">桌面版初始化完成，下一步接入 worker 状态。</p>
      </section>
    </main>
  );
}
```

`src-ui/styles.css`:

```css
:root {
  color: #e7e1d8;
  background: #171717;
  font-family:
    Inter, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 960px;
  min-height: 640px;
}

.app-shell {
  min-height: 100vh;
  padding: 32px;
  background: #171717;
}

.panel {
  max-width: 960px;
  border: 1px solid #353535;
  border-radius: 8px;
  padding: 24px;
  background: #202020;
}

.eyebrow {
  margin: 0 0 8px;
  color: #9f8fff;
  font-size: 13px;
}

h1 {
  margin: 0 0 12px;
  font-size: 28px;
  letter-spacing: 0;
}

.muted {
  color: #b8b3ad;
}
```

- [ ] **Step 6: Create Tauri config**

`src-tauri/Cargo.toml`:

```toml
[package]
name = "steam-experience-sync"
version = "0.1.0"
description = "Steam screenshot experience sync desktop app"
authors = ["YQM"]
edition = "2021"

[lib]
name = "steam_experience_sync_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-notification = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

`src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Steam Experience Sync",
  "version": "0.1.0",
  "identifier": "com.yqm.steam-experience-sync",
  "build": {
    "beforeDevCommand": "npm run ui:dev",
    "devUrl": "http://127.0.0.1:1420",
    "beforeBuildCommand": "npm run ui:build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Steam Experience Sync",
        "width": 1180,
        "height": 760,
        "minWidth": 960,
        "minHeight": 640
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

`src-tauri/src/main.rs`:

```rust
fn main() {
    steam_experience_sync_lib::run()
}
```

`src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Verify skeleton**

Run:

```powershell
npm run ui:build
npm run tauri:dev
```

Expected:

```text
vite v... building...
✓ built
```

Tauri window opens and shows “Steam 体验记录控制台”.

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.node.json src-ui src-tauri
git commit -m "feat: 初始化 React Tauri 桌面应用"
```

---

### Task 2: Extract Shared Node Status, Config, and Log Modules

**Files:**
- Create: `src/core/dotenv.mjs`
- Create: `src/core/paths.mjs`
- Create: `src/core/status.mjs`
- Create: `src/core/logs.mjs`
- Modify: `src/gui.mjs`
- Test: `tests/core/status.test.mjs`

**Interfaces:**
- Produces `loadDotEnvFile(filePath: string): Record<string, string>`.
- Produces `resolveRuntimePaths(projectRoot: string, env: Record<string, string>): RuntimePaths`.
- Produces `readRuntimeStatus(paths: RuntimePaths): Promise<RuntimeStatus>`.
- Produces `readWorkerLog(paths: RuntimePaths, limit?: number): Promise<string[]>`.
- `src/gui.mjs` must call these functions instead of holding duplicate status/log parsing logic.

- [ ] **Step 1: Write failing status test**

`tests/core/status.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveRuntimePaths } from '../../src/core/paths.mjs';
import { readRuntimeStatus } from '../../src/core/status.mjs';

test('readRuntimeStatus reports stop file and state progress', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-'));
  const vault = path.join(root, 'vault');
  await fs.mkdir(path.join(vault, '.obsidian', 'steam-experience-sync'), { recursive: true });
  await fs.writeFile(
    path.join(vault, '.obsidian', 'steam-experience-sync', 'state.json'),
    JSON.stringify({
      worker: {
        queue: ['2758000'],
        currentIndex: 0,
        pages: { '2758000': { nextPage: 4 } },
        lastRunAt: '2026-06-22T13:47:04.000Z'
      }
    }),
  );
  await fs.writeFile(path.join(vault, '.obsidian', 'steam-experience-sync', 'stop-worker'), '');

  const paths = resolveRuntimePaths(root, {
    OBSIDIAN_VAULT_DIR: vault,
    STEAM_SYNC_STATE: '.obsidian/steam-experience-sync/state.json',
    STEAM_WORKER_LOG: '.obsidian/steam-experience-sync/worker.log',
    STEAM_WORKER_STOP_FILE: '.obsidian/steam-experience-sync/stop-worker',
  });

  const status = await readRuntimeStatus(paths);

  assert.equal(status.stopRequested, true);
  assert.equal(status.nextAppid, '2758000');
  assert.equal(status.pages['2758000'].nextPage, 4);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npm test
```

Expected:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement `src/core/paths.mjs`**

```js
import path from 'node:path';

export function fromVaultPath(value) {
  return String(value || '').replaceAll('/', path.sep).replaceAll('\\', path.sep);
}

export function resolveRuntimePaths(projectRoot, env) {
  const vaultDir = env.OBSIDIAN_VAULT_DIR || '';
  return {
    projectRoot,
    vaultDir,
    stateFile: vaultDir
      ? path.resolve(vaultDir, fromVaultPath(env.STEAM_SYNC_STATE || '.obsidian/steam-experience-sync/state.json'))
      : '',
    workerLogFile: vaultDir
      ? path.resolve(vaultDir, fromVaultPath(env.STEAM_WORKER_LOG || '.obsidian/steam-experience-sync/worker.log'))
      : '',
    stopFile: vaultDir
      ? path.resolve(vaultDir, fromVaultPath(env.STEAM_WORKER_STOP_FILE || '.obsidian/steam-experience-sync/stop-worker'))
      : '',
  };
}
```

- [ ] **Step 4: Implement `src/core/status.mjs`**

```js
import fsSync from 'node:fs';
import fs from 'node:fs/promises';

export async function readRuntimeStatus(paths) {
  const state = await readJson(paths.stateFile, {});
  const worker = state.worker || {};
  const queue = Array.isArray(worker.queue) ? worker.queue : [];
  const currentIndex = Number.isInteger(worker.currentIndex) ? worker.currentIndex : 0;
  const nextAppid = queue[currentIndex] || queue[0] || '';

  return {
    vaultConfigured: Boolean(paths.vaultDir),
    stateFile: paths.stateFile,
    workerLogFile: paths.workerLogFile,
    stopFile: paths.stopFile,
    stopRequested: Boolean(paths.stopFile && fsSync.existsSync(paths.stopFile)),
    queue,
    currentIndex,
    nextAppid,
    pages: worker.pages || {},
    lastRunAt: worker.lastRunAt || '',
    cooldownUntil: worker.cooldownUntil || '',
  };
}

async function readJson(filePath, fallback) {
  if (!filePath || !fsSync.existsSync(filePath)) return fallback;
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
```

- [ ] **Step 5: Implement `src/core/logs.mjs`**

```js
import fsSync from 'node:fs';
import fs from 'node:fs/promises';

export async function readWorkerLog(paths, limit = 120) {
  if (!paths.workerLogFile || !fsSync.existsSync(paths.workerLogFile)) return [];
  const raw = await fs.readFile(paths.workerLogFile, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);
}
```

- [ ] **Step 6: Implement `src/core/dotenv.mjs`**

```js
import fsSync from 'node:fs';
import fs from 'node:fs/promises';

export async function loadDotEnvFile(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return {};
  const raw = await fs.readFile(filePath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}
```

- [ ] **Step 7: Refactor `src/gui.mjs`**

Replace local dotenv/path/status/log helpers with imports:

```js
import { loadDotEnvFile } from './core/dotenv.mjs';
import { resolveRuntimePaths } from './core/paths.mjs';
import { readWorkerLog } from './core/logs.mjs';
import { readRuntimeStatus } from './core/status.mjs';
```

Keep HTTP routes unchanged.

- [ ] **Step 8: Verify tests**

Run:

```powershell
npm test
node --check src/gui.mjs
npm run check
```

Expected:

```text
ok 1 - readRuntimeStatus reports stop file and state progress
```

- [ ] **Step 9: Commit**

```powershell
git add src/core src/gui.mjs tests package.json
git commit -m "refactor: 抽出运行状态和日志模块"
```

---

### Task 3: Add Tauri Commands for Status, Logs, Start, and Stop

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-ui/App.tsx`
- Create: `src-ui/tauriApi.ts`

**Interfaces:**
- Produces Tauri commands: `get_status`, `get_logs`, `start_worker_loop`, `stop_worker`.
- Frontend consumes `getStatus()`, `getLogs()`, `startWorkerLoop()`, `stopWorker()` from `src-ui/tauriApi.ts`.

- [ ] **Step 1: Add Rust command module**

`src-tauri/src/commands.rs`:

```rust
use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Serialize)]
pub struct CommandResult {
    ok: bool,
    message: String,
}

fn project_root() -> Result<PathBuf, String> {
    std::env::current_dir().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_status() -> Result<String, String> {
    let root = project_root()?;
    let output = Command::new("node")
        .arg("src/index.mjs")
        .arg("--worker-status")
        .current_dir(root)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub fn get_logs() -> Result<String, String> {
    let root = project_root()?;
    let output = Command::new("node")
        .arg("src/index.mjs")
        .arg("--worker-status")
        .current_dir(root)
        .output()
        .map_err(|error| error.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn start_worker_loop() -> Result<CommandResult, String> {
    let root = project_root()?;
    Command::new("node")
        .arg("src/index.mjs")
        .arg("--worker-loop")
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(CommandResult {
        ok: true,
        message: "worker loop started".to_string(),
    })
}

#[tauri::command]
pub fn stop_worker() -> Result<CommandResult, String> {
    let root = project_root()?;
    let output = Command::new("node")
        .arg("src/index.mjs")
        .arg("--stop-worker")
        .current_dir(root)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(CommandResult {
            ok: true,
            message: String::from_utf8_lossy(&output.stdout).to_string(),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

- [ ] **Step 2: Register commands**

`src-tauri/src/lib.rs`:

```rust
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::get_logs,
            commands::start_worker_loop,
            commands::stop_worker
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Add frontend API wrapper**

`src-ui/tauriApi.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export type CommandResult = {
  ok: boolean;
  message: string;
};

export async function getStatus(): Promise<string> {
  return invoke<string>('get_status');
}

export async function getLogs(): Promise<string> {
  return invoke<string>('get_logs');
}

export async function startWorkerLoop(): Promise<CommandResult> {
  return invoke<CommandResult>('start_worker_loop');
}

export async function stopWorker(): Promise<CommandResult> {
  return invoke<CommandResult>('stop_worker');
}
```

- [ ] **Step 4: Wire Dashboard buttons**

Update `src-ui/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getLogs, getStatus, startWorkerLoop, stopWorker } from './tauriApi';

export function App() {
  const [status, setStatus] = useState('未读取');
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setStatus(await getStatus());
    setLogs(await getLogs());
  }

  async function runLoop() {
    setBusy(true);
    try {
      await startWorkerLoop();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await stopWorker();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(String(error)));
  }, []);

  return (
    <main className="app-shell">
      <section className="panel">
        <p className="eyebrow">Steam Experience Sync</p>
        <h1>Steam 体验记录控制台</h1>
        <div className="toolbar">
          <button disabled={busy} onClick={runLoop}>连续运行</button>
          <button disabled={busy} onClick={stop}>停止</button>
          <button disabled={busy} onClick={refresh}>刷新状态</button>
        </div>
        <h2>状态</h2>
        <pre>{status}</pre>
        <h2>日志</h2>
        <pre>{logs || '暂无日志'}</pre>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Verify commands**

Run:

```powershell
npm run tauri:dev
```

Expected:

- Window opens.
- “刷新状态” displays worker status.
- “停止” creates stop-worker.
- “连续运行” starts worker loop or reports a clear error.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri src-ui
git commit -m "feat: 接入 Tauri worker 控制命令"
```

---

### Task 4: Build Settings Screen and Safe Config Persistence

**Files:**
- Create: `src/core/config-schema.mjs`
- Create: `src/core/config-store.mjs`
- Test: `tests/core/config-store.test.mjs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-ui/App.tsx`
- Create: `src-ui/Settings.tsx`

**Interfaces:**
- Produces `readGuiConfig(projectRoot): Promise<GuiConfig>`.
- Produces `writeGuiConfig(projectRoot, config): Promise<GuiConfig>`.
- GUI config file path: `.steam-experience-sync/config.json`.
- API Key stored in local config or `.env`, never printed in full.

- [ ] **Step 1: Write failing config test**

`tests/core/config-store.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readGuiConfig, writeGuiConfig } from '../../src/core/config-store.mjs';

test('writeGuiConfig stores api key but redacts public view', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-sync-config-'));
  await writeGuiConfig(root, {
    steamId: '76561198119055866',
    steamApiKey: 'secret-key',
    vaultDir: 'D:/YQM-Obsidian',
    speedMode: 'balanced',
    previewMode: 'confirm_each_run'
  });

  const config = await readGuiConfig(root);

  assert.equal(config.steamApiKey, 'secret-key');
  assert.equal(config.publicSteamApiKeyState, 'filled');
});
```

- [ ] **Step 2: Implement config store**

`src/core/config-schema.mjs`:

```js
export const DEFAULT_GUI_CONFIG = {
  steamId: '',
  steamApiKey: '',
  vaultDir: '',
  experienceDir: '00_输入源/50_我是谁/Steam体验记录',
  statePath: '.obsidian/steam-experience-sync/state.json',
  workerLogPath: '.obsidian/steam-experience-sync/worker.log',
  stopWorkerPath: '.obsidian/steam-experience-sync/stop-worker',
  requestDelayMs: 10000,
  pageDelayMs: 15000,
  workerPages: 3,
  workerMaxScreenshots: 20,
  speedMode: 'balanced',
  previewMode: 'confirm_each_run',
};

export function normalizeGuiConfig(input = {}) {
  return {
    ...DEFAULT_GUI_CONFIG,
    ...input,
    requestDelayMs: Number(input.requestDelayMs || DEFAULT_GUI_CONFIG.requestDelayMs),
    pageDelayMs: Number(input.pageDelayMs || DEFAULT_GUI_CONFIG.pageDelayMs),
    workerPages: Number(input.workerPages || DEFAULT_GUI_CONFIG.workerPages),
    workerMaxScreenshots: Number(input.workerMaxScreenshots || DEFAULT_GUI_CONFIG.workerMaxScreenshots),
  };
}
```

`src/core/config-store.mjs`:

```js
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeGuiConfig } from './config-schema.mjs';

export function guiConfigPath(projectRoot) {
  return path.join(projectRoot, '.steam-experience-sync', 'config.json');
}

export async function readGuiConfig(projectRoot) {
  const filePath = guiConfigPath(projectRoot);
  if (!fsSync.existsSync(filePath)) {
    return withPublicState(normalizeGuiConfig());
  }
  const raw = await fs.readFile(filePath, 'utf8');
  return withPublicState(normalizeGuiConfig(JSON.parse(raw)));
}

export async function writeGuiConfig(projectRoot, config) {
  const normalized = normalizeGuiConfig(config);
  const filePath = guiConfigPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(normalized, null, 2));
  return withPublicState(normalized);
}

function withPublicState(config) {
  return {
    ...config,
    publicSteamApiKeyState: config.steamApiKey ? 'filled' : 'empty',
  };
}
```

- [ ] **Step 3: Ignore local GUI config**

Append to `.gitignore`:

```gitignore
.steam-experience-sync/
```

- [ ] **Step 4: Add Tauri config commands**

Add commands:

```rust
#[tauri::command]
pub fn read_config() -> Result<String, String> {
    let root = project_root()?;
    let output = Command::new("node")
        .arg("-e")
        .arg("import('./src/core/config-store.mjs').then(async m => console.log(JSON.stringify(await m.readGuiConfig(process.cwd()))))")
        .current_dir(root)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

For `write_config`, pass JSON as stdin or use a temporary file. Use stdin to avoid command-line leakage of API Key.

- [ ] **Step 5: Build `Settings.tsx`**

Fields:

- Steam ID64
- Steam API Key password input
- Obsidian vault path
- speed mode select
- preview mode select
- request/page delay numeric inputs

Do not render the API Key in logs or status text.

- [ ] **Step 6: Verify**

Run:

```powershell
npm test
npm run tauri:dev
```

Expected:

- Settings loads defaults.
- Saving creates `.steam-experience-sync/config.json`.
- API Key input is `type="password"`.
- `.steam-experience-sync/config.json` is not shown in `git status`.

- [ ] **Step 7: Commit**

```powershell
git add .gitignore src/core src-tauri src-ui tests
git commit -m "feat: 新增桌面端配置管理"
```

---

### Task 5: Implement Discovery Index to Reduce Empty Scans

**Files:**
- Create: `src/core/discovery-store.mjs`
- Create: `src/core/discovery.mjs`
- Test: `tests/core/discovery-store.test.mjs`
- Modify: `src/index.mjs`

**Interfaces:**
- Produces `readDiscoveryIndex(paths): Promise<DiscoveryIndex>`.
- Produces `writeDiscoveryIndex(paths, index): Promise<void>`.
- Produces CLI flag `--discover`.
- Discovery index file: `.obsidian/steam-experience-sync/discovered-games.json`.

- [ ] **Step 1: Write failing discovery store test**

`tests/core/discovery-store.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readDiscoveryIndex, writeDiscoveryIndex } from '../../src/core/discovery-store.mjs';

test('discovery index stores games with screenshot ids', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-discovery-'));
  const filePath = path.join(root, 'discovered-games.json');

  await writeDiscoveryIndex(filePath, {
    games: {
      '2358720': {
        appid: '2358720',
        name: 'Black Myth: Wukong',
        screenshotIds: ['3739717708'],
        lastSeenAt: '2024-09-30T01:04:00.000Z'
      }
    }
  });

  const index = await readDiscoveryIndex(filePath);

  assert.equal(index.games['2358720'].name, 'Black Myth: Wukong');
  assert.deepEqual(index.games['2358720'].screenshotIds, ['3739717708']);
});
```

- [ ] **Step 2: Implement discovery store**

`src/core/discovery-store.mjs`:

```js
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readDiscoveryIndex(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return { games: {} };
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function writeDiscoveryIndex(filePath, index) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2));
}

export function upsertDiscoveredScreenshot(index, screenshot) {
  const appid = String(screenshot.appid || '');
  if (!appid) return index;
  const existing = index.games[appid] || {
    appid,
    name: screenshot.game || '',
    screenshotIds: [],
    lastSeenAt: '',
  };
  const ids = new Set(existing.screenshotIds);
  ids.add(String(screenshot.id));
  index.games[appid] = {
    ...existing,
    name: screenshot.game || existing.name,
    screenshotIds: [...ids],
    lastSeenAt: screenshot.postedAt || existing.lastSeenAt,
  };
  return index;
}
```

- [ ] **Step 3: Add `--discover` mode**

Modify `src/index.mjs`:

- `parseArgs` recognizes `--discover`.
- `readConfig` computes `discoveryFile`.
- `main()` routes `args.discover` to `runDiscovery(config, args, state)`.

`runDiscovery` should reuse existing screenshot page collection and detail parsing, but only write `discovered-games.json`; it must not write Markdown.

- [ ] **Step 4: Verify discovery**

Run:

```powershell
node src/index.mjs --discover --pages 1 --request-delay-ms 10000
```

Expected:

```text
Discovered ... game(s), ... screenshot(s).
```

Verify file exists:

```powershell
Test-Path "D:\YQM-Obsidian\.obsidian\steam-experience-sync\discovered-games.json"
```

Expected:

```text
True
```

- [ ] **Step 5: Commit**

```powershell
git add src/core src/index.mjs tests
git commit -m "feat: 新增截图发现索引"
```

---

### Task 6: Add Pending Write Preview Flow

**Files:**
- Create: `src/core/pending-writes.mjs`
- Test: `tests/core/pending-writes.test.mjs`
- Modify: `src/index.mjs`
- Modify: `src-tauri/src/commands.rs`
- Create: `src-ui/Preview.tsx`

**Interfaces:**
- Produces `pending-writes.json`.
- Produces CLI flags `--plan-writes` and `--apply-pending`.
- GUI can read pending writes, confirm writing, or skip the current batch.

- [ ] **Step 1: Write pending write test**

`tests/core/pending-writes.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readPendingWrites, writePendingWrites } from '../../src/core/pending-writes.mjs';

test('pending writes persist target path and screenshot captions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-pending-'));
  const filePath = path.join(root, 'pending-writes.json');
  await writePendingWrites(filePath, {
    items: [
      {
        id: '3739717708',
        appid: '2358720',
        game: 'Black Myth: Wukong',
        targetFile: 'Steam体验记录/Black Myth_ Wukong.md',
        caption: '沙大郎？傻大郎！'
      }
    ]
  });

  const pending = await readPendingWrites(filePath);

  assert.equal(pending.items[0].game, 'Black Myth: Wukong');
  assert.equal(pending.items[0].caption, '沙大郎？傻大郎！');
});
```

- [ ] **Step 2: Implement pending write store**

`src/core/pending-writes.mjs`:

```js
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readPendingWrites(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return { items: [] };
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function writePendingWrites(filePath, pending) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(pending, null, 2));
}

export async function clearPendingWrites(filePath) {
  if (filePath && fsSync.existsSync(filePath)) {
    await fs.unlink(filePath);
  }
}
```

- [ ] **Step 3: Add plan/apply CLI**

Modify `src/index.mjs`:

- `--plan-writes` scans and stores candidate writes in `pending-writes.json`.
- `--apply-pending` reads `pending-writes.json`, writes Markdown, updates state, then deletes pending file.
- Existing direct sync path remains available for automatic mode.

- [ ] **Step 4: Add Tauri preview commands**

Commands:

- `read_pending_writes`
- `plan_writes`
- `apply_pending_writes`
- `clear_pending_writes`

Each command returns a clear `Result<String, String>` JSON payload.

- [ ] **Step 5: Build `Preview.tsx`**

Preview layout:

- left: screenshot thumbnail or image URL text if image is unavailable.
- right: game, date, caption, target file.
- footer: confirm write, skip batch.

- [ ] **Step 6: Verify**

Run:

```powershell
node src/index.mjs --plan-writes --pages 1 --request-delay-ms 10000
npm run tauri:dev
```

Expected:

- Preview screen shows pending items.
- Confirm writes Markdown.
- Skip clears pending file without modifying Markdown.

- [ ] **Step 7: Commit**

```powershell
git add src/core src/index.mjs src-tauri src-ui tests
git commit -m "feat: 新增写入预览流程"
```

---

### Task 7: Add Adaptive 429 Handling and Notifications

**Files:**
- Create: `src/core/rate-state.mjs`
- Test: `tests/core/rate-state.test.mjs`
- Modify: `src/index.mjs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-ui/App.tsx`

**Interfaces:**
- Produces `recordRateFailure(state, now): RateState`.
- Produces `resetRateFailures(state): RateState`.
- Tauri notification is used when 3 consecutive slowed failures pause the worker.

- [ ] **Step 1: Write rate-state test**

`tests/core/rate-state.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordRateFailure, resetRateFailures } from '../../src/core/rate-state.mjs';

test('recordRateFailure pauses after three consecutive failures', () => {
  let state = {};
  state = recordRateFailure(state, '2026-06-23T10:00:00.000Z');
  state = recordRateFailure(state, '2026-06-23T10:01:00.000Z');
  state = recordRateFailure(state, '2026-06-23T10:02:00.000Z');

  assert.equal(state.consecutiveRateFailures, 3);
  assert.equal(state.pausedByRateLimit, true);
});

test('resetRateFailures clears pause state', () => {
  const state = resetRateFailures({
    consecutiveRateFailures: 3,
    pausedByRateLimit: true,
  });

  assert.equal(state.consecutiveRateFailures, 0);
  assert.equal(state.pausedByRateLimit, false);
});
```

- [ ] **Step 2: Implement rate-state**

`src/core/rate-state.mjs`:

```js
export function recordRateFailure(state = {}, now = new Date().toISOString()) {
  const count = Number(state.consecutiveRateFailures || 0) + 1;
  return {
    ...state,
    consecutiveRateFailures: count,
    lastRateFailureAt: now,
    pausedByRateLimit: count >= 3,
  };
}

export function resetRateFailures(state = {}) {
  return {
    ...state,
    consecutiveRateFailures: 0,
    pausedByRateLimit: false,
  };
}
```

- [ ] **Step 3: Integrate in worker**

Modify `src/index.mjs`:

- On 429, increase effective delay for the next attempt.
- Persist `consecutiveRateFailures`.
- After 3 failures, create stop-worker and record `pausedByRateLimit`.
- On successful page/detail fetch, call `resetRateFailures`.

- [ ] **Step 4: Add notification from Tauri**

Frontend calls notification API when status reports `pausedByRateLimit`:

```ts
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export async function notifyPausedByRateLimit() {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === 'granted';
  }
  if (granted) {
    sendNotification({
      title: 'Steam Experience Sync 已暂停',
      body: '连续 3 次触发限流或风控，已暂停同步。',
    });
  }
}
```

- [ ] **Step 5: Verify**

Use a test-only env flag to simulate 429:

```powershell
$env:STEAM_TEST_FORCE_429='1'
node src/index.mjs --worker
node src/index.mjs --worker
node src/index.mjs --worker
```

Expected:

- State records 3 failures.
- stop-worker exists.
- GUI shows paused reason.
- Notification appears.

- [ ] **Step 6: Commit**

```powershell
git add src/core src/index.mjs src-ui tests
git commit -m "feat: 新增限流降速和暂停通知"
```

---

### Task 8: Polish UI Navigation and README

**Files:**
- Modify: `src-ui/App.tsx`
- Create: `src-ui/Dashboard.tsx`
- Create: `src-ui/Logs.tsx`
- Create: `src-ui/Queue.tsx`
- Modify: `src-ui/Settings.tsx`
- Modify: `src-ui/Preview.tsx`
- Modify: `src-ui/styles.css`
- Modify: `README.md`

**Interfaces:**
- Produces tabs: Dashboard, Queue, Preview, Logs, Settings.
- README explains Windows/macOS source run, Tauri dev, Tauri build, and Node.js requirement.

- [ ] **Step 1: Split UI into screens**

`src-ui/App.tsx` should only hold active tab state and shared refresh state.

Tabs:

```ts
type Tab = 'dashboard' | 'queue' | 'preview' | 'logs' | 'settings';
```

- [ ] **Step 2: Create Dashboard**

Dashboard must show:

- current status
- current game
- speed mode
- preview mode
- run/stop/refresh buttons

- [ ] **Step 3: Create Queue**

Queue must show discovered games:

- game name
- appid
- screenshot count
- last seen time

- [ ] **Step 4: Create Logs**

Logs must show:

- worker log
- current process output
- failed/error filter

- [ ] **Step 5: Update README**

Add sections:

```md
## Desktop App

First version requires Node.js to be installed separately.

### Windows

```powershell
npm install
npm run tauri:dev
```

### macOS

```bash
npm install
npm run tauri:dev
```

### Build

```bash
npm run tauri:build
```
```

Explain:

- `npm run gui` remains a fallback.
- desktop app does not autostart with the OS.
- API Key stays local and must not be committed.

- [ ] **Step 6: Verify**

Run:

```powershell
npm run ui:build
npm run tauri:build
git status --short
```

Expected:

- UI build passes.
- Tauri build produces Windows artifact.
- No `.env` or `.steam-experience-sync` files appear in Git status.

- [ ] **Step 7: Commit**

```powershell
git add README.md src-ui
git commit -m "docs: 更新桌面应用使用说明"
```

---

## Self-Review Checklist

- Spec coverage:
  - Tauri desktop shell: Tasks 1, 3, 8.
  - Existing Node worker reuse: Tasks 2, 3.
  - Editable config and hidden API Key: Task 4.
  - Discovery-based scan to reduce empty runs: Task 5.
  - Preview before write: Task 6.
  - 429 slowdown, 3-failure pause, notification: Task 7.
  - Cross-platform docs and build path: Task 8.
- Placeholder scan: no task contains unresolved placeholder wording.
- Security: no command prints API Key; config directory is ignored.
- Scope: first implementation still requires Node.js; sidecar/Node-free installer remains future work.
