use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(all(target_os = "macos", not(debug_assertions)))]
use tauri::Manager;

pub struct RuntimePaths {
    pub root: PathBuf,
    pub config_file: PathBuf,
    node: PathBuf,
}

impl RuntimePaths {
    pub fn resolve(_app: &tauri::AppHandle) -> Result<Self, String> {
        // Installed Mac apps must never depend on a checkout or Finder's PATH.
        #[cfg(all(target_os = "macos", not(debug_assertions)))]
        {
            let resources = _app.path().resource_dir().map_err(|e| e.to_string())?;
            let config = _app.path().app_config_dir().map_err(|e| e.to_string())?;
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let binaries = exe.parent().ok_or("Cannot locate app binaries.")?;
            Self::packaged(&resources, binaries, &config)
        }

        #[cfg(any(not(target_os = "macos"), debug_assertions))]
        {
            let root = project_root()?;
            let node = development_node(&root);
            Ok(Self {
                config_file: root.join(".steam-experience-sync/config.json"),
                root,
                node,
            })
        }
    }

    #[cfg(any(target_os = "macos", test))]
    fn packaged(resources: &Path, binaries: &Path, config: &Path) -> Result<Self, String> {
        let root = resources.join("worker");
        let node = binaries.join("steam-node");
        if !is_project_root(&root) || !root.join("package.json").is_file() {
            return Err("The app is missing its bundled sync scripts. Reinstall the app.".into());
        }
        if !node.is_file() {
            return Err("The app is missing its bundled Node runtime. Reinstall the app.".into());
        }
        Ok(Self {
            root,
            config_file: config.join("config.json"),
            node,
        })
    }

    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.node);
        command
            .current_dir(&self.root)
            .env("STEAM_GUI_CONFIG_FILE", &self.config_file);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        command
    }
}

#[cfg(any(not(target_os = "macos"), debug_assertions))]
fn development_node(_root: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let bundled = _root.join("src-tauri/runtime/steam-node-aarch64-apple-darwin");
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from("node")
}

#[cfg(any(not(target_os = "macos"), debug_assertions))]
fn project_root() -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("STEAM_EXPERIENCE_SYNC_ROOT") {
        let path = PathBuf::from(value);
        if is_project_root(&path) {
            return Ok(path);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(root) = find_project_root_from(&cwd) {
            return Ok(root);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.parent().and_then(find_project_root_from) {
            return Ok(root);
        }
    }
    Err("Cannot locate project root containing src/index.mjs.".into())
}

#[cfg(any(not(target_os = "macos"), debug_assertions, test))]
pub(crate) fn find_project_root_from(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|path| is_project_root(path))
        .map(Path::to_path_buf)
}

fn is_project_root(path: &Path) -> bool {
    path.join("src/index.mjs").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn packaged_runtime_separates_readonly_code_and_writable_config() {
        let root = std::env::temp_dir().join(format!("steam-packaged-test-{}", std::process::id()));
        let resources = root.join("Example.app/Contents/Resources");
        let binaries = root.join("Example.app/Contents/MacOS");
        let config = root.join("Library/Application Support/com.yqm.steam-experience-sync");
        fs::create_dir_all(resources.join("worker/src")).unwrap();
        fs::create_dir_all(&binaries).unwrap();
        fs::write(resources.join("worker/src/index.mjs"), "").unwrap();
        fs::write(
            resources.join("worker/package.json"),
            r#"{"type":"module"}"#,
        )
        .unwrap();
        fs::write(binaries.join("steam-node"), "").unwrap();

        let runtime = RuntimePaths::packaged(&resources, &binaries, &config).unwrap();
        assert_eq!(runtime.root, resources.join("worker"));
        assert_eq!(runtime.config_file, config.join("config.json"));
        let command = runtime.command();
        assert_eq!(
            Path::new(command.get_program()),
            binaries.join("steam-node")
        );
        assert_eq!(command.get_current_dir(), Some(runtime.root.as_path()));
        assert!(command
            .get_envs()
            .any(|(key, value)| key == "STEAM_GUI_CONFIG_FILE"
                && value == Some(runtime.config_file.as_os_str())));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_packaged_runtime_does_not_fall_back_to_system_node() {
        let root =
            std::env::temp_dir().join(format!("steam-missing-bundle-{}", std::process::id()));
        fs::create_dir_all(root.join("worker/src")).unwrap();
        fs::write(root.join("worker/src/index.mjs"), "").unwrap();
        fs::write(root.join("worker/package.json"), "{}").unwrap();
        assert!(RuntimePaths::packaged(&root, &root, &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
