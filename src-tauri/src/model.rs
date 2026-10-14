use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database_ssl_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_tunnel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passphrase_saved: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_key_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub favorite: bool,
    pub sort_order: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_connected_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: Option<String>,
    pub name: String,
    pub notes: Option<String>,
    pub color: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub host: String,
    pub port: u32,
    pub username: Option<String>,
    pub auth_type: Option<String>,
    pub database_type: Option<String>,
    pub database: Option<String>,
    pub database_ssl_mode: Option<String>,
    pub ssh_tunnel_id: Option<String>,
    pub group_id: Option<String>,
    pub favorite: Option<bool>,
    pub sort_order: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSaveRequest {
    pub connection: ConnectionInput,
    pub credential: Option<String>,
    pub passphrase: Option<String>,
    pub clear_credential: Option<bool>,
    pub clear_passphrase: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub sort_order: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionOrderItem {
    pub id: String,
    pub group_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestRequest {
    pub connection: ConnectionInput,
    pub credential: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ConnectionTestTarget {
    Id(String),
    Request(ConnectionTestRequest),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub latency_ms: u128,
    pub tested_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDataEvent {
    pub session_id: String,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshStatusEvent {
    pub session_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPasswordOptions {
    pub password: String,
    pub save_password: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum SshConnectResult {
    Connected {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    TrustRequired {
        #[serde(rename = "trustRequired")]
        trust_required: bool,
        fingerprint: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConnectResult {
    pub session_id: String,
    pub home_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub size: u64,
    pub modified_at: u64,
    pub mode: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferItem {
    pub transfer_id: String,
    pub session_id: String,
    pub direction: String,
    pub name: String,
    pub relative_path: String,
    pub transferred: u64,
    pub total: u64,
    pub speed: f64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferConflict {
    pub direction: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpQueueResult {
    pub transfer_ids: Vec<String>,
    pub conflicts: Vec<SftpTransferConflict>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatusEvent {
    pub session_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::SshConnectResult;

    #[test]
    fn ssh_connect_results_use_renderer_field_names() {
        assert_eq!(
            serde_json::to_value(SshConnectResult::Connected {
                session_id: "session".into(),
            })
            .unwrap(),
            serde_json::json!({ "sessionId": "session" })
        );
        assert_eq!(
            serde_json::to_value(SshConnectResult::TrustRequired {
                trust_required: true,
                fingerprint: "SHA256:key".into(),
            })
            .unwrap(),
            serde_json::json!({ "trustRequired": true, "fingerprint": "SHA256:key" })
        );
    }
}

pub fn validate_transfer_count(count: usize) -> AppResult<()> {
    if count == 0 || count > 10_000 {
        return Err(AppError::new("TRANSFER_INPUT_INVALID", "Choose between 1 and 10000 files"));
    }
    Ok(())
}

#[cfg(test)]
mod transfer_limit_tests {
    use super::*;
    #[test]
    fn accepts_the_shared_batch_limit_and_rejects_empty_or_oversized_batches() {
        assert!(validate_transfer_count(1).is_ok());
        assert!(validate_transfer_count(10_000).is_ok());
        assert!(validate_transfer_count(0).is_err());
        assert!(validate_transfer_count(10_001).is_err());
    }
}
