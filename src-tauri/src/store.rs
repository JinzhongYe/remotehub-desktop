use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{AppError, AppResult, Connection, ConnectionInput, ConnectionOrderItem, Group};

const COLORS: [&str; 8] = [
    "#ff4d4f", "#fa8c16", "#fadb14", "#52c41a", "#13c2c2", "#1677ff", "#a855f7", "#8c8c8c",
];

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredData {
    connections: Vec<Connection>,
    groups: Vec<Group>,
    #[serde(default)]
    settings: HashMap<String, String>,
}

pub struct ConnectionStore {
    path: PathBuf,
    data: StoredData,
}

impl ConnectionStore {
    pub fn load(path: PathBuf) -> AppResult<Self> {
        let data = if path.exists() {
            serde_json::from_slice(&fs::read(&path).map_err(storage_error)?).map_err(|_| {
                AppError::new("STORAGE_CORRUPT", "Mobile connection storage is invalid")
            })?
        } else {
            StoredData::default()
        };
        Ok(Self { path, data })
    }

    pub fn list(&self) -> (Vec<Connection>, Vec<Group>) {
        let mut connections = self.data.connections.clone();
        let mut groups = self.data.groups.clone();
        connections.sort_by_key(|item| item.sort_order);
        groups.sort_by_key(|item| item.sort_order);
        (connections, groups)
    }

    pub fn get(&self, id: &str) -> Option<Connection> {
        self.data
            .connections
            .iter()
            .find(|item| item.id == id)
            .cloned()
    }

    pub fn setting(&self, key: &str) -> AppResult<Option<String>> {
        validate_setting_key(key)?;
        Ok(self.data.settings.get(key).cloned())
    }

    pub fn set_setting(&mut self, key: String, value: String) -> AppResult<()> {
        validate_setting_key(&key)?;
        if value.len() > 1024 * 1024 || value.contains('\0') {
            return Err(AppError::new("INVALID_SETTING", "Setting value is invalid"));
        }
        self.data.settings.insert(key, value);
        self.persist()
    }

    pub fn remove_setting(&mut self, key: &str) -> AppResult<()> {
        validate_setting_key(key)?;
        self.data.settings.remove(key);
        self.persist()
    }

    pub fn build_connection(
        &self,
        mut input: ConnectionInput,
        credential_id: Option<String>,
        passphrase_saved: bool,
    ) -> AppResult<Connection> {
        validate_id(input.id.as_deref())?;
        let previous = input.id.as_deref().and_then(|id| self.get(id));
        let id = input
            .id
            .take()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let name = checked_text(
            input.name,
            120,
            "INVALID_CONNECTION",
            "Connection name is required",
        )?;
        let host = checked_text(input.host, 255, "INVALID_CONNECTION", "Host is required")?;
        let username = checked_text(
            input.username.unwrap_or_default(),
            120,
            "USERNAME_REQUIRED",
            "Username is required",
        )?;
        if input.kind != "ssh" && input.kind != "database" {
            return Err(AppError::new(
                "INVALID_CONNECTION_TYPE",
                "Mobile currently supports SSH and database connections only",
            ));
        }
        if input.port == 0 || input.port > u16::MAX as u32 {
            return Err(AppError::new(
                "INVALID_PORT",
                "Port must be between 1 and 65535",
            ));
        }
        let auth_type = match input.auth_type.as_deref() {
            Some("password") => "password",
            Some("privateKey") if input.kind == "ssh" => "privateKey",
            Some("none") if input.kind == "ssh" => "none",
            _ => {
                return Err(AppError::new(
                    "INVALID_CREDENTIAL",
                    "SSH authentication type is invalid",
                ))
            }
        };
        if let Some(ref color) = input.color {
            if !COLORS.contains(&color.as_str()) {
                return Err(AppError::new(
                    "INVALID_COLOR",
                    "Connection color is invalid",
                ));
            }
        }
        let notes = optional_text(input.notes, 16_384, "notes")?;
        let database_type = if input.kind == "database" {
            match input.database_type.as_deref() {
                Some("postgres") => Some("postgres".into()),
                Some("mysql") => Some("mysql".into()),
                _ => {
                    return Err(AppError::new(
                        "DATABASE_ADAPTER_UNAVAILABLE",
                        "Mobile currently supports PostgreSQL and MySQL",
                    ))
                }
            }
        } else {
            None
        };
        let database = if database_type.is_some() {
            optional_text(input.database, 200, "database")?
        } else {
            None
        };
        let database_ssl_mode = if matches!(database_type.as_deref(), Some("postgres" | "mysql")) {
            match input.database_ssl_mode.as_deref().unwrap_or(if database_type.as_deref() == Some("mysql") { "require" } else { "disable" }) {
                "disable" => Some("disable".into()),
                "require" => Some("require".into()),
                "verify-full" => Some("verify-full".into()),
                _ => {
                    return Err(AppError::new(
                        "DATABASE_SSL_INVALID",
                        "Database SSL mode is invalid",
                    ))
                }
            }
        } else {
            None
        };
        if input.kind == "database" && input.ssh_tunnel_id.is_some() {
            return Err(AppError::new(
                "DATABASE_TUNNEL_UNAVAILABLE",
                "SSH database tunnels are not supported on mobile yet",
            ));
        }
        let group_id = input.group_id.filter(|id| !id.trim().is_empty());
        if group_id
            .as_ref()
            .is_some_and(|id| !self.data.groups.iter().any(|group| group.id == *id))
        {
            return Err(AppError::new(
                "GROUP_NOT_FOUND",
                "Connection group not found",
            ));
        }
        let now = now();
        let keep_host_key = input.kind == "ssh"
            && previous.as_ref().is_some_and(|item| {
                item.kind == "ssh" && item.host == host && item.port == input.port as u16
            });
        Ok(Connection {
            id,
            name,
            notes,
            color: input.color,
            kind: input.kind,
            host,
            port: input.port as u16,
            username: Some(username),
            auth_type: Some(auth_type.into()),
            database_type,
            database,
            database_ssl_mode,
            ssh_tunnel_id: None,
            credential_id,
            passphrase_saved: (auth_type == "privateKey").then_some(passphrase_saved),
            host_key_fingerprint: previous
                .as_ref()
                .filter(|_| keep_host_key)
                .and_then(|item| item.host_key_fingerprint.clone()),
            group_id,
            favorite: input.favorite.unwrap_or(false),
            sort_order: input.sort_order.unwrap_or_else(|| {
                previous
                    .as_ref()
                    .map_or(self.data.connections.len(), |item| item.sort_order)
            }),
            last_connected_at: previous.as_ref().and_then(|item| item.last_connected_at),
            created_at: previous.as_ref().map_or(now, |item| item.created_at),
            updated_at: now,
        })
    }

    pub fn save(&mut self, connection: Connection) -> AppResult<Connection> {
        if let Some(index) = self
            .data
            .connections
            .iter()
            .position(|item| item.id == connection.id)
        {
            self.data.connections[index] = connection.clone();
        } else {
            self.data.connections.push(connection.clone());
        }
        self.persist()?;
        Ok(connection)
    }

    pub fn delete(&mut self, id: &str) -> AppResult<Connection> {
        let index = self
            .data
            .connections
            .iter()
            .position(|item| item.id == id)
            .ok_or_else(|| AppError::new("CONNECTION_NOT_FOUND", "Connection not found"))?;
        let removed = self.data.connections.remove(index);
        self.persist()?;
        Ok(removed)
    }

    pub fn duplicate(&mut self, id: &str) -> AppResult<Connection> {
        let source = self
            .get(id)
            .ok_or_else(|| AppError::new("CONNECTION_NOT_FOUND", "Connection not found"))?;
        let now = now();
        let copy = Connection {
            id: Uuid::new_v4().to_string(),
            name: format!("{} Copy", source.name).chars().take(120).collect(),
            credential_id: None,
            passphrase_saved: source.passphrase_saved.map(|_| false),
            host_key_fingerprint: None,
            sort_order: self.data.connections.len(),
            last_connected_at: None,
            created_at: now,
            updated_at: now,
            ..source
        };
        self.save(copy)
    }

    pub fn reorder(&mut self, items: Vec<ConnectionOrderItem>) -> AppResult<Vec<Connection>> {
        if items.len() != self.data.connections.len() {
            return Err(AppError::new(
                "INVALID_ORDER",
                "Connection order is incomplete",
            ));
        }
        let mut ordered = Vec::with_capacity(items.len());
        for (sort_order, requested) in items.into_iter().enumerate() {
            if ordered
                .iter()
                .any(|item: &Connection| item.id == requested.id)
            {
                return Err(AppError::new(
                    "INVALID_ORDER",
                    "Connection order contains duplicates",
                ));
            }
            if requested
                .group_id
                .as_ref()
                .is_some_and(|id| !self.data.groups.iter().any(|group| group.id == *id))
            {
                return Err(AppError::new(
                    "GROUP_NOT_FOUND",
                    "Connection group not found",
                ));
            }
            let mut item = self
                .get(&requested.id)
                .ok_or_else(|| AppError::new("INVALID_ORDER", "Connection order is invalid"))?;
            item.group_id = requested.group_id;
            item.sort_order = sort_order;
            ordered.push(item);
        }
        self.data.connections = ordered;
        self.persist()?;
        Ok(self.list().0)
    }

    pub fn mark_connected(&mut self, id: &str) -> AppResult<()> {
        let item = self
            .data
            .connections
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| AppError::new("CONNECTION_NOT_FOUND", "Connection not found"))?;
        item.last_connected_at = Some(now());
        self.persist()
    }

    pub fn trust_host_key(&mut self, id: &str, fingerprint: &str) -> AppResult<()> {
        if !valid_fingerprint(fingerprint) {
            return Err(AppError::new(
                "SSH_HOST_KEY_INVALID",
                "Host key fingerprint is invalid",
            ));
        }
        let item = self
            .data
            .connections
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| AppError::new("CONNECTION_NOT_FOUND", "SSH connection not found"))?;
        item.host_key_fingerprint = Some(fingerprint.into());
        item.updated_at = now();
        self.persist()
    }

    pub fn save_group(&mut self, name: String, id: Option<String>) -> AppResult<Group> {
        validate_id(id.as_deref())?;
        let name = checked_text(name, 80, "INVALID_GROUP", "Group name cannot be empty")?;
        let existing = id
            .as_deref()
            .and_then(|id| self.data.groups.iter().find(|group| group.id == id));
        let group = Group {
            id: id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            name,
            sort_order: existing.map_or(self.data.groups.len(), |group| group.sort_order),
        };
        if let Some(index) = self.data.groups.iter().position(|item| item.id == group.id) {
            self.data.groups[index] = group.clone();
        } else {
            self.data.groups.push(group.clone());
        }
        self.persist()?;
        Ok(group)
    }

    pub fn reorder_groups(&mut self, ids: Vec<String>) -> AppResult<Vec<Group>> {
        if ids.len() != self.data.groups.len() {
            return Err(AppError::new("INVALID_ORDER", "Group order is incomplete"));
        }
        let mut ordered = Vec::with_capacity(ids.len());
        for (sort_order, id) in ids.into_iter().enumerate() {
            if ordered.iter().any(|item: &Group| item.id == id) {
                return Err(AppError::new(
                    "INVALID_ORDER",
                    "Group order contains duplicates",
                ));
            }
            let mut item = self
                .data
                .groups
                .iter()
                .find(|item| item.id == id)
                .cloned()
                .ok_or_else(|| AppError::new("INVALID_ORDER", "Group order is invalid"))?;
            item.sort_order = sort_order;
            ordered.push(item);
        }
        self.data.groups = ordered;
        self.persist()?;
        Ok(self.list().1)
    }

    pub fn delete_group(&mut self, id: &str) -> AppResult<()> {
        let index = self
            .data
            .groups
            .iter()
            .position(|item| item.id == id)
            .ok_or_else(|| AppError::new("GROUP_NOT_FOUND", "Group not found"))?;
        self.data.groups.remove(index);
        self.data
            .connections
            .iter_mut()
            .filter(|item| item.group_id.as_deref() == Some(id))
            .for_each(|item| item.group_id = None);
        self.persist()
    }

    fn persist(&self) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let mut file = fs::File::create(&temporary).map_err(storage_error)?;
        file.write_all(&serde_json::to_vec_pretty(&self.data).map_err(storage_error)?)
            .map_err(storage_error)?;
        file.sync_all().map_err(storage_error)?;
        fs::rename(temporary, &self.path).map_err(storage_error)
    }
}

fn checked_text(value: String, limit: usize, code: &str, message: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > limit || value.contains('\0') {
        return Err(AppError::new(code, message));
    }
    Ok(value.into())
}

fn optional_text(value: Option<String>, limit: usize, label: &str) -> AppResult<Option<String>> {
    match value {
        Some(value) if value.len() > limit || value.contains('\0') => Err(AppError::new(
            "INVALID_CONNECTION_METADATA",
            format!("Invalid {label}"),
        )),
        Some(value) if !value.is_empty() => Ok(Some(value)),
        _ => Ok(None),
    }
}

fn validate_id(id: Option<&str>) -> AppResult<()> {
    if id.is_some_and(|id| id.is_empty() || id.len() > 100) {
        return Err(AppError::new(
            "INVALID_CONNECTION_ID",
            "Identifier is invalid",
        ));
    }
    Ok(())
}

fn validate_setting_key(key: &str) -> AppResult<()> {
    const KEYS: [&str; 5] = [
        "remotehub.theme",
        "remotehub.locale",
        "remotehub.workspace",
        "remotehub.sftpOpen",
        "remotehub.sftpPosition",
    ];
    if !KEYS.contains(&key) {
        return Err(AppError::new("INVALID_SETTING", "Setting key is invalid"));
    }
    Ok(())
}

fn valid_fingerprint(value: &str) -> bool {
    value.strip_prefix("SHA256:").is_some_and(|value| {
        value.len() == 43
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
    })
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("STORAGE_FAILED", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ConnectionInput {
        ConnectionInput {
            id: None,
            name: "Server".into(),
            notes: None,
            color: None,
            kind: "ssh".into(),
            host: "example.com".into(),
            port: 22,
            username: Some("root".into()),
            auth_type: Some("password".into()),
            database_type: None,
            database: None,
            database_ssl_mode: None,
            ssh_tunnel_id: None,
            group_id: None,
            favorite: None,
            sort_order: None,
        }
    }

    #[test]
    fn preserves_host_key_only_for_the_same_endpoint() {
        let path = std::env::temp_dir().join(format!("remotehub-store-{}.json", Uuid::new_v4()));
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let connection = store
            .build_connection(input(), Some("secret".into()), false)
            .unwrap();
        let id = connection.id.clone();
        store.save(connection).unwrap();
        store
            .trust_host_key(&id, "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
            .unwrap();
        let mut changed = input();
        changed.id = Some(id);
        changed.host = "other.example.com".into();
        assert!(store
            .build_connection(changed, Some("secret".into()), false)
            .unwrap()
            .host_key_fingerprint
            .is_none());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn persists_only_supported_settings() {
        let path = std::env::temp_dir().join(format!("remotehub-settings-{}.json", Uuid::new_v4()));
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        store
            .set_setting("remotehub.theme".into(), "dark".into())
            .unwrap();
        assert!(store
            .set_setting("remotehub.secret".into(), "nope".into())
            .is_err());
        assert_eq!(
            ConnectionStore::load(path.clone())
                .unwrap()
                .setting("remotehub.theme")
                .unwrap()
                .as_deref(),
            Some("dark")
        );
        let _ = fs::remove_file(path);
    }
}
