import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function prepareMacRuntime({
  root = projectRoot,
  platform = process.platform,
  arch = process.arch,
  executable = process.execPath,
  licenseText,
} = {}) {
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error('The Mac installer must be built on an Apple Silicon Mac with arm64 Node.js.');
  }
  const header = await fs.open(executable, 'r');
  const bytes = Buffer.alloc(8);
  try {
    await header.read(bytes, 0, 8, 0);
  } finally {
    await header.close();
  }
  if (bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c) {
    throw new Error('Node runtime is not an arm64 Mach-O executable.');
  }
  if (!licenseText) {
    const response = await fetch(
      `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error(`Cannot download Node license: HTTP ${response.status}`);
    licenseText = await response.text();
  }
  if (!licenseText.includes('Permission is hereby granted')) {
    throw new Error('Node license is missing or invalid; refusing to distribute the runtime.');
  }
  const runtimeDir = path.join(root, 'src-tauri', 'runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  const destination = path.join(runtimeDir, 'steam-node-aarch64-apple-darwin');
  await fs.copyFile(executable, destination);
  await fs.chmod(destination, 0o755);
  await fs.writeFile(path.join(runtimeDir, 'NODE-LICENSE'), licenseText);
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareMacRuntime().then(() => {
    console.log('Apple Silicon Node runtime prepared (no user configuration included).');
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
