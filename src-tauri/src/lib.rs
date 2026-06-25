mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::apply_pending_writes,
            commands::clear_pending_writes,
            commands::get_status,
            commands::get_logs,
            commands::plan_writes,
            commands::read_discovery_index,
            commands::read_pending_writes,
            commands::read_config,
            commands::start_worker_loop,
            commands::stop_worker,
            commands::write_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
