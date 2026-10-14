#[cfg(any(target_os = "android", target_os = "ios"))]
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager,
};

#[cfg(any(target_os = "android", target_os = "ios"))]
use crate::model::AppError;
use crate::model::AppResult;

#[derive(Clone)]
pub struct CredentialVault {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    handle: tauri::plugin::PluginHandle<tauri::Wry>,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    values: std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, String>>>,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
struct KeyRequest<'a> {
    key: &'a str,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Serialize)]
struct SetRequest<'a> {
    key: &'a str,
    value: &'a str,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Deserialize)]
struct GetResponse {
    value: Option<String>,
}

impl CredentialVault {
    pub async fn get(&self, key: &str) -> AppResult<Option<String>> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return self
            .handle
            .run_mobile_plugin_async::<GetResponse>("get", KeyRequest { key })
            .await
            .map(|response| response.value)
            .map_err(vault_error);
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        return Ok(self.values.lock().await.get(key).cloned());
    }

    pub async fn set(&self, key: &str, value: &str) -> AppResult<()> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return self
            .handle
            .run_mobile_plugin_async::<()>("set", SetRequest { key, value })
            .await
            .map_err(vault_error);
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            self.values.lock().await.insert(key.into(), value.into());
            Ok(())
        }
    }

    pub async fn delete(&self, key: &str) -> AppResult<()> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return self
            .handle
            .run_mobile_plugin_async::<()>("delete", KeyRequest { key })
            .await
            .map_err(vault_error);
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            self.values.lock().await.remove(key);
            Ok(())
        }
    }
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("credential-vault")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            app.manage(CredentialVault {
                handle: _api
                    .register_android_plugin("com.cbgif.remotehub", "CredentialVaultPlugin")?,
            });
            #[cfg(target_os = "ios")]
            app.manage(CredentialVault { handle: app.state::<remotehub_mobile::NativePlugin>().0.clone() });
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            app.manage(CredentialVault {
                values: Default::default(),
            });
            Ok(())
        })
        .build()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn vault_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("CREDENTIAL_STORE_UNAVAILABLE", error.to_string())
}
