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
