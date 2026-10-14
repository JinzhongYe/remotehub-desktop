mod android_files;
mod credentials;
mod database;
mod model;
mod sftp;
mod ssh;
mod store;

use std::time::{Duration, Instant};

use android_files::AndroidFiles;
use credentials::CredentialVault;
use database::{DatabaseManager, QueryRequest};
use model::{
    AppError, AppResult, Connection, ConnectionOrderItem, ConnectionSaveRequest,
    ConnectionTestResult, ConnectionTestTarget, Group, SftpConnectResult, SftpEntry,
    SftpQueueResult, SftpTransferItem, SshConnectResult, SshExecResult, SshPasswordOptions,
};
use serde_json::{json, Value};
use sftp::SftpManager;
use ssh::SshManager;
use store::{now, ConnectionStore};
use tauri::{Manager, State};
use tokio::{net::TcpStream, sync::Mutex, time::timeout};
use uuid::Uuid;

struct AppState {
    store: Mutex<ConnectionStore>,
    ssh: SshManager,
    sftp: SftpManager,
    database: DatabaseManager,
}

fn secret_key(id: &str, kind: &str) -> String {
    format!("connection/{id}/{kind}")
}

fn credential_reference(id: &str) -> String {
    let provider = if cfg!(target_os = "ios") { "ios-keychain" } else { "android-keystore" };
    format!("{provider}:{id}")
}

fn validate_secret(value: &str, limit: usize, label: &str) -> AppResult<()> {
    if value.is_empty() || value.len() > limit || value.contains('\0') {
        return Err(AppError::new(
            "INVALID_CREDENTIAL",
            format!("{label} is invalid"),
        ));
    }
    Ok(())
}

#[tauri::command]
async fn connections_list(state: State<'_, AppState>) -> AppResult<Value> {
    let (connections, groups) = state.store.lock().await.list();
    Ok(json!({ "connections": connections, "groups": groups }))
}

#[tauri::command]
async fn storage_get(key: String, state: State<'_, AppState>) -> AppResult<Option<String>> {
    state.store.lock().await.setting(&key)
}

#[tauri::command]
async fn storage_set(key: String, value: String, state: State<'_, AppState>) -> AppResult<Value> {
    state.store.lock().await.set_setting(key, value)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn storage_remove(key: String, state: State<'_, AppState>) -> AppResult<Value> {
    state.store.lock().await.remove_setting(&key)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn connections_save(
    mut request: ConnectionSaveRequest,
    state: State<'_, AppState>,
    vault: State<'_, CredentialVault>,
) -> AppResult<Connection> {
    let id = request
        .connection
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    request.connection.id = Some(id.clone());
    let previous = state.store.lock().await.get(&id);
    let auth_type = request.connection.auth_type.as_deref().unwrap_or("none");
    let credential_key = secret_key(&id, "credential");
    let passphrase_key = secret_key(&id, "passphrase");

    let credential = if auth_type == "none" || request.clear_credential.unwrap_or(false) {
        None
    } else if let Some(value) = request.credential.as_deref() {
        validate_secret(value, 256 * 1024, "Credential")?;
        Some(value.to_string())
    } else if previous
        .as_ref()
        .and_then(|item| item.credential_id.as_ref())
        .is_some()
    {
        vault.get(&credential_key).await?
    } else {
        None
    };
    let passphrase = if auth_type != "privateKey" || request.clear_passphrase.unwrap_or(false) {
        None
    } else if let Some(value) = request.passphrase.as_deref() {
        validate_secret(value, 16 * 1024, "Passphrase")?;
        Some(value.to_string())
    } else if previous
        .as_ref()
        .is_some_and(|item| item.passphrase_saved == Some(true))
    {
        vault.get(&passphrase_key).await?
    } else {
        None
    };

    if auth_type == "privateKey" {
        if let Some(key) = credential.as_deref() {
            russh::keys::decode_secret_key(key, passphrase.as_deref()).map_err(|_| {
                AppError::new(
                    "SSH_PRIVATE_KEY_INVALID",
                    "Private key or passphrase is invalid",
                )
            })?;
        }
    }
    let credential_id = credential
        .as_ref()
        .map(|_| credential_reference(&id));
    let connection = state.store.lock().await.build_connection(
        request.connection,
        credential_id,
        passphrase.is_some(),
    )?;

    match credential.as_deref() {
        Some(value) => vault.set(&credential_key, value).await?,
        None => vault.delete(&credential_key).await?,
    }
    match passphrase.as_deref() {
        Some(value) => vault.set(&passphrase_key, value).await?,
        None => vault.delete(&passphrase_key).await?,
    }
    state.store.lock().await.save(connection)
}

#[tauri::command]
async fn connections_delete(
    id: String,
    state: State<'_, AppState>,
    vault: State<'_, CredentialVault>,
) -> AppResult<Value> {
    state.store.lock().await.delete(&id)?;
    vault.delete(&secret_key(&id, "credential")).await?;
    vault.delete(&secret_key(&id, "passphrase")).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn connections_duplicate(id: String, state: State<'_, AppState>) -> AppResult<Connection> {
    state.store.lock().await.duplicate(&id)
}

#[tauri::command]
async fn connections_reorder(
    items: Vec<ConnectionOrderItem>,
    state: State<'_, AppState>,
) -> AppResult<Vec<Connection>> {
    state.store.lock().await.reorder(items)
}

#[tauri::command]
async fn connections_test(
    target: ConnectionTestTarget,
    state: State<'_, AppState>,
    vault: State<'_, CredentialVault>,
) -> AppResult<ConnectionTestResult> {
    let (connection, credential) = match target {
        ConnectionTestTarget::Id(id) => {
            let connection = state.store.lock().await.get(&id);
            let credential = if connection
                .as_ref()
                .is_some_and(|item| item.kind == "database")
            {
                vault.get(&secret_key(&id, "credential")).await?
            } else {
                None
            };
            (connection, credential)
        }
        ConnectionTestTarget::Request(request) => {
            let previous = match request.connection.id.as_deref() {
                Some(id) => state.store.lock().await.get(id),
                None => None,
            };
            let credential = match request.credential {
                Some(value) => Some(value),
                None => match previous.as_ref().filter(|item| item.kind == "database" && item.credential_id.is_some()) {
                    Some(item) => vault.get(&secret_key(&item.id, "credential")).await?,
                    None => None,
                },
            };
            (Some(state.store.lock().await.build_connection(request.connection, None, false)?), credential)
        }
    };
    let Some(connection) = connection else {
        return Ok(test_result(
            false,
            "CONNECTION_FAILED",
            "Connection not found",
            0,
        ));
    };
    let started = Instant::now();
    if connection.kind == "database" {
        let result = match state
            .database
            .test(&connection, credential.as_deref().unwrap_or(""))
            .await
        {
            Ok(()) => test_result(
                true,
                "OK",
                "Database authentication succeeded",
                started.elapsed().as_millis(),
            ),
            Err(error) => test_result(
                false,
                database_test_code(&error.code),
                &error.message,
                started.elapsed().as_millis(),
            ),
        };
        return Ok(result);
    }
    let result = match timeout(
        Duration::from_secs(5),
        TcpStream::connect((connection.host.as_str(), connection.port)),
    )
    .await
    {
        Ok(Ok(_)) => test_result(
            true,
            "OK",
            "Connection succeeded",
            started.elapsed().as_millis(),
        ),
        Err(_) => test_result(
            false,
            "CONNECTION_TIMEOUT",
            "Connection timed out",
            started.elapsed().as_millis(),
        ),
        Ok(Err(error)) => test_result(
            false,
            connection_error_code(error.kind()),
            &error.to_string(),
            started.elapsed().as_millis(),
        ),
    };
    Ok(result)
}

fn database_test_code(code: &str) -> &'static str {
    match code {
        "DATABASE_AUTH_FAILED" => "AUTHENTICATION_FAILED",
        "DATABASE_NOT_FOUND" => "DATABASE_NOT_FOUND",
        "DATABASE_TIMEOUT" => "CONNECTION_TIMEOUT",
        "DATABASE_HOST_NOT_FOUND" => "HOST_NOT_FOUND",
        "DATABASE_CONNECTION_REFUSED" => "CONNECTION_REFUSED",
        _ => "DATABASE_FAILED",
    }
}

fn test_result(ok: bool, code: &str, message: &str, latency_ms: u128) -> ConnectionTestResult {
    ConnectionTestResult {
        ok,
        code: code.into(),
        message: message.into(),
        latency_ms,
        tested_at: now(),
    }
}

fn connection_error_code(kind: std::io::ErrorKind) -> &'static str {
    match kind {
        std::io::ErrorKind::ConnectionRefused => "CONNECTION_REFUSED",
        std::io::ErrorKind::NotFound => "HOST_NOT_FOUND",
        std::io::ErrorKind::TimedOut => "CONNECTION_TIMEOUT",
        std::io::ErrorKind::NetworkUnreachable | std::io::ErrorKind::HostUnreachable => {
            "NETWORK_UNREACHABLE"
        }
        _ => "CONNECTION_FAILED",
    }
}

#[tauri::command]
async fn groups_save(
    name: String,
    id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Group> {
    state.store.lock().await.save_group(name, id)
}

#[tauri::command]
async fn groups_reorder(ids: Vec<String>, state: State<'_, AppState>) -> AppResult<Vec<Group>> {
    state.store.lock().await.reorder_groups(ids)
}

#[tauri::command]
async fn groups_delete(id: String, state: State<'_, AppState>) -> AppResult<Value> {
    state.store.lock().await.delete_group(&id)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn ssh_connect(
    connection_id: String,
    options: Option<SshPasswordOptions>,
    session_id: Option<String>,
    state: State<'_, AppState>,
    vault: State<'_, CredentialVault>,
) -> AppResult<SshConnectResult> {
    let connection = state
        .store
        .lock()
        .await
        .get(&connection_id)
        .ok_or_else(|| AppError::new("CONNECTION_NOT_FOUND", "SSH connection not found"))?;
    let temporary = options
        .as_ref()
        .is_some_and(|options| !options.save_password);
    let credential = match options.as_ref() {
        Some(options) => options.password.clone(),
        None => vault
            .get(&secret_key(&connection.id, "credential"))
            .await?
            .ok_or_else(|| {
                AppError::new(
                    "CREDENTIAL_MISSING",
                    "Save a password or private key before connecting",
                )
            })?,
    };
    let passphrase = if connection.auth_type.as_deref() == Some("privateKey") {
        vault.get(&secret_key(&connection.id, "passphrase")).await?
    } else {
        None
    };
    let result = state
        .ssh
        .connect(&connection, &credential, passphrase.as_deref(), temporary, session_id)
        .await?;
    if matches!(result, SshConnectResult::Connected { .. }) {
        if let Some(options) = options.filter(|options| options.save_password) {
            validate_secret(&options.password, 16 * 1024, "Password")?;
            vault
                .set(&secret_key(&connection.id, "credential"), &options.password)
                .await?;
            let credential_id = Some(credential_reference(&connection.id));
            let input = model::ConnectionInput {
                id: Some(connection.id.clone()),
                name: connection.name.clone(),
                notes: connection.notes.clone(),
                color: connection.color.clone(),
                kind: connection.kind.clone(),
                host: connection.host.clone(),
                port: connection.port.into(),
                username: connection.username.clone(),
                auth_type: Some("password".into()),
                database_type: None,
                database: None,
                database_ssl_mode: None,
                ssh_tunnel_id: None,
                group_id: connection.group_id.clone(),
                favorite: Some(connection.favorite),
                sort_order: Some(connection.sort_order),
            };
            let saved = state
                .store
                .lock()
                .await
                .build_connection(input, credential_id, false)?;
            state.store.lock().await.save(saved)?;
        }
        let _ = state.store.lock().await.mark_connected(&connection.id);
    }
    Ok(result)
}

#[tauri::command]
async fn ssh_trust_host_key(
    connection_id: String,
    fingerprint: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state
        .ssh
        .trust_host_key(&connection_id, &fingerprint)
        .await?;
    state
        .store
        .lock()
        .await
        .trust_host_key(&connection_id, &fingerprint)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn ssh_has_session_credential(
    connection_id: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    Ok(state.ssh.has_temporary_credential(&connection_id).await)
}

#[tauri::command]
async fn ssh_acknowledge_output(session_id: String, sequence: u64, state: State<'_, AppState>) -> AppResult<Value> {
    state.ssh.acknowledge_output(&session_id, sequence).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn ssh_write(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state.ssh.write(&session_id, data).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state.ssh.resize(&session_id, cols, rows).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn ssh_exec(
    session_id: String,
    command: String,
    state: State<'_, AppState>,
) -> AppResult<SshExecResult> {
    state.ssh.exec(&session_id, command).await
}

#[tauri::command]
async fn ssh_disconnect(session_id: String, state: State<'_, AppState>) -> AppResult<Value> {
    state.ssh.disconnect(&session_id).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn sftp_connect(
    connection_id: String,
    options: Option<SshPasswordOptions>,
    state: State<'_, AppState>,
) -> AppResult<SftpConnectResult> {
    let _ = options;
    let connection = state
        .store
        .lock()
        .await
        .get(&connection_id)
        .filter(|connection| connection.kind == "ssh")
        .ok_or_else(|| {
            AppError::new("SFTP_CONNECTION_INVALID", "SFTP requires an SSH connection")
        })?;
    state.sftp.connect(&connection.id).await
}

#[tauri::command]
async fn sftp_list(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<SftpEntry>> {
    state.sftp.list(&session_id, &path).await
}

#[tauri::command]
async fn sftp_mkdir(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state.sftp.mkdir(&session_id, &path).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state.sftp.rename(&session_id, &old_path, &new_path).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn sftp_read_text(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let (content, modified_at) = state.sftp.read_text(&session_id, &path).await?;
    Ok(json!({ "content": content, "modifiedAt": modified_at }))
}

#[tauri::command]
async fn sftp_write_text(
    session_id: String,
    path: String,
    content: String,
    expected_modified_at: u64,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let modified_at = state
        .sftp
        .write_text(&session_id, &path, &content, expected_modified_at)
        .await?;
    Ok(json!({ "modifiedAt": modified_at }))
}

#[tauri::command]
async fn sftp_remove(
    session_id: String,
    path: String,
    entry_type: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state.sftp.remove(&session_id, &path, &entry_type).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn sftp_enqueue_uploads(
    session_id: String,
    local_paths: Vec<String>,
    remote_directory: String,
    overwrite: bool,
    state: State<'_, AppState>,
) -> AppResult<SftpQueueResult> {
    state
        .sftp
        .upload(&session_id, local_paths, &remote_directory, overwrite)
        .await
}

#[tauri::command]
async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_target: String,
    entry_type: String,
    state: State<'_, AppState>,
) -> AppResult<SftpQueueResult> {
    state
        .sftp
        .download(&session_id, &remote_path, &entry_type, &local_target)
        .await
}

#[tauri::command]
async fn app_copy_text(text: String, files: State<'_, AndroidFiles>) -> AppResult<Value> {
    if text.len() > 16 * 1024 * 1024 { return Err(AppError::new("CLIPBOARD_INVALID", "Clipboard text is too large")); }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    { files.copy_text(text).await?; Ok(json!({ "ok": true })) }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    { let _ = (text, files); Err(AppError::new("CLIPBOARD_UNAVAILABLE", "Native mobile clipboard is unavailable")) }
}

#[tauri::command]
async fn app_read_text(files: State<'_, AndroidFiles>) -> AppResult<String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    { files.read_text().await }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    { let _ = files; Err(AppError::new("CLIPBOARD_UNAVAILABLE", "Native mobile clipboard is unavailable")) }
}

#[tauri::command]
async fn app_download_path(name: String, files: State<'_, AndroidFiles>) -> AppResult<String> {
    Ok(files.download_path(&name).await?.to_string_lossy().into_owned())
}

#[tauri::command]
async fn app_prepare_upload_files(
    uris: Vec<String>,
    files: State<'_, AndroidFiles>,
) -> AppResult<Vec<String>> {
    files.prepare(uris).await
}

#[tauri::command]
async fn app_release_files(paths: Vec<String>, files: State<'_, AndroidFiles>) -> AppResult<Value> {
    files.release(paths).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn sftp_list_transfers(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<SftpTransferItem>> {
    state.sftp.list_transfers(&session_id).await
}

#[tauri::command]
async fn sftp_clear_finished_transfers(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state.sftp.clear_finished(&session_id).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn sftp_disconnect(session_id: String, state: State<'_, AppState>) -> AppResult<Value> {
    state.sftp.disconnect(&session_id).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn database_connect(
    connection_id: String,
    state: State<'_, AppState>,
    vault: State<'_, CredentialVault>,
) -> AppResult<database::ConnectResult> {
    let connection = state
        .store
        .lock()
        .await
        .get(&connection_id)
        .filter(|connection| connection.kind == "database")
        .ok_or_else(|| {
            AppError::new(
                "DATABASE_CONNECTION_INVALID",
                "Database connection not found",
            )
        })?;
    let password = vault
        .get(&secret_key(&connection.id, "credential"))
        .await?
        .unwrap_or_default();
    let result = state.database.connect(connection.clone(), password).await?;
    state.store.lock().await.mark_connected(&connection.id)?;
    Ok(result)
}

#[tauri::command]
async fn database_list_databases(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<database::Catalog>> {
    state.database.list_databases(&session_id).await
}

#[tauri::command]
async fn database_use_database(
    session_id: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    Ok(json!({ "database": state.database.use_database(&session_id, name).await? }))
}

#[tauri::command]
async fn database_list_tables(
    session_id: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<database::Table>> {
    state.database.list_tables(&session_id, name).await
}

#[tauri::command]
async fn database_list_columns(
    session_id: String,
    name: String,
    table: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<database::DatabaseColumn>> {
    state.database.list_columns(&session_id, name, table).await
}

#[tauri::command]
async fn database_list_table_details(
    session_id: String,
    name: String,
    table: String,
    section: String,
    state: State<'_, AppState>,
) -> AppResult<database::TableDetails> {
    state
        .database
        .list_table_details(&session_id, name, table, section)
        .await
}

#[tauri::command]
async fn database_query(
    session_id: String,
    request: QueryRequest,
    state: State<'_, AppState>,
) -> AppResult<database::QueryResult> {
    state.database.query(&session_id, request).await
}

#[tauri::command]
async fn database_apply_changes(
    session_id: String,
    request: database::ChangesRequest,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    state.database.apply_changes(&session_id, request).await?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn database_export_csv(
    target: String,
    csv: String,
    app: tauri::AppHandle,
    _files: State<'_, AndroidFiles>,
) -> AppResult<Value> {
    if csv.len() > 16 * 1024 * 1024 {
        return Err(AppError::new(
            "DATABASE_EXPORT_INVALID",
            "CSV export is too large",
        ));
    }
    #[cfg(target_os = "ios")]
    {
        let path = std::path::PathBuf::from(&target);
        let parent = path.parent().ok_or_else(|| AppError::new("DATABASE_EXPORT_INVALID", "Export destination is invalid"))?;
        let root = app.path().app_cache_dir().map_err(|error| AppError::new("DATABASE_EXPORT_FAILED", error.to_string()))?.join("sftp-downloads");
        let parent = tokio::fs::canonicalize(parent).await.map_err(|error| AppError::new("DATABASE_EXPORT_INVALID", error.to_string()))?;
        let root = tokio::fs::canonicalize(root).await.map_err(|error| AppError::new("DATABASE_EXPORT_INVALID", error.to_string()))?;
        if parent.parent() != Some(root.as_path()) { return Err(AppError::new("DATABASE_EXPORT_INVALID", "Export destination is outside the cache")); }
        tokio::fs::write(&path, csv).await.map_err(|error| AppError::new("DATABASE_EXPORT_FAILED", error.to_string()))?;
        let exported = _files.export(&path).await;
        let _ = tokio::fs::remove_dir_all(parent).await;
        return exported.map(|exported| json!({ "ok": true, "canceled": !exported }));
    }
    #[cfg(not(target_os = "ios"))]
    {
    use tauri_plugin_fs::FsExt;
    use tokio::io::AsyncWriteExt;
    let target = tauri::Url::parse(&target)
        .map_err(|_| AppError::new("DATABASE_EXPORT_INVALID", "Export destination is invalid"))?;
    if target.scheme() != "content" {
        return Err(AppError::new(
            "DATABASE_EXPORT_INVALID",
            "Export destination is invalid",
        ));
    }
    let mut options = tauri_plugin_fs::OpenOptions::new();
    options.write(true).truncate(true);
    let file = app
        .fs()
        .open(target, options)
        .map_err(|error| AppError::new("DATABASE_EXPORT_FAILED", error.to_string()))?;
    let mut file = tokio::fs::File::from_std(file);
    file.write_all(csv.as_bytes())
        .await
        .map_err(|error| AppError::new("DATABASE_EXPORT_FAILED", error.to_string()))?;
    file.flush()
        .await
        .map_err(|error| AppError::new("DATABASE_EXPORT_FAILED", error.to_string()))?;
    Ok(json!({ "ok": true }))
    }
}

#[tauri::command]
async fn database_disconnect(session_id: String, state: State<'_, AppState>) -> AppResult<Value> {
    state.database.disconnect(&session_id).await;
    Ok(json!({ "ok": true }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(remotehub_mobile::init())
        .plugin(android_files::init())
        .plugin(credentials::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("connections.json");
            let cache_dir = app.path().app_cache_dir()?;
            let store = ConnectionStore::load(path).map_err(Box::<dyn std::error::Error>::from)?;
            let ssh = SshManager::new(app.handle().clone());
            let database = DatabaseManager::new(app.handle().clone());
            app.manage(AppState {
                store: Mutex::new(store),
                sftp: SftpManager::new(app.handle().clone(), ssh.clone(), cache_dir),
                ssh,
                database,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage_get,
            storage_set,
            storage_remove,
            connections_list,
            connections_save,
            connections_delete,
            connections_duplicate,
            connections_reorder,
            connections_test,
            groups_save,
            groups_reorder,
            groups_delete,
            ssh_connect,
            ssh_trust_host_key,
            ssh_has_session_credential,
            ssh_write,
            ssh_acknowledge_output,
            ssh_resize,
            ssh_exec,
            ssh_disconnect,
            sftp_connect,
            sftp_list,
            sftp_mkdir,
            sftp_rename,
            sftp_read_text,
            sftp_write_text,
            sftp_remove,
            sftp_enqueue_uploads,
            sftp_download,
            app_copy_text,
            app_read_text,
            app_download_path,
            app_prepare_upload_files,
            app_release_files,
            sftp_list_transfers,
            sftp_clear_finished_transfers,
            sftp_disconnect,
            database_connect,
            database_list_databases,
            database_use_database,
            database_list_tables,
            database_list_columns,
            database_list_table_details,
            database_query,
            database_apply_changes,
            database_export_csv,
            database_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
