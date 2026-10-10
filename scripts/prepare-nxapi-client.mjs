import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyBundledClient } from '../src/switch/nxapi-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { await verifyBundledClient(root); }
catch {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  let npm;
  for (const candidate of candidates) { try { await fs.access(candidate); npm = candidate; break; } catch {} }
  if (!npm) throw new Error('请通过 npm run switch:prepare 准备应用自带的相册客户端。');
  const install = spawnSync(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path.join(root, 'tools/nxapi-client'), stdio: 'inherit', windowsHide: true });
  if (install.status !== 0) throw new Error('相册客户端依赖安装失败，停止打包。');
  await verifyBundledClient(root);
}
console.log('Pinned Switch album client ready; no login or account requests.');
