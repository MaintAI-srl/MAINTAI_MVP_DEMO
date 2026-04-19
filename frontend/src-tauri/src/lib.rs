/// Restituisce la URL base del backend API.
/// Priorità: var d'ambiente MAINTAI_API_BASE → default cloud Render.
#[tauri::command]
fn get_api_base() -> String {
    std::env::var("MAINTAI_API_BASE")
        .unwrap_or_else(|_| "https://maintai-v3.onrender.com".to_string())
}

/// Restituisce la modalità operativa corrente: "cloud" | "local"
#[tauri::command]
fn get_app_mode() -> String {
    std::env::var("MAINTAI_MODE").unwrap_or_else(|_| "cloud".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_api_base, get_app_mode])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Errore durante l'avvio di MaintAI Desktop");
}
