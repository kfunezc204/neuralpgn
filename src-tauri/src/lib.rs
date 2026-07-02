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

#[derive(serde::Deserialize)]
pub struct AtomicStatement {
    sql: String,
    params: Vec<serde_json::Value>,
}

/// Run a batch of statements inside ONE SQLite transaction. plugin-sql's
/// execute() goes through a connection pool, so BEGIN/COMMIT issued as
/// separate calls can land on different connections — this command opens its
/// own single connection to the same DB file (resolved exactly like the
/// plugin resolves `sqlite:<name>`: relative to app_config_dir) and commits
/// all-or-nothing. Used by the backup restore path, where a partial write
/// would leave a half-empty database.
#[tauri::command]
async fn sql_execute_atomic(
    app: tauri::AppHandle,
    db: String,
    statements: Vec<AtomicStatement>,
) -> Result<(), String> {
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::{Connection, Executor};
    use std::str::FromStr;
    use std::time::Duration;

    // The db argument is a bare filename (e.g. "neuralpgn.<id>.db"); reject
    // anything with path components so it can't escape the app config dir.
    if PathBuf::from(&db).components().count() != 1
        || PathBuf::from(&db)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("invalid database name: {db}"));
    }
    let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let db_path = base.join(&db);
    let url = format!(
        "sqlite:{}",
        db_path
            .to_str()
            .ok_or_else(|| "invalid database path".to_string())?
    );

    let options = SqliteConnectOptions::from_str(&url)
        .map_err(|e| e.to_string())?
        // The plugin's pool holds the file open; wait out its short locks
        // instead of failing immediately.
        .busy_timeout(Duration::from_secs(10));
    let mut conn = sqlx::SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    for st in &statements {
        let mut query = sqlx::query(&st.sql);
        // Same JsonValue binding rules as tauri-plugin-sql's execute(), so
        // values round-trip identically whichever path wrote them.
        for value in &st.params {
            if value.is_null() {
                query = query.bind(None::<serde_json::Value>);
            } else if value.is_string() {
                query = query.bind(value.as_str().unwrap().to_owned());
            } else if let Some(number) = value.as_number() {
                query = query.bind(number.as_f64().unwrap_or_default());
            } else {
                query = query.bind(value.clone());
            }
        }
        tx.execute(query).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
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
            sql_execute_atomic,
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
