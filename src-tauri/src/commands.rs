use crate::runtime::RuntimePaths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufRead;
use std::io::BufReader;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::Emitter;

#[derive(Serialize)]
pub struct CommandResult {
    ok: bool,
    message: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuiConfig {
    steam_id: Option<String>,
    steam_api_key: Option<String>,
    vault_dir: Option<String>,
    experience_dir: Option<String>,
    state_path: Option<String>,
    worker_log_path: Option<String>,
    stop_worker_path: Option<String>,
    worker_mode: Option<String>,
    request_delay_ms: Option<u64>,
    page_delay_ms: Option<u64>,
    worker_loop_delay_ms: Option<u64>,
    worker_pages: Option<u64>,
    worker_max_screenshots: Option<u64>,
    worker_max_detail_scans: Option<u64>,
}

fn gui_config_env(file_path: &Path) -> Result<Vec<(&'static str, String)>, String> {
    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    let config: GuiConfig = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let mut envs = Vec::new();

    push_string_env(&mut envs, "STEAM_ID", config.steam_id);
    push_string_env(&mut envs, "STEAM_API_KEY", config.steam_api_key);
    push_string_env(&mut envs, "OBSIDIAN_VAULT_DIR", config.vault_dir);
    push_string_env(&mut envs, "STEAM_EXPERIENCE_DIR", config.experience_dir);
    push_string_env(&mut envs, "STEAM_SYNC_STATE", config.state_path);
    push_string_env(&mut envs, "STEAM_WORKER_LOG", config.worker_log_path);
    push_string_env(&mut envs, "STEAM_WORKER_STOP_FILE", config.stop_worker_path);
    push_string_env(&mut envs, "STEAM_WORKER_MODE", config.worker_mode);
    push_number_env_at_least(
        &mut envs,
        "STEAM_REQUEST_DELAY_MS",
        config.request_delay_ms,
        30_000,
    );
    push_number_env_at_least(
        &mut envs,
        "STEAM_PAGE_DELAY_MS",
        config.page_delay_ms,
        60_000,
    );
    push_number_env_at_least(
        &mut envs,
        "STEAM_WORKER_LOOP_DELAY_MS",
        config.worker_loop_delay_ms,
        60_000,
    );
    push_number_env(&mut envs, "STEAM_WORKER_PAGES", config.worker_pages);
    push_number_env(
        &mut envs,
        "STEAM_WORKER_BATCH_SIZE",
        config.worker_max_screenshots,
    );
    push_number_env(
        &mut envs,
        "STEAM_WORKER_MAX_DETAIL_SCANS",
        config.worker_max_detail_scans,
    );

    Ok(envs)
}

fn apply_gui_config_env(command: &mut Command, config_file: &Path) -> Result<(), String> {
    for (key, value) in gui_config_env(config_file)? {
        command.env(key, value);
    }
    Ok(())
}

fn push_string_env(
    envs: &mut Vec<(&'static str, String)>,
    key: &'static str,
    value: Option<String>,
) {
    if let Some(value) = value {
        if !value.trim().is_empty() {
            envs.push((key, value));
        }
    }
}

fn push_number_env(envs: &mut Vec<(&'static str, String)>, key: &'static str, value: Option<u64>) {
    if let Some(value) = value {
        envs.push((key, value.to_string()));
    }
}

fn push_number_env_at_least(
    envs: &mut Vec<(&'static str, String)>,
    key: &'static str,
    value: Option<u64>,
    minimum: u64,
) {
    if let Some(value) = value {
        envs.push((key, value.max(minimum).to_string()));
    }
}

fn configured_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let runtime = RuntimePaths::resolve(app)?;
    let mut command = runtime.command();
    apply_gui_config_env(&mut command, &runtime.config_file)?;
    Ok(command)
}

fn run_node(app: &tauri::AppHandle, args: &[&str]) -> Result<String, String> {
    let mut command = configured_command(app)?;
    command.args(args);

    let output = command.output().map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Err(if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        })
    }
}

#[cfg(test)]
mod tests {
    use super::gui_config_env;
    use crate::runtime::find_project_root_from;
    use std::fs;

    fn env_value(envs: &[(&'static str, String)], name: &str) -> String {
        envs.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.clone())
            .unwrap()
    }

    #[test]
    fn finds_project_root_from_tauri_release_directory() {
        let root = std::env::temp_dir().join(format!(
            "steam-experience-sync-root-test-{}",
            std::process::id()
        ));
        let release = root.join("src-tauri").join("target").join("release");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(&release).unwrap();
        fs::write(root.join("src").join("index.mjs"), "").unwrap();

        let found = find_project_root_from(&release).unwrap();

        assert_eq!(found, root);
    }

    #[test]
    fn maps_gui_config_to_worker_environment() {
        let root = std::env::temp_dir().join(format!(
            "steam-experience-sync-config-test-{}",
            std::process::id()
        ));
        let config_dir = root.join(".steam-experience-sync");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("config.json"),
            r#"{
              "steamId": "76561198119055866",
              "steamApiKey": "test-key",
              "vaultDir": "D:\\YQM-Obsidian",
              "experienceDir": "00_input/Steam",
              "statePath": ".obsidian/steam-experience-sync/state.json",
              "workerLogPath": ".obsidian/steam-experience-sync/worker.log",
              "stopWorkerPath": ".obsidian/steam-experience-sync/stop-worker",
              "workerMode": "feed",
              "requestDelayMs": 30000,
              "pageDelayMs": 60000,
              "workerLoopDelayMs": 60000,
              "workerPages": 1,
              "workerMaxScreenshots": 1,
              "workerMaxDetailScans": 3
            }"#,
        )
        .unwrap();

        let envs = gui_config_env(&config_dir.join("config.json")).unwrap();

        assert_eq!(env_value(&envs, "STEAM_ID"), "76561198119055866");
        assert_eq!(env_value(&envs, "STEAM_API_KEY"), "test-key");
        assert_eq!(env_value(&envs, "OBSIDIAN_VAULT_DIR"), "D:\\YQM-Obsidian");
        assert_eq!(env_value(&envs, "STEAM_REQUEST_DELAY_MS"), "30000");
        assert_eq!(env_value(&envs, "STEAM_PAGE_DELAY_MS"), "60000");
        assert_eq!(env_value(&envs, "STEAM_WORKER_LOOP_DELAY_MS"), "60000");
        assert_eq!(env_value(&envs, "STEAM_WORKER_MODE"), "feed");
        assert_eq!(env_value(&envs, "STEAM_WORKER_PAGES"), "1");
        assert_eq!(env_value(&envs, "STEAM_WORKER_BATCH_SIZE"), "1");
        assert_eq!(env_value(&envs, "STEAM_WORKER_MAX_DETAIL_SCANS"), "3");
    }

    #[test]
    fn maps_old_fast_gui_intervals_to_safe_environment() {
        let root = std::env::temp_dir().join(format!(
            "steam-experience-sync-config-fast-test-{}",
            std::process::id()
        ));
        let config_dir = root.join(".steam-experience-sync");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("config.json"),
            r#"{
              "requestDelayMs": 10000,
              "pageDelayMs": 15000,
              "workerLoopDelayMs": 10000
            }"#,
        )
        .unwrap();

        let envs = gui_config_env(&config_dir.join("config.json")).unwrap();

        assert_eq!(env_value(&envs, "STEAM_REQUEST_DELAY_MS"), "30000");
        assert_eq!(env_value(&envs, "STEAM_PAGE_DELAY_MS"), "60000");
        assert_eq!(env_value(&envs, "STEAM_WORKER_LOOP_DELAY_MS"), "60000");
    }
}

#[tauri::command]
pub fn get_status(app: tauri::AppHandle) -> Result<String, String> {
    run_node(&app, &["src/index.mjs", "--worker-status-json"])
}

#[tauri::command]
pub fn get_logs(app: tauri::AppHandle) -> Result<String, String> {
    run_node(&app, &["src/index.mjs", "--worker-log-tail"])
}

#[tauri::command]
pub fn start_worker_loop(app: tauri::AppHandle) -> Result<CommandResult, String> {
    let mut clear_command = configured_command(&app)?;
    clear_command
        .arg("src/index.mjs")
        .arg("--clear-worker-stop");
    let clear_output = clear_command.output().map_err(|error| error.to_string())?;
    if !clear_output.status.success() {
        return Err(String::from_utf8_lossy(&clear_output.stderr).to_string());
    }

    let mut worker_command = configured_command(&app)?;
    worker_command
        .arg("src/index.mjs")
        .arg("--worker-loop")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = worker_command.spawn().map_err(|error| error.to_string())?;

    // Stream stdout lines as Tauri events
    if let Some(stdout) = child.stdout.take() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let _ = app_handle.emit("worker-output", text);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Stream stderr lines as Tauri events
    if let Some(stderr) = child.stderr.take() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let _ = app_handle.emit("worker-output", text);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Spawn a thread to wait for the process and emit exit event
    std::thread::spawn(move || {
        let status = child.wait();
        let exit_code = status.as_ref().ok().and_then(|s| s.code());
        let exit_ok = status.map(|s| s.success()).unwrap_or(false);
        let _ = app.emit(
            "worker-exit",
            serde_json::json!({
                "code": exit_code,
                "ok": exit_ok,
            })
            .to_string(),
        );
    });

    Ok(CommandResult {
        ok: true,
        message: "sync started; stop file cleared".to_string(),
    })
}

#[tauri::command]
pub fn stop_worker(app: tauri::AppHandle) -> Result<CommandResult, String> {
    let message = run_node(&app, &["src/index.mjs", "--stop-worker"])?;
    Ok(CommandResult { ok: true, message })
}

#[tauri::command]
pub fn read_discovery_index(app: tauri::AppHandle) -> Result<String, String> {
    run_node(&app, &["src/index.mjs", "--read-discovery"])
}

#[tauri::command]
pub fn read_config(app: tauri::AppHandle) -> Result<String, String> {
    run_node(&app, &[
        "-e",
        "import('./src/core/config-store.mjs').then(async m => console.log(JSON.stringify(await m.readGuiConfig(process.cwd())))).catch(error => { console.error(error.message); process.exit(1); })",
    ])
}

#[tauri::command]
pub fn write_config(app: tauri::AppHandle, payload: String) -> Result<CommandResult, String> {
    let runtime = RuntimePaths::resolve(&app)?;
    let script = "let raw=''; process.stdin.on('data', chunk => raw += chunk); process.stdin.on('end', () => import('./src/core/config-store.mjs').then(async m => { const result = await m.writeGuiConfig(process.cwd(), JSON.parse(raw || '{}')); console.log(JSON.stringify(result)); }).catch(error => { console.error(error.message); process.exit(1); }));";
    let mut child = runtime
        .command()
        .arg("-e")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let output = child
        .wait_with_output()
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

#[tauri::command]
pub async fn switch_action(
    app: tauri::AppHandle,
    action: String,
    payload: Option<String>,
) -> Result<String, String> {
    if !matches!(
        action.as_str(),
        "status"
            | "logs"
            | "sync"
            | "stop"
            | "preview"
            | "save-settings"
            | "save-game"
            | "install-style"
            | "account-status"
            | "login-start"
            | "login-finish"
            | "disconnect"
            | "check-service"
    ) {
        return Err("Unsupported Switch operation".into());
    }
    let payload = payload.unwrap_or_else(|| "{}".into());
    if payload.len() > 1024 * 1024 {
        return Err("Switch settings payload is too large".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = RuntimePaths::resolve(&app)?;
        let account_source = fs::read_to_string(&runtime.config_file)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .is_some_and(|value| value["switch"]["source"] == "account");
        let uses_credentials = matches!(action.as_str(), "account-status" | "login-start" | "login-finish" | "disconnect" | "check-service")
            || (account_source && matches!(action.as_str(), "sync" | "preview"));
        // Account transactions share mutable credentials; stop/status remain responsive.
        static ACCOUNT_OPERATION: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = if uses_credentials {
            Some(ACCOUNT_OPERATION.lock().map_err(|_| "账号操作暂不可用，请重启应用。")?)
        } else { None };
        let credentials = if uses_credentials {
            crate::switch_credentials::load(&runtime.config_file)?
        } else { serde_json::json!({}) };
        let input = serde_json::json!({
            "payload": serde_json::from_str::<serde_json::Value>(&payload).map_err(|_| "Switch 设置格式无效。")?,
            "credentials": credentials,
        });
        let mut child = runtime
            .command()
            .args(["src/switch/index.mjs", &action, "--native-bridge"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.to_string().as_bytes())
                .map_err(|error| error.to_string())?;
        }
        let output = child
            .wait_with_output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            let envelope: serde_json::Value = serde_json::from_slice(&output.stdout)
                .map_err(|_| "Switch 同步未返回有效结果。")?;
            if uses_credentials && action != "account-status" {
                let next = envelope.get("credentials").filter(|value| value.is_object())
                    .ok_or("Switch 登录信息返回格式无效，未覆盖钥匙串。")?;
                crate::switch_credentials::save(&runtime.config_file, next)?;
            }
            if let Some(error) = envelope["error"].as_str() { return Err(error.to_owned()); }
            let result = &envelope["result"];
            if action == "login-start" {
                let url = result["url"].as_str().ok_or("Nintendo 登录链接缺失。")?;
                if !url.starts_with("https://accounts.nintendo.com/connect/1.0.0/authorize?") {
                    return Err("Nintendo 登录地址无效。".into());
                }
                #[cfg(target_os = "macos")]
                if !Command::new("/usr/bin/open").arg(url).status().map_err(|_| "无法打开浏览器。")?.success() {
                    return Err("无法打开 Nintendo 登录网页。".into());
                }
            }
            Ok(result.to_string())
        } else {
            // A crashed auth process may include credentials in diagnostics.
            Err("Switch 同步进程未能完成，请检查配置并重试。".into())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
