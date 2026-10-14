use std::{
    collections::HashMap,
    sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex as StdMutex},
    time::Duration,
};

use russh::{
    client,
    keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg},
    ChannelMsg, ChannelWriteHalf, Disconnect,
};
use russh_sftp::{client::{SftpSession, RawSftpSession}, protocol::{Packet, StatusCode}};
use tauri::{AppHandle, Emitter};
use tokio::{sync::{watch, Mutex, Notify}, time::timeout};
use uuid::Uuid;

use crate::model::{
    AppError, AppResult, Connection, SshConnectResult, SshDataEvent, SshExecResult, SshStatusEvent,
};

const OUTPUT_BATCH_BYTES: usize = 32 * 1024;

#[derive(Default)]
struct OutputAck {
    pending: AtomicU64,
    ready: Notify,
}
impl OutputAck {
    fn acknowledge(&self, sequence: u64) {
        if self.pending.compare_exchange(sequence, 0, Ordering::AcqRel, Ordering::Acquire).is_ok() {
            self.ready.notify_one();
        }
    }
}
fn output_batch(text: &str) -> (&str, &str) {
    let mut end = text.len().min(OUTPUT_BATCH_BYTES);
    while !text.is_char_boundary(end) { end -= 1; }
    text.split_at(end)
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

struct Client {
    fingerprint: Arc<StdMutex<Option<String>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        if let Ok(mut fingerprint) = self.fingerprint.lock() {
            *fingerprint = Some(key.public_key().fingerprint(HashAlg::Sha256).to_string());
        }
        Ok(true)
    }
}

struct Session {
    connection_id: String,
    temporary_credential: bool,
    handle: Arc<Mutex<client::Handle<Client>>>,
    writer: Mutex<ChannelWriteHalf<client::Msg>>,
    closed: watch::Sender<bool>,
    output: OutputAck,
}

#[derive(Clone)]
pub struct SshManager {
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    pending_host_keys: Arc<Mutex<HashMap<String, String>>>,
    pending_connections: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl SshManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            sessions: Default::default(),
            pending_host_keys: Default::default(),
            pending_connections: Default::default(),
        }
    }

    pub async fn connect(
        &self,
        connection: &Connection,
        credential: &str,
        passphrase: Option<&str>,
        temporary: bool,
        requested_id: Option<String>,
    ) -> AppResult<SshConnectResult> {
        let id = requested_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        if id.is_empty() || id.len() > 100 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') {
            return Err(AppError::new("SSH_SESSION_INVALID", "SSH session identifier is invalid"));
        }
        let (closed, mut canceled) = watch::channel(false);
        {
            let mut pending = self.pending_connections.lock().await;
            if pending.contains_key(&id) || self.sessions.lock().await.contains_key(&id) {
                return Err(AppError::new("SSH_SESSION_INVALID", "SSH session identifier is already in use"));
            }
            pending.insert(id.clone(), closed.clone());
        }
        let _ = self.app.emit("ssh:status", SshStatusEvent { session_id: id.clone(), status: "connecting".into(), message: None, code: None });
        let result = tokio::select! {
            biased;
            result = self.connect_session(connection, credential, passphrase, temporary, id.clone(), closed.clone()) => result,
            _ = canceled.changed() => Err(AppError::new("SSH_CONNECTION_CLOSED", "SSH connection was closed")),
        };
        self.pending_connections.lock().await.remove(&id);
        if let Err(error) = &result {
            let _ = self.app.emit("ssh:status", SshStatusEvent {
                session_id: id, status: if *closed.borrow() { "closed" } else { "error" }.into(),
                message: Some(error.message.clone()), code: Some(error.code.clone()),
            });
        }
        result
    }

    async fn connect_session(
        &self, connection: &Connection, credential: &str, passphrase: Option<&str>,
        temporary: bool, session_id: String, closed: watch::Sender<bool>,
    ) -> AppResult<SshConnectResult> {
        let username = connection
            .username
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::new("SSH_USERNAME_REQUIRED", "SSH username is required"))?;
        if credential.is_empty() {
            return Err(AppError::new(
                "CREDENTIAL_MISSING",
                "Save a password or private key before connecting",
            ));
        }

        let observed = Arc::new(StdMutex::new(None));
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(10)),
            keepalive_max: 3,
            nodelay: true,
            window_size: 128 * 1024,
            maximum_packet_size: OUTPUT_BATCH_BYTES as u32,
            channel_buffer_size: 4,
            ..Default::default()
        });
        let target = (connection.host.as_str(), connection.port);
        let mut handle = timeout(
            CONNECT_TIMEOUT,
            client::connect(
                config,
                target,
                Client {
                    fingerprint: observed.clone(),
                },
            ),
        )
        .await
        .map_err(|_| AppError::new("SSH_CONNECTION_TIMEOUT", "SSH connection timed out"))?
        .map_err(ssh_error)?;
        let fingerprint = observed
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .ok_or_else(|| {
                AppError::new(
                    "SSH_HOST_KEY_INVALID",
                    "SSH server did not provide a host key",
                )
            })?;

        match connection.host_key_fingerprint.as_deref() {
            None => {
                self.pending_host_keys
                    .lock()
                    .await
                    .insert(connection.id.clone(), fingerprint.clone());
                let _ = handle
                    .disconnect(
                        Disconnect::ByApplication,
                        "host key confirmation required",
                        "en",
                    )
                    .await;
                return Ok(SshConnectResult::TrustRequired {
                    trust_required: true,
                    fingerprint,
                });
            }
            Some(expected) if expected != fingerprint => {
                let _ = handle
                    .disconnect(Disconnect::HostKeyNotVerifiable, "host key changed", "en")
                    .await;
                return Err(AppError::new(
                    "SSH_HOST_KEY_CHANGED",
                    format!(
                        "Host key changed for {}:{}",
                        connection.host, connection.port
                    ),
                ));
            }
            _ => {}
        }

        let authenticated = match connection.auth_type.as_deref() {
            Some("privateKey") => {
                let key = decode_secret_key(credential, passphrase).map_err(|_| {
                    AppError::new(
                        "SSH_PRIVATE_KEY_INVALID",
                        "Private key or passphrase is invalid",
                    )
                })?;
                let hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(ssh_error)?
                    .flatten();
                handle
                    .authenticate_publickey(
                        username,
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await
                    .map_err(ssh_error)?
                    .success()
            }
            _ => handle
                .authenticate_password(username, credential)
                .await
                .map_err(ssh_error)?
                .success(),
        };
        if !authenticated {
            return Err(AppError::new(
                "SSH_AUTHENTICATION_FAILED",
                "Authentication failed. Check the username and credential.",
            ));
        }

        let channel = handle.channel_open_session().await.map_err(ssh_error)?;
        channel
            .request_pty(false, "xterm-256color", 120, 32, 0, 0, &[])
            .await
            .map_err(ssh_error)?;
        channel.request_shell(false).await.map_err(ssh_error)?;
        let (mut reader, writer) = channel.split();
        let session = Arc::new(Session {
            connection_id: connection.id.clone(),
            temporary_credential: temporary,
            handle: Arc::new(Mutex::new(handle)),
            writer: Mutex::new(writer),
            closed,
            output: OutputAck::default(),
        });
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session.clone());

        let _ = self.app.emit(
            "ssh:status",
            SshStatusEvent {
                session_id: session_id.clone(),
                status: "connected".into(),
                message: None,
                code: None,
            },
        );

        let manager = self.clone();
        let reader_session_id = session_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut pending = HashMap::<u32, Vec<u8>>::new();
            let mut canceled = session.closed.subscribe();
            let mut sequence = 0;
            loop {
                if *canceled.borrow() { break; }
                let message = tokio::select! {
                    _ = canceled.changed() => break,
                    message = reader.wait() => message,
                };
                let Some(message) = message else { break; };
                let (stream, bytes) = match message {
                    ChannelMsg::Data { data } => (0, data),
                    ChannelMsg::ExtendedData { data, ext } => (ext, data),
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => continue,
                };
                let text = decode_terminal_data(pending.entry(stream).or_default(), &bytes);
                if !manager.emit_output(&reader_session_id, &session, &mut canceled, &mut sequence, &text).await { break; }
            }
            if !*canceled.borrow() {
                for bytes in pending.values().filter(|bytes| !bytes.is_empty()) {
                    let text = String::from_utf8_lossy(bytes);
                    if !manager.emit_output(&reader_session_id, &session, &mut canceled, &mut sequence, &text).await { break; }
                }
            }
            // Dropping the bounded channel reader also releases a blocked transport before disconnect.
            drop(reader);

            if manager
                .sessions
                .lock()
                .await
                .remove(&reader_session_id)
                .is_some()
            {
                let _ = manager.app.emit(
                    "ssh:status",
                    SshStatusEvent {
                        session_id: reader_session_id,
                        status: "closed".into(),
                        message: None,
                        code: None,
                    },
                );
            }
        });

        Ok(SshConnectResult::Connected { session_id })
    }

    async fn emit_output(
        &self, id: &str, session: &Session, canceled: &mut watch::Receiver<bool>,
        sequence: &mut u64, mut text: &str,
    ) -> bool {
        while !text.is_empty() {
            if *canceled.borrow() { return false; }
            let (batch, rest) = output_batch(text);
            *sequence += 1;
            session.output.pending.store(*sequence, Ordering::Release);
            if self.app.emit("ssh:data", SshDataEvent { session_id: id.into(), data: batch.into(), sequence: Some(*sequence) }).is_err() { return false; }
            while session.output.pending.load(Ordering::Acquire) != 0 {
                tokio::select! {
                    _ = canceled.changed() => return false,
                    _ = session.output.ready.notified() => {}
                }
            }
            text = rest;
        }
        true
    }

    pub async fn acknowledge_output(&self, id: &str, sequence: u64) -> AppResult<()> {
        if id.is_empty() || id.len() > 100 || sequence == 0 || sequence > 9_007_199_254_740_991 {
            return Err(AppError::new("SSH_SESSION_INVALID", "SSH output acknowledgement is invalid"));
        }
        if let Some(session) = self.sessions.lock().await.get(id) { session.output.acknowledge(sequence); }
        Ok(())
    }

    pub async fn write(&self, session_id: &str, data: String) -> AppResult<()> {
        if data.len() > 1024 * 1024 {
            return Err(AppError::new(
                "SSH_INPUT_INVALID",
                "Terminal input is too large",
            ));
        }
        let session = self.session(session_id).await?;
        let result = session
            .writer
            .lock()
            .await
            .data_bytes(data.into_bytes())
            .await
            .map_err(ssh_error);
        result
    }

    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> AppResult<()> {
        if !(1..=300).contains(&cols) || !(1..=200).contains(&rows) {
            return Err(AppError::new(
                "SSH_RESIZE_INVALID",
                "Terminal size is invalid",
            ));
        }
        let session = self.session(session_id).await?;
        let result = session
            .writer
            .lock()
            .await
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(ssh_error);
        result
    }

    pub async fn exec(&self, session_id: &str, command: String) -> AppResult<SshExecResult> {
        if command.is_empty() || command.len() > 16 * 1024 {
            return Err(AppError::new(
                "SSH_COMMAND_INVALID",
                "SSH command is invalid",
            ));
        }
        let session = self.session(session_id).await?;
        let mut channel = session
            .handle
            .lock()
            .await
            .channel_open_session()
            .await
            .map_err(ssh_error)?;
        channel.exec(false, command).await.map_err(ssh_error)?;
        timeout(COMMAND_TIMEOUT, async move {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut exit_code = 0;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => append_capped(&mut stdout, &data, 1024 * 1024),
                    ChannelMsg::ExtendedData { data, .. } => {
                        append_capped(&mut stderr, &data, 64 * 1024)
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status,
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => {}
                }
            }
            Ok(SshExecResult {
                stdout: String::from_utf8_lossy(&stdout).into_owned(),
                stderr: String::from_utf8_lossy(&stderr).into_owned(),
                exit_code,
            })
        })
        .await
        .map_err(|_| AppError::new("SSH_COMMAND_TIMEOUT", "Remote command timed out"))?
    }

    pub async fn disconnect(&self, session_id: &str) -> AppResult<()> {
        let pending = self.pending_connections.lock().await.get(session_id).cloned();
        if let Some(closed) = &pending { closed.send_replace(true); }
        let session = self.sessions.lock().await.remove(session_id);
        let Some(session) = session else {
            return if pending.is_some() { Ok(()) } else { Err(AppError::new("SSH_SESSION_NOT_FOUND", "SSH session is not available")) };
        };
        session.closed.send_replace(true);
        let _ = session.writer.lock().await.close().await;
        let _ = session
            .handle
            .lock()
            .await
            .disconnect(Disconnect::ByApplication, "closed by user", "en")
            .await;
        let _ = self.app.emit(
            "ssh:status",
            SshStatusEvent {
                session_id: session_id.into(),
                status: "closed".into(),
                message: None,
                code: None,
            },
        );
        Ok(())
    }

    pub async fn has_temporary_credential(&self, connection_id: &str) -> bool {
        self.sessions
            .lock()
            .await
            .values()
            .any(|session| session.connection_id == connection_id && session.temporary_credential)
    }

    pub async fn open_sftp(&self, connection_id: &str) -> AppResult<SftpSession> {
        let session = self
            .sessions
            .lock()
            .await
            .values()
            .find(|session| session.connection_id == connection_id)
            .cloned()
            .ok_or_else(|| {
                AppError::new(
                    "SSH_SESSION_NOT_FOUND",
                    "Connect the SSH terminal before opening SFTP",
                )
            })?;
        let channel = session
            .handle
            .lock()
            .await
            .channel_open_session()
            .await
            .map_err(ssh_error)?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(ssh_error)?;
        SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| AppError::new("SFTP_CONNECTION_FAILED", error.to_string()))
    }

    pub async fn replace_sftp_file(&self, connection_id: &str, source: &str, target: &str) -> AppResult<()> {
        let session = self.sessions.lock().await.values()
            .find(|session| session.connection_id == connection_id).cloned()
            .ok_or_else(|| AppError::new("SSH_SESSION_NOT_FOUND", "SSH session is not available"))?;
        let channel = session.handle.lock().await.channel_open_session().await.map_err(ssh_error)?;
        channel.request_subsystem(true, "sftp").await.map_err(ssh_error)?;
        let raw = RawSftpSession::new(channel.into_stream());
        let version = match raw.init().await {
            Ok(version) => version,
            Err(error) => {
                let _ = raw.close_session();
                return Err(AppError::new("SFTP_SAVE_FAILED", error.to_string()));
            }
        };
        // shortcut: safe overwrite requires posix-rename, add a safe server-specific replacement when other servers are supported.
        if version.extensions.get("posix-rename@openssh.com").map(String::as_str) != Some("1") {
            let _ = raw.close_session();
            return Err(AppError::new("SFTP_ATOMIC_RENAME_UNAVAILABLE", "This server does not support safe overwrite; the original file has not been changed"));
        }
        let mut payload = Vec::new();
        for path in [source, target] {
            payload.extend_from_slice(&(path.len() as u32).to_be_bytes());
            payload.extend_from_slice(path.as_bytes());
        }
        let response = raw.extended("posix-rename@openssh.com", payload).await;
        let _ = raw.close_session();
        match response
            .map_err(|error| AppError::new("SFTP_SAVE_FAILED", error.to_string()))? {
            Packet::Status(status) if status.status_code == StatusCode::Ok => Ok(()),
            Packet::Status(status) => Err(AppError::new("SFTP_SAVE_FAILED", status.error_message)),
            _ => Err(AppError::new("SFTP_SAVE_FAILED", "Unexpected response to safe file replacement")),
        }
    }

    pub async fn trust_host_key(&self, connection_id: &str, fingerprint: &str) -> AppResult<()> {
        let mut pending = self.pending_host_keys.lock().await;
        if pending.get(connection_id).map(String::as_str) != Some(fingerprint) {
            return Err(AppError::new(
                "SSH_HOST_KEY_INVALID",
                "Host key confirmation is invalid or expired",
            ));
        }
        pending.remove(connection_id);
        Ok(())
    }

    async fn session(&self, session_id: &str) -> AppResult<Arc<Session>> {
        if session_id.is_empty() || session_id.len() > 100 {
            return Err(AppError::new(
                "SSH_SESSION_INVALID",
                "SSH session identifier is invalid",
            ));
        }
        self.sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::new("SSH_SESSION_NOT_FOUND", "SSH session is not available"))
    }
}

fn decode_terminal_data(pending: &mut Vec<u8>, data: &[u8]) -> String {
    pending.extend_from_slice(data);
    let mut text = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(value) => { text.push_str(value); pending.clear(); break; }
            Err(error) => {
                let valid = error.valid_up_to();
                text.push_str(std::str::from_utf8(&pending[..valid]).unwrap());
                pending.drain(..valid);
                match error.error_len() {
                    Some(length) => { text.push('�'); pending.drain(..length); }
                    None => break,
                }
            }
        }
    }
    text
}

fn append_capped(target: &mut Vec<u8>, value: &[u8], limit: usize) {
    target.extend_from_slice(&value[..value.len().min(limit.saturating_sub(target.len()))]);
}

fn ssh_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("SSH_CONNECTION_FAILED", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_utf8_preserves_split_characters_and_replaces_invalid_bytes() {
        let source = "中文🙂終端";
        for boundary in 0..=source.len() {
            let mut pending = Vec::new();
            let first = decode_terminal_data(&mut pending, &source.as_bytes()[..boundary]);
            let second = decode_terminal_data(&mut pending, &source.as_bytes()[boundary..]);
            assert_eq!(format!("{first}{second}"), source);
            assert!(pending.is_empty());
        }
        let mut pending = Vec::new();
        assert_eq!(decode_terminal_data(&mut pending, &[0xff, b'a']), "�a");
        assert_eq!(decode_terminal_data(&mut pending, &[0xe4]), "");
        assert_eq!(pending, vec![0xe4]);
    }

    #[test]
    fn output_batches_preserve_unicode_at_the_size_boundary() {
        let text = format!("{}🙂中文", "x".repeat(OUTPUT_BATCH_BYTES - 1));
        let (first, rest) = output_batch(&text);
        assert!(first.len() <= OUTPUT_BATCH_BYTES);
        assert_eq!(rest, "🙂中文");
        assert_eq!(format!("{first}{rest}"), text);
    }

    #[test]
    fn only_the_pending_output_sequence_can_release_backpressure() {
        let output = OutputAck::default();
        output.pending.store(2, Ordering::Release);
        output.acknowledge(1);
        output.acknowledge(3);
        assert_eq!(output.pending.load(Ordering::Acquire), 2);
        output.acknowledge(2);
        assert_eq!(output.pending.load(Ordering::Acquire), 0);
    }

    #[test]
    fn command_output_is_strictly_capped() {
        let mut output = vec![0; 3];
        append_capped(&mut output, &[1, 2, 3], 4);
        assert_eq!(output, vec![0, 0, 0, 1]);
    }
}
