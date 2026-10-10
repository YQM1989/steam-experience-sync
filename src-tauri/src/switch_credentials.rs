use serde_json::Value;
use std::path::Path;

const SERVICE: &str = "org.yqm.steam-experience-sync.switch";

#[cfg(target_os = "macos")]
pub fn load(config: &Path) -> Result<Value, String> {
    use security_framework::passwords::get_generic_password;
    match get_generic_password(SERVICE, &config.to_string_lossy()) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Switch 钥匙串记录无法读取，未覆盖现有登录信息。".into()),
        Err(error) if error.code() == -25300 => Ok(serde_json::json!({})),
        Err(_) => Err("无法访问 Switch 钥匙串，请检查 macOS 的访问提示。".into()),
    }
}

#[cfg(target_os = "macos")]
pub fn save(config: &Path, credentials: &Value) -> Result<(), String> {
    use security_framework::passwords::{delete_generic_password, set_generic_password};
    if credentials
        .as_object()
        .is_some_and(|value| value.is_empty())
    {
        return match delete_generic_password(SERVICE, &config.to_string_lossy()) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(_) => Err("无法删除 Switch 钥匙串登录信息。".into()),
        };
    }
    let bytes = serde_json::to_vec(credentials).map_err(|_| "登录信息无法编码。")?;
    set_generic_password(SERVICE, &config.to_string_lossy(), &bytes)
        .map_err(|_| "无法保存到 macOS 钥匙串，账号连接尚未完成。".into())
}

#[cfg(not(target_os = "macos"))]
pub fn load(_: &Path) -> Result<Value, String> {
    Err("这个试用版的账号连接暂支持 macOS；其他系统可使用本地导入。".into())
}

#[cfg(not(target_os = "macos"))]
pub fn save(_: &Path, _: &Value) -> Result<(), String> {
    Err("这个试用版的账号连接暂支持 macOS。".into())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "uses an isolated fixture in the current macOS Keychain"]
    fn isolated_keychain_roundtrip() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "switch-keychain-qa-{}-{stamp}.json",
            std::process::id()
        ));
        assert_eq!(load(&fixture).unwrap(), serde_json::json!({}));
        let value = serde_json::json!({"sessionToken": "synthetic-fixture-only"});
        save(&fixture, &value).unwrap();
        let loaded = load(&fixture);
        save(&fixture, &serde_json::json!({})).unwrap();
        assert!(loaded.unwrap() == value);
        assert_eq!(load(&fixture).unwrap(), serde_json::json!({}));
    }
}
