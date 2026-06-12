use tauri_plugin_updater::UpdaterExt;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_api_base, get_app_mode])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // Controlla aggiornamenti all'avvio in background (solo release)
            #[cfg(not(debug_assertions))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(updater) = handle.updater() {
                        match updater.check().await {
                            Ok(Some(update)) => {
                                let _ = update.download_and_install(|_, _| {}, || {}).await;
                            }
                            Ok(None) => {}
                            Err(e) => {
                                eprintln!("Errore controllo aggiornamenti: {e}");
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Errore durante l'avvio di MaintAI Desktop");
}
