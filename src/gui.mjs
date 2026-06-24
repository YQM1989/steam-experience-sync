#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadDotEnvFile } from './core/dotenv.mjs';
import { readWorkerLog } from './core/logs.mjs';
import { resolveRuntimePaths } from './core/paths.mjs';
import { readRuntimeStatus } from './core/status.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const indexFile = path.join(__dirname, 'index.mjs');
const host = process.env.STEAM_GUI_HOST || '127.0.0.1';
const port = Number(process.env.STEAM_GUI_PORT || 8765);
const outputLines = [];
let activeProcess = null;

const env = await loadDotEnvFile(path.join(projectRoot, '.env'));
const runtimePaths = resolveRuntimePaths(projectRoot, env);
const { vaultDir, stateFile, stopFile } = runtimePaths;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/') {
      sendHtml(response, renderPage());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/status') {
      sendJson(response, await readStatus());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/logs') {
      sendJson(response, await readLogs());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/start') {
      const body = await readJsonBody(request);
      sendJson(response, await startWorker(body.mode === 'loop' ? 'loop' : 'once'));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/stop') {
      sendJson(response, await runControlCommand('--stop-worker'));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/resume') {
      sendJson(response, await runControlCommand('--clear-worker-stop'));
      return;
    }
    sendJson(response, { ok: false, error: 'Not found' }, 404);
  } catch (error) {
    sendJson(response, { ok: false, error: error.message }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Steam Experience Sync GUI: http://${host}:${port}`);
  console.log('Press Ctrl+C to stop the GUI server.');
});

async function startWorker(mode) {
  if (activeProcess) {
    return { ok: false, error: `Worker is already running as PID ${activeProcess.pid}.` };
  }

  if (stopFile && fsSync.existsSync(stopFile)) {
    await runControlCommand('--clear-worker-stop');
  }

  const args = [indexFile, mode === 'loop' ? '--worker-loop' : '--worker'];
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeProcess = { pid: child.pid, mode, startedAt: new Date().toISOString(), child };
  pushOutput(`Started ${mode} worker, PID ${child.pid}.`);

  child.stdout.on('data', (chunk) => pushOutput(chunk.toString()));
  child.stderr.on('data', (chunk) => pushOutput(chunk.toString()));
  child.on('exit', (code, signal) => {
    pushOutput(`Worker exited with code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}.`);
    activeProcess = null;
  });

  return { ok: true, pid: child.pid, mode };
}

async function runControlCommand(flag) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [indexFile, flag], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('exit', (code) => {
      pushOutput(output.trim() || `${flag} exited with code ${code}.`);
      resolve({ ok: code === 0, code, output: output.trim() });
    });
  });
}

async function readStatus() {
  const state = await readJsonFile(stateFile);
  const runtimeStatus = await readRuntimeStatus(runtimePaths);
  const worker = normalizeWorkerState(state?.worker);
  const queue = parseList(env.STEAM_WORKER_APPIDS || env.STEAM_SYNC_APPIDS || env.STEAM_APPIDS || '');
  const nextAppid = queue.length > 0 ? queue[worker.nextAppidIndex % queue.length] : '';
  const cooldownActive = worker.cooldownUntil ? Date.parse(worker.cooldownUntil) > Date.now() : false;
  return {
    ok: true,
    process: activeProcess ? {
      pid: activeProcess.pid,
      mode: activeProcess.mode,
      startedAt: activeProcess.startedAt,
      startedAtBeijing: formatBeijingDateTime(activeProcess.startedAt),
    } : null,
    queue,
    nextAppid,
    stopFilePresent: runtimeStatus.stopRequested,
    cooldownActive,
    cooldownUntil: cooldownActive ? worker.cooldownUntil : null,
    cooldownUntilBeijing: cooldownActive ? formatBeijingDateTime(worker.cooldownUntil) : null,
    lastRunAt: worker.lastRunAt || null,
    lastRunAtBeijing: worker.lastRunAt ? formatBeijingDateTime(worker.lastRunAt) : null,
    lastError: worker.lastError || null,
    appids: queue.map((appid) => ({
      appid,
      nextPage: worker.appids[String(appid)]?.nextPage || 1,
      imported: worker.appids[String(appid)]?.imported || 0,
      lastMatched: worker.appids[String(appid)]?.lastMatchedCount ?? null,
      lastProcessed: worker.appids[String(appid)]?.lastProcessedCount ?? null,
    })),
    config: {
      workerBatchSize: env.STEAM_WORKER_BATCH_SIZE || '5',
      workerPages: env.STEAM_WORKER_PAGES || '3',
      requestDelayMs: env.STEAM_REQUEST_DELAY_MS || '',
      pageDelayMs: env.STEAM_PAGE_DELAY_MS || '',
      loopDelayMs: env.STEAM_WORKER_LOOP_DELAY_MS || '10000',
      timezone: '北京时间',
      vaultDir,
    },
  };
}

async function readLogs() {
  const fileLog = (await readWorkerLog(runtimePaths, 120)).map(formatWorkerLogLine);
  return {
    ok: true,
    runtime: outputLines.slice(-160),
    file: fileLog,
  };
}

function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Steam Experience Sync</title>
  <style>
    :root { color-scheme: dark; --bg:#151515; --panel:#202020; --line:#333; --text:#e8e8e8; --muted:#aaa; --accent:#8fb7ff; --danger:#ff7b7b; --ok:#82d39f; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:20px; }
    h1 { margin:0; font-size:28px; letter-spacing:0; }
    .sub { color:var(--muted); margin-top:6px; }
    .grid { display:grid; grid-template-columns: 360px 1fr; gap:18px; align-items:start; }
    section { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:18px; }
    h2 { font-size:16px; margin:0 0 14px; }
    .buttons { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    button { border:1px solid var(--line); background:#2b2b2b; color:var(--text); padding:10px 12px; border-radius:6px; font-size:14px; cursor:pointer; }
    button:hover { border-color:#555; background:#333; }
    button.primary { background:#254a7a; border-color:#386aa8; }
    button.danger { background:#4a2525; border-color:#7e3a3a; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    .kv { display:grid; grid-template-columns:128px 1fr; gap:8px 12px; font-size:14px; }
    .k { color:var(--muted); }
    .badge { display:inline-flex; align-items:center; min-height:24px; border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-size:13px; }
    .badge.ok { color:var(--ok); }
    .badge.warn { color:#ffd27a; }
    .badge.danger { color:var(--danger); }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { border-bottom:1px solid var(--line); padding:9px 8px; text-align:left; }
    th { color:var(--muted); font-weight:500; }
    .logs { height:360px; overflow:auto; background:#101010; border:1px solid var(--line); border-radius:6px; padding:12px; font:13px Consolas, monospace; white-space:pre-wrap; }
    .split { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:18px; }
    @media (max-width: 860px) { main { padding:16px; } .grid, .split { grid-template-columns:1fr; } header { display:block; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Steam Experience Sync</h1>
      <div class="sub">本地控制面板，只访问公开 Steam 页面，不保存 Cookie。</div>
    </div>
    <button id="refresh">刷新状态</button>
  </header>
  <div class="grid">
    <section>
      <h2>运行控制</h2>
      <div class="buttons">
        <button class="primary" id="runOnce">运行一轮</button>
        <button class="primary" id="runLoop">连续运行</button>
        <button class="danger" id="stop">停止</button>
        <button id="resume">恢复</button>
      </div>
      <div style="height:18px"></div>
      <div class="kv" id="statusKv"></div>
    </section>
    <section>
      <h2>队列进度</h2>
      <table>
        <thead><tr><th>AppID</th><th>下一页</th><th>已写入</th><th>上次匹配</th><th>上次写入</th></tr></thead>
        <tbody id="appidRows"></tbody>
      </table>
    </section>
  </div>
  <div class="split">
    <section>
      <h2>实时输出</h2>
      <div class="logs" id="runtimeLog"></div>
    </section>
    <section>
      <h2>Worker 日志</h2>
      <div class="logs" id="fileLog"></div>
    </section>
  </div>
</main>
<script>
const el = (id) => document.getElementById(id);
async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  return res.json();
}
async function post(path, body = {}) {
  const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
  await refresh();
  return result;
}
function badge(text, kind) { return '<span class="badge ' + kind + '">' + text + '</span>'; }
async function refresh() {
  const status = await api('/api/status');
  const logs = await api('/api/logs');
  const running = Boolean(status.process);
  el('runOnce').disabled = running;
  el('runLoop').disabled = running;
  const stateBadge = running ? badge('运行中 PID ' + status.process.pid, 'ok') : badge('空闲', 'warn');
  const stopBadge = status.stopFilePresent ? badge('已暂停', 'danger') : badge('可运行', 'ok');
  const cooldown = status.cooldownActive ? status.cooldownUntilBeijing : '无';
  el('statusKv').innerHTML = [
    ['运行状态', stateBadge],
    ['停止开关', stopBadge],
    ['下一 AppID', status.nextAppid || '未配置'],
    ['时区', status.config.timezone],
    ['冷却', cooldown],
    ['上次运行', status.lastRunAtBeijing || '无'],
    ['每轮截图', status.config.workerBatchSize],
    ['每轮页数', status.config.workerPages],
    ['轮间隔', status.config.loopDelayMs + ' ms']
  ].map(([k,v]) => '<div class="k">' + k + '</div><div>' + v + '</div>').join('');
  el('appidRows').innerHTML = status.appids.map((row) =>
    '<tr><td>' + row.appid + '</td><td>' + row.nextPage + '</td><td>' + row.imported + '</td><td>' + (row.lastMatched ?? '-') + '</td><td>' + (row.lastProcessed ?? '-') + '</td></tr>'
  ).join('');
  el('runtimeLog').textContent = logs.runtime.join('\\n') || '暂无实时输出';
  el('fileLog').textContent = logs.file.join('\\n') || '暂无 worker.log';
}
el('runOnce').onclick = () => post('/api/start', { mode: 'once' });
el('runLoop').onclick = () => post('/api/start', { mode: 'loop' });
el('stop').onclick = () => post('/api/stop');
el('resume').onclick = () => post('/api/resume');
el('refresh').onclick = refresh;
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
}

async function readJsonBody(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendHtml(response, html) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJsonFile(file) {
  if (!file || !fsSync.existsSync(file)) return null;
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function pushOutput(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim()) outputLines.push(`[${formatBeijingTime(new Date())}] ${line}`);
  }
  while (outputLines.length > 300) outputLines.shift();
}

function formatWorkerLogLine(line) {
  try {
    const entry = JSON.parse(line);
    const at = formatBeijingDateTime(entry.at);
    const details = Object.entries(entry)
      .filter(([key]) => key !== 'at')
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    return `[${at}] ${details}`;
  } catch {
    return line;
  }
}

function formatBeijingTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('hour')}:${pick('minute')}:${pick('second')} 北京时间`;
}

function formatBeijingDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')} 北京时间`;
}

function normalizeWorkerState(value) {
  return {
    nextAppidIndex: Number.isInteger(value?.nextAppidIndex) ? value.nextAppidIndex : 0,
    cooldownUntil: value?.cooldownUntil || null,
    lastRunAt: value?.lastRunAt || null,
    lastError: value?.lastError || null,
    appids: value?.appids && typeof value.appids === 'object' ? value.appids : {},
  };
}

function parseList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}
