mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::get_logs,
            commands::read_discovery_index,
            commands::read_config,
            commands::start_worker_loop,
            commands::stop_worker,
            commands::write_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
