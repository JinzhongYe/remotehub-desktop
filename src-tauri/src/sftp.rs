use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use russh_sftp::{client::SftpSession, protocol::{FileType, OpenFlags}};
use tauri::{AppHandle, Emitter};
#[cfg(not(target_os = "ios"))]
use tauri_plugin_fs::{FsExt, OpenOptions};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};
use uuid::Uuid;

use crate::{
    model::{
        AppError, AppResult, SessionStatusEvent, SftpConnectResult, SftpEntry, SftpQueueResult,
        SftpTransferConflict, SftpTransferItem,
    },
    ssh::SshManager,
    store::now,
};

const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct SftpManager {
    app: AppHandle,
    ssh: SshManager,
    cache_dir: PathBuf,
    sessions: Arc<Mutex<HashMap<String, (Arc<SftpSession>, String)>>>,
    transfers: Arc<Mutex<HashMap<String, SftpTransferItem>>>,
}

impl SftpManager {
    pub fn new(app: AppHandle, ssh: SshManager, cache_dir: PathBuf) -> Self {
        Self {
            app,
            ssh,
            cache_dir,
            sessions: Default::default(),
            transfers: Default::default(),
        }
    }

    pub async fn connect(&self, connection_id: &str) -> AppResult<SftpConnectResult> {
        let session = Arc::new(self.ssh.open_sftp(connection_id).await?);
        let home_path =
            normalize_remote_path(&session.canonicalize(".").await.map_err(sftp_error)?)?;
        let session_id = Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), (session, connection_id.to_string()));
        self.emit_status(&session_id, "connected", None);
        Ok(SftpConnectResult {
            session_id,
            home_path,
        })
    }

    pub async fn list(&self, session_id: &str, path: &str) -> AppResult<Vec<SftpEntry>> {
        let path = normalize_remote_path(path)?;
        let session = self.session(session_id).await?;
        let mut entries = session
            .read_dir(path.clone())
            .await
            .map_err(sftp_error)?
            .map(|entry| {
                let metadata = entry.metadata();
                let kind = match entry.file_type() {
                    FileType::Dir => "directory",
                    FileType::Symlink => "link",
                    _ => "file",
                };
                SftpEntry {
                    name: entry.file_name(),
                    path: entry.path(),
                    kind: kind.into(),
                    size: metadata.size.unwrap_or(0),
                    modified_at: u64::from(metadata.mtime.unwrap_or(0)) * 1000,
                    mode: metadata.permissions.unwrap_or(0),
                }
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            (left.kind != "directory", left.name.to_lowercase())
                .cmp(&(right.kind != "directory", right.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub async fn mkdir(&self, session_id: &str, path: &str) -> AppResult<()> {
        self.session(session_id)
            .await?
            .create_dir(normalize_remote_path(path)?)
            .await
            .map_err(sftp_error)
    }

    pub async fn rename(&self, session_id: &str, old_path: &str, new_path: &str) -> AppResult<()> {
        let old_path = normalize_remote_path(old_path)?;
        let new_path = normalize_remote_path(new_path)?;
        if old_path == new_path || parent(&old_path) != parent(&new_path) {
            return Err(AppError::new(
                "SFTP_RENAME_INVALID",
                "Enter a new file or folder name without slashes",
            ));
        }
        self.session(session_id)
            .await?
            .rename(old_path, new_path)
            .await
            .map_err(sftp_error)
    }

    pub async fn read_text(&self, session_id: &str, path: &str) -> AppResult<(String, u64)> {
        let path = normalize_remote_path(path)?;
        let session = self.session(session_id).await?;
        let metadata = session.metadata(path.clone()).await.map_err(sftp_error)?;
        if metadata.size.unwrap_or(0) > MAX_EDIT_BYTES {
            return Err(AppError::new(
                "SFTP_EDIT_TOO_LARGE",
                "Online editing supports text files up to 2 MB",
            ));
        }
        let data = session.read(path).await.map_err(sftp_error)?;
        if data.len() as u64 > MAX_EDIT_BYTES || data.contains(&0) {
            return Err(AppError::new(
                "SFTP_EDIT_BINARY",
                "Online editing supports UTF-8 text files only",
            ));
        }
        let content = String::from_utf8(data).map_err(|_| {
            AppError::new(
                "SFTP_EDIT_BINARY",
                "Online editing supports UTF-8 text files only",
            )
        })?;
        Ok((content, u64::from(metadata.mtime.unwrap_or(0)) * 1000))
    }

    pub async fn write_text(
        &self,
        session_id: &str,
        path: &str,
        content: &str,
        expected_modified_at: u64,
    ) -> AppResult<u64> {
        if content.len() as u64 > MAX_EDIT_BYTES || content.contains('\0') {
            return Err(AppError::new(
                "SFTP_EDIT_TOO_LARGE",
                "Online editing supports text files up to 2 MB",
            ));
        }
        let path = normalize_remote_path(path)?;
        let session = self.session(session_id).await?;
        let path = session.canonicalize(path).await.map_err(sftp_error)?;
        let before = session.metadata(path.clone()).await.map_err(sftp_error)?;
        if u64::from(before.mtime.unwrap_or(0)) * 1000 != expected_modified_at {
            return Err(AppError::new(
                "SFTP_EDIT_CONFLICT",
                "Remote file changed after it was opened; reopen it before saving",
            ));
        }
        let temporary = join_remote_path(parent(&path), &format!(".remotehub-{}.tmp", Uuid::new_v4()))?;
        let result: AppResult<()> = async {
            let mut private = russh_sftp::client::fs::Metadata::default();
            private.permissions = Some(0o600);
            let mut file = session.open_with_flags_and_attributes(temporary.clone(), OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE, private).await.map_err(sftp_error)?;
            file.write_all(content.as_bytes()).await.map_err(sftp_error)?;
            file.close().await.map_err(sftp_error)?;
            let mut attributes = russh_sftp::client::fs::Metadata::default();
            attributes.permissions = before.permissions;
            attributes.uid = before.uid;
            attributes.gid = before.gid;
            session.set_metadata(temporary.clone(), attributes).await.map_err(sftp_error)?;
            let current = session.metadata(path.clone()).await.map_err(sftp_error)?;
            if current.mtime != before.mtime || current.size != before.size {
                return Err(AppError::new("SFTP_EDIT_CONFLICT", "Remote file changed while saving; reopen it before saving"));
            }
            self.commit_file(session_id, &session, &temporary, &path, true).await
        }.await;
        if result.is_err() { let _ = session.remove_file(temporary).await; }
        result?;
        let after = session.metadata(path).await.map_err(sftp_error)?;
        Ok(u64::from(after.mtime.unwrap_or(0)) * 1000)
    }

    pub async fn remove(&self, session_id: &str, path: &str, kind: &str) -> AppResult<()> {
        let path = normalize_remote_path(path)?;
        let session = self.session(session_id).await?;
        match kind {
            "directory" => session.remove_dir(path).await,
            "file" | "link" => session.remove_file(path).await,
            _ => {
                return Err(AppError::new(
                    "SFTP_ENTRY_TYPE_INVALID",
                    "Remote entry type is invalid",
                ))
            }
        }
        .map_err(sftp_error)
    }

    pub async fn upload(
        &self,
        session_id: &str,
        local_paths: Vec<String>,
        remote_directory: &str,
        overwrite: bool,
    ) -> AppResult<SftpQueueResult> {
        crate::model::validate_transfer_count(local_paths.len())?;
        let remote_directory = normalize_remote_path(remote_directory)?;
        let session = self.session(session_id).await?;
        let mut files = Vec::with_capacity(local_paths.len());
        for value in local_paths {
            let path = self.local_file_path(&value).await?;
            let metadata = fs::metadata(&path).await.map_err(local_error)?;
            if !metadata.is_file() {
                return Err(AppError::new(
                    "TRANSFER_INPUT_INVALID",
                    "Mobile SFTP currently uploads files only",
                ));
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::new("TRANSFER_INPUT_INVALID", "File name is invalid"))?
                .to_string();
            files.push((
                path,
                join_remote_path(&remote_directory, &name)?,
                name,
                metadata.len(),
            ));
        }
        let mut conflicts = Vec::new();
        for (_, remote_path, name, _) in &files {
            if session
                .try_exists(remote_path.clone())
                .await
                .map_err(sftp_error)?
            {
                conflicts.push(SftpTransferConflict {
                    direction: "upload".into(),
                    path: remote_path.clone(),
                    name: name.clone(),
                });
            }
        }
        if !overwrite && !conflicts.is_empty() {
            return Ok(SftpQueueResult {
                transfer_ids: Vec::new(),
                conflicts,
            });
        }
        let mut transfer_ids = Vec::with_capacity(files.len());
        for (local_path, remote_path, name, size) in files {
            let mut item = self.start_transfer(session_id, "upload", &name, size).await;
            transfer_ids.push(item.transfer_id.clone());
            let result = self
                .copy_upload(session_id, &session, &local_path, &remote_path, overwrite, &mut item)
                .await;
            self.finish_transfer(item, result.err()).await;
        }
        Ok(SftpQueueResult {
            transfer_ids,
            conflicts: Vec::new(),
        })
    }

    pub async fn download(
        &self,
        session_id: &str,
        remote_path: &str,
        kind: &str,
        local_target: &str,
    ) -> AppResult<SftpQueueResult> {
        if kind != "file" && kind != "link" {
            return Err(AppError::new(
                "TRANSFER_INPUT_INVALID",
                "Mobile SFTP currently downloads files only",
            ));
        }
        let remote_path = normalize_remote_path(remote_path)?;
        let session = self.session(session_id).await?;
        let metadata = session
            .metadata(remote_path.clone())
            .await
            .map_err(sftp_error)?;
        let name = remote_path
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::new("TRANSFER_INPUT_INVALID", "File name is invalid"))?;
        #[cfg(target_os = "ios")]
        let mut target = {
            let path = PathBuf::from(local_target);
            let directory = path.parent().ok_or_else(|| AppError::new("SFTP_LOCAL_PATH_INVALID", "Download destination is invalid"))?;
            let directory = fs::canonicalize(directory).await.map_err(local_error)?;
            let root = fs::canonicalize(self.cache_dir.join("sftp-downloads")).await.map_err(local_error)?;
            if directory.parent() != Some(root.as_path()) { return Err(AppError::new("SFTP_LOCAL_PATH_INVALID", "Download destination is outside the cache")); }
            fs::File::create(path).await.map_err(local_error)?
        };
        #[cfg(not(target_os = "ios"))]
        let mut target = {
            let target = tauri::Url::parse(local_target).ok().filter(|url| url.scheme() == "content")
                .ok_or_else(|| AppError::new("SFTP_LOCAL_PATH_INVALID", "Download destination is invalid"))?;
            let mut options = OpenOptions::new();
            options.write(true).truncate(true);
            let file = self.app.fs().open(target, options).map_err(local_error)?;
            fs::File::from_std(file)
        };
        let mut item = self
            .start_transfer(session_id, "download", name, metadata.size.unwrap_or(0))
            .await;
        if let Err(error) = self
            .copy_download(&session, &remote_path, &mut target, &mut item)
            .await
        {
            let message = error.message.clone();
            self.finish_transfer(item, Some(error)).await;
            #[cfg(target_os = "ios")]
            if let Some(parent) = Path::new(local_target).parent() { let _ = fs::remove_dir_all(parent).await; }
            return Err(AppError::new("SFTP_TRANSFER_FAILED", message));
        }
        #[cfg(target_os = "ios")]
        {
            use tauri::Manager;
            drop(target);
            let files = self.app.state::<crate::android_files::AndroidFiles>();
            let exported = files.export(Path::new(local_target)).await;
            if let Some(parent) = Path::new(local_target).parent() { let _ = fs::remove_dir_all(parent).await; }
            match exported {
                Ok(true) => {},
                Ok(false) => {
                    item.status = "cancelled".into();
                    item.speed = 0.0;
                    item.updated_at = now();
                    self.transfers.lock().await.insert(item.transfer_id.clone(), item.clone());
                    self.emit_transfer(&item);
                    return Ok(SftpQueueResult { transfer_ids: vec![], conflicts: vec![] });
                }
                Err(error) => {
                    let message = error.message.clone();
                    self.finish_transfer(item, Some(error)).await;
                    return Err(AppError::new("FILE_EXPORT_FAILED", message));
                }
            }
        }
        let transfer_id = item.transfer_id.clone();
        self.finish_transfer(item, None).await;
        Ok(SftpQueueResult {
            transfer_ids: vec![transfer_id],
            conflicts: Vec::new(),
        })
    }

    pub async fn list_transfers(&self, session_id: &str) -> AppResult<Vec<SftpTransferItem>> {
        self.session(session_id).await?;
        let mut items = self
            .transfers
            .lock()
            .await
            .values()
            .filter(|item| item.session_id == session_id)
            .cloned()
            .collect::<Vec<_>>();
        items.sort_by_key(|item| item.created_at);
        Ok(items)
    }

    pub async fn clear_finished(&self, session_id: &str) -> AppResult<()> {
        self.session(session_id).await?;
        self.transfers.lock().await.retain(|_, item| {
            item.session_id != session_id || (item.status != "completed" && item.status != "error" && item.status != "cancelled")
        });
        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> AppResult<()> {
        let session = self
            .sessions
            .lock()
            .await
            .remove(session_id)
            .ok_or_else(|| {
                AppError::new("SFTP_SESSION_NOT_FOUND", "SFTP session is not available")
            })?;
        let _ = session.0.close().await;
        self.transfers
            .lock()
            .await
            .retain(|_, item| item.session_id != session_id);
        self.emit_status(session_id, "closed", None);
        Ok(())
    }

    async fn session(&self, session_id: &str) -> AppResult<Arc<SftpSession>> {
        if session_id.is_empty() || session_id.len() > 100 {
            return Err(AppError::new(
                "SFTP_SESSION_INVALID",
                "SFTP session identifier is invalid",
            ));
        }
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|(session, _)| session.clone())
            .ok_or_else(|| AppError::new("SFTP_SESSION_NOT_FOUND", "SFTP session is not available"))
    }

    async fn start_transfer(
        &self,
        session_id: &str,
        direction: &str,
        name: &str,
        total: u64,
    ) -> SftpTransferItem {
        let timestamp = now();
        let item = SftpTransferItem {
            transfer_id: Uuid::new_v4().to_string(),
            session_id: session_id.into(),
            direction: direction.into(),
            name: name.into(),
            relative_path: name.into(),
            transferred: 0,
            total,
            speed: 0.0,
            status: "running".into(),
            message: None,
            created_at: timestamp,
            updated_at: timestamp,
        };
        self.transfers
            .lock()
            .await
            .insert(item.transfer_id.clone(), item.clone());
        self.emit_transfer(&item);
        item
    }

    async fn commit_file(&self, session_id: &str, session: &SftpSession, temporary: &str, target: &str, overwrite: bool) -> AppResult<()> {
        if !overwrite || !session.try_exists(target.to_string()).await.map_err(sftp_error)? {
            return session.rename(temporary, target).await.map_err(sftp_error);
        }
        let connection_id = self.sessions.lock().await.get(session_id).map(|(_, id)| id.clone())
            .ok_or_else(|| AppError::new("SFTP_SESSION_NOT_FOUND", "SFTP session is not available"))?;
        self.ssh.replace_sftp_file(&connection_id, temporary, target).await
    }

    async fn copy_upload(
        &self,
        session_id: &str,
        session: &SftpSession,
        local_path: &Path,
        remote_path: &str,
        overwrite: bool,
        item: &mut SftpTransferItem,
    ) -> AppResult<()> {
        let temporary = join_remote_path(parent(remote_path), &format!(".remotehub-{}.tmp", Uuid::new_v4()))?;
        let result: AppResult<()> = async {
            let mut source = fs::File::open(local_path).await.map_err(local_error)?;
            let mut private = russh_sftp::client::fs::Metadata::default();
            private.permissions = Some(0o600);
            let mut target = session.open_with_flags_and_attributes(temporary.clone(), OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE, private).await.map_err(sftp_error)?;
            self.copy(&mut source, &mut target, item).await?;
            target.close().await.map_err(sftp_error)?;
            if overwrite && session.try_exists(remote_path.to_string()).await.map_err(sftp_error)? {
                let existing = session.metadata(remote_path.to_string()).await.map_err(sftp_error)?;
                let mut attributes = russh_sftp::client::fs::Metadata::default();
                attributes.permissions = existing.permissions;
                attributes.uid = existing.uid;
                attributes.gid = existing.gid;
                session.set_metadata(temporary.clone(), attributes).await.map_err(sftp_error)?;
            }
            self.commit_file(session_id, session, &temporary, remote_path, overwrite).await
        }.await;
        if result.is_err() { let _ = session.remove_file(temporary).await; }
        result
    }

    async fn copy_download(
        &self,
        session: &SftpSession,
        remote_path: &str,
        target: &mut fs::File,
        item: &mut SftpTransferItem,
    ) -> Result<(), AppError> {
        let mut source = session.open(remote_path).await.map_err(sftp_error)?;
        self.copy(&mut source, target, item).await?;
        target.flush().await.map_err(local_error)?;
        source.close().await.map_err(sftp_error)
    }

    async fn local_file_path(&self, value: &str) -> AppResult<PathBuf> {
        if value.is_empty() || value.len() > 8192 || value.contains('\0') {
            return Err(AppError::new(
                "SFTP_LOCAL_PATH_INVALID",
                "Local file is invalid",
            ));
        }
        let path = fs::canonicalize(value).await.map_err(local_error)?;
        let root = fs::canonicalize(self.cache_dir.join("sftp-uploads"))
            .await
            .map_err(local_error)?;
        if path.parent().and_then(Path::parent) != Some(root.as_path()) {
            return Err(AppError::new(
                "SFTP_LOCAL_PATH_INVALID",
                "Local file is outside the upload cache",
            ));
        }
        Ok(path)
    }

    async fn copy<R, W>(
        &self,
        source: &mut R,
        target: &mut W,
        item: &mut SftpTransferItem,
    ) -> AppResult<()>
    where
        R: tokio::io::AsyncRead + Unpin,
        W: tokio::io::AsyncWrite + Unpin,
    {
        let started = Instant::now();
        let mut last_emit = Instant::now();
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let count = source.read(&mut buffer).await.map_err(sftp_error)?;
            if count == 0 {
                break;
            }
            target
                .write_all(&buffer[..count])
                .await
                .map_err(sftp_error)?;
            item.transferred += count as u64;
            if last_emit.elapsed().as_millis() >= 100 {
                item.updated_at = now();
                item.speed = item.transferred as f64 / started.elapsed().as_secs_f64().max(0.001);
                self.transfers
                    .lock()
                    .await
                    .insert(item.transfer_id.clone(), item.clone());
                self.emit_transfer(item);
                last_emit = Instant::now();
            }
        }
        item.transferred = item.total.max(item.transferred);
        item.updated_at = now();
        Ok(())
    }

    async fn finish_transfer(&self, mut item: SftpTransferItem, error: Option<AppError>) {
        item.status = if error.is_some() {
            "error"
        } else {
            "completed"
        }
        .into();
        item.message = error.map(|value| value.message);
        item.speed = 0.0;
        item.updated_at = now();
        self.transfers
            .lock()
            .await
            .insert(item.transfer_id.clone(), item.clone());
        self.emit_transfer(&item);
    }

    fn emit_status(&self, session_id: &str, status: &str, message: Option<String>) {
        let _ = self.app.emit(
            "sftp:status",
            SessionStatusEvent {
                session_id: session_id.into(),
                status: status.into(),
                message,
            },
        );
    }

    fn emit_transfer(&self, item: &SftpTransferItem) {
        let _ = self.app.emit("sftp:transfer", item.clone());
    }
}

fn normalize_remote_path(value: &str) -> AppResult<String> {
    if value.is_empty() || value.len() > 4096 || value.contains('\0') {
        return Err(AppError::new("SFTP_PATH_INVALID", "Remote path is invalid"));
    }
    let mut parts = Vec::new();
    for part in value.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    Ok(format!("/{}", parts.join("/")))
}

fn join_remote_path(parent: &str, name: &str) -> AppResult<String> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err(AppError::new("SFTP_PATH_INVALID", "File name is invalid"));
    }
    normalize_remote_path(&format!("{parent}/{name}"))
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or(
        "/",
        |(parent, _)| {
            if parent.is_empty() {
                "/"
            } else {
                parent
            }
        },
    )
}

fn sftp_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("SFTP_OPERATION_FAILED", error.to_string())
}

fn local_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("SFTP_LOCAL_FILE_FAILED", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_remote_paths_and_rejects_embedded_separators() {
        assert_eq!(
            normalize_remote_path("/var/./log/../tmp").unwrap(),
            "/var/tmp"
        );
        assert_eq!(
            join_remote_path("/tmp", "中文.txt").unwrap(),
            "/tmp/中文.txt"
        );
        assert!(join_remote_path("/tmp", "../secret").is_err());
    }
}
