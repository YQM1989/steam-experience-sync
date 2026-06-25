use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Serialize)]
pub struct CommandResult {
    ok: bool,
    message: String,
}

fn project_root() -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("STEAM_EXPERIENCE_SYNC_ROOT") {
        let path = PathBuf::from(value);
        if path.join("src").join("index.mjs").exists() {
            return Ok(path);
        }
    }

    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
    if cwd.join("src").join("index.mjs").exists() {
        return Ok(cwd);
    }

    if let Some(parent) = cwd.parent() {
        if parent.join("src").join("index.mjs").exists() {
            return Ok(parent.to_path_buf());
        }
    }

    Err("Cannot locate project root containing src/index.mjs.".to_string())
}

fn run_node(args: &[&str]) -> Result<String, String> {
    let root = project_root()?;
    let output = Command::new("node")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Err(if stderr.trim().is_empty() { stdout } else { stderr })
    }
}

#[tauri::command]
pub fn get_status() -> Result<String, String> {
    run_node(&["src/index.mjs", "--worker-status"])
}

#[tauri::command]
pub fn get_logs() -> Result<String, String> {
    run_node(&["src/index.mjs", "--worker-status"])
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
    let message = run_node(&["src/index.mjs", "--stop-worker"])?;
    Ok(CommandResult { ok: true, message })
}

#[tauri::command]
pub fn read_pending_writes() -> Result<String, String> {
    run_node(&["src/index.mjs", "--read-pending"])
}

#[tauri::command]
pub fn plan_writes() -> Result<CommandResult, String> {
    let message = run_node(&["src/index.mjs", "--plan-writes"])?;
    Ok(CommandResult { ok: true, message })
}

#[tauri::command]
pub fn apply_pending_writes() -> Result<CommandResult, String> {
    let message = run_node(&["src/index.mjs", "--apply-pending"])?;
    Ok(CommandResult { ok: true, message })
}

#[tauri::command]
pub fn clear_pending_writes() -> Result<CommandResult, String> {
    let message = run_node(&["src/index.mjs", "--clear-pending"])?;
    Ok(CommandResult { ok: true, message })
}

#[tauri::command]
pub fn read_config() -> Result<String, String> {
    run_node(&[
        "-e",
        "import('./src/core/config-store.mjs').then(async m => console.log(JSON.stringify(await m.readGuiConfig(process.cwd())))).catch(error => { console.error(error.message); process.exit(1); })",
    ])
}

#[tauri::command]
pub fn write_config(payload: String) -> Result<CommandResult, String> {
    let root = project_root()?;
    let script = "let raw=''; process.stdin.on('data', chunk => raw += chunk); process.stdin.on('end', () => import('./src/core/config-store.mjs').then(async m => { const result = await m.writeGuiConfig(process.cwd(), JSON.parse(raw || '{}')); console.log(JSON.stringify(result)); }).catch(error => { console.error(error.message); process.exit(1); }));";
    let mut child = Command::new("node")
        .arg("-e")
        .arg(script)
        .current_dir(root)
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

    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(CommandResult {
            ok: true,
            message: String::from_utf8_lossy(&output.stdout).to_string(),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
