// Prevents an extra console window on Windows in release builds.
// DO NOT REMOVE: without this attribute, double-clicking the release exe opens a terminal.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    steam_experience_sync_lib::run()
}
