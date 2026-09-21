// Windows 的正式包不带控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    iml_editor_lib::run()
}
