#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager,
};

use crate::model::{AppError, AppResult};

#[derive(Clone)]
pub struct AndroidFiles {
    cache_dir: std::path::PathBuf,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    handle: tauri::plugin::PluginHandle<tauri::Wry>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct CopyRequest {
    uris: Vec<String>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct CopyResponse {
    files: Vec<String>,
}

impl AndroidFiles {
    pub async fn prepare(&self, uris: Vec<String>) -> AppResult<Vec<String>> {
        crate::model::validate_transfer_count(uris.len())?;
        #[cfg(target_os = "android")]
        return self
            .handle
            .run_mobile_plugin_async::<CopyResponse>("copyFiles", CopyRequest { uris })
            .await
            .map(|response| response.files)
            .map_err(file_error);
        #[cfg(target_os = "ios")]
        {
            let root = self.cache_dir.join("sftp-uploads");
            let mut copied = Vec::new();
            let result: AppResult<()> = async {
                for uri in uris {
                    let source = tauri::Url::parse(&uri).ok().and_then(|url| url.to_file_path().ok())
                        .unwrap_or_else(|| std::path::PathBuf::from(&uri));
                    let source = tokio::fs::canonicalize(source).await.map_err(file_error)?;
                    // The dialog imports a copy into our sandbox; never read an arbitrary external path.
                    let sandbox = tokio::fs::canonicalize(self.handle.app().path().home_dir().map_err(file_error)?).await.map_err(file_error)?;
                    if !source.starts_with(&sandbox) || !tokio::fs::metadata(&source).await.map_err(file_error)?.is_file() {
                        return Err(AppError::new("FILE_ACCESS_FAILED", "Selected file is outside the application sandbox"));
                    }
                    let directory = root.join(uuid::Uuid::new_v4().to_string());
                    tokio::fs::create_dir_all(&directory).await.map_err(file_error)?;
                    let target = directory.join(source.file_name().ok_or_else(|| AppError::new("FILE_ACCESS_FAILED", "File name is invalid"))?);
                    copied.push(target.to_string_lossy().into_owned());
                    tokio::fs::copy(&source, target).await.map_err(file_error)?;
                    if source.starts_with(sandbox.join("Documents/Inbox")) { let _ = tokio::fs::remove_file(source).await; }
                }
                Ok(())
            }.await;
            if let Err(error) = result { let _ = self.release(copied).await; return Err(error); }
            Ok(copied)
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        Ok(uris)
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub async fn copy_text(&self, text: String) -> AppResult<()> {
        self.handle.run_mobile_plugin_async::<serde_json::Value>("copyText", serde_json::json!({ "text": text })).await.map_err(file_error)?;
        Ok(())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub async fn read_text(&self) -> AppResult<String> {
        let value = self.handle.run_mobile_plugin_async::<serde_json::Value>("readText", serde_json::json!({})).await.map_err(file_error)?;
        Ok(value["text"].as_str().unwrap_or("").to_string())
    }

    #[cfg(target_os = "ios")]
    pub async fn export(&self, path: &std::path::Path) -> AppResult<bool> {
        let result = self.handle.run_mobile_plugin_async::<serde_json::Value>("exportFile", serde_json::json!({ "path": path })).await.map_err(file_error)?;
        Ok(!result["canceled"].as_bool().unwrap_or(true))
    }

    pub async fn download_path(&self, name: &str) -> AppResult<std::path::PathBuf> {
        if name.is_empty() || name == "." || name == ".." || name.len() > 255 || name.contains(['/', '\\', '\0']) {
            return Err(AppError::new("FILE_NAME_INVALID", "File name is invalid"));
        }
        let directory = self.cache_dir.join("sftp-downloads").join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&directory).await.map_err(|error| AppError::new("FILE_ACCESS_FAILED", error.to_string()))?;
        Ok(directory.join(name))
    }

    pub async fn release(&self, paths: Vec<String>) -> AppResult<()> {
        let root = self.cache_dir.join("sftp-uploads");
        let Ok(root) = tokio::fs::canonicalize(root).await else {
            return Ok(());
        };
        for path in paths {
            let Ok(path) = tokio::fs::canonicalize(path).await else {
                continue;
            };
            let Some(directory) = path.parent() else {
                continue;
            };
            if directory.parent() == Some(root.as_path()) {
                let _ = tokio::fs::remove_dir_all(directory).await;
            }
        }
        Ok(())
    }
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("android-files")
        .setup(|app, _api| {
            let cache_dir = app.path().app_cache_dir()?;
            #[cfg(target_os = "android")]
            app.manage(AndroidFiles {
                cache_dir,
                handle: _api
                    .register_android_plugin("com.cbgif.remotehub", "AndroidFilesPlugin")?,
            });
            #[cfg(target_os = "ios")]
            app.manage(AndroidFiles { cache_dir, handle: app.state::<remotehub_mobile::NativePlugin>().0.clone() });
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            app.manage(AndroidFiles { cache_dir });
            Ok(())
        })
        .build()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn file_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("ANDROID_FILE_ACCESS_FAILED", error.to_string())
}
