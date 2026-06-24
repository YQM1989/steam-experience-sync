use serde::Serialize;
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
