use std::fs;
use std::path::{Component, PathBuf};
use tauri::Manager;

/// The fs_* commands only ever operate on files the frontend derives from
/// app_data_dir (profiles.json, per-profile DBs, backups). Resolve the
/// requested path against that base and reject anything outside it, so a
/// compromised webview can't read or delete arbitrary user files.
fn scoped_path(app: &tauri::AppHandle, requested: &str) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let p = PathBuf::from(requested);
    let escapes = p
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir));
    if escapes || !p.starts_with(&base) {
        return Err(format!("path outside app data dir: {requested}"));
    }
    Ok(p)
}

#[tauri::command]
fn fs_read_text(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let p = scoped_path(&app, &path)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_write_text(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let p = scoped_path(&app, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_remove(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = scoped_path(&app, &path)?;
    if !p.exists() {
        return Ok(());
    }
    fs::remove_file(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_list_dir(app: tauri::AppHandle, dir: String) -> Result<Vec<String>, String> {
    let p = scoped_path(&app, &dir)?;
    if !p.exists() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(&p).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            fs_read_text,
            fs_write_text,
            fs_remove,
            fs_list_dir,
            app_data_dir,
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
