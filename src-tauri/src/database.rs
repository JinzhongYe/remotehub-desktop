use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlConnection, MySqlRow, MySqlSslMode},
    postgres::{PgConnectOptions, PgConnection, PgRow, PgSslMode},
    Column, Connection as _, Executor, Row, TypeInfo, ValueRef,
};
use tauri::{AppHandle, Emitter};
use tokio::{sync::Mutex, time::timeout};
use uuid::Uuid;

use crate::model::{AppError, AppResult, Connection, SessionStatusEvent};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_SQL_BYTES: usize = 1024 * 1024;
const MAX_PAGE_SIZE: u32 = 500;
const JS_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

enum Backend {
    Postgres(PgConnection),
    MySql(MySqlConnection),
}

struct Session {
    connection: Connection,
    password: String,
    database: Option<String>,
    backend: Backend,
    manual_transaction: bool,
}

#[derive(Clone)]
pub struct DatabaseManager {
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    sql: String,
    page: Option<u32>,
    page_size: Option<u32>,
    // Native pagination already executes a fresh query on every request.
    #[serde(rename = "restart")]
    _restart: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangesRequest {
    database: String,
    table: String,
    statements: Vec<String>,
}

impl ChangesRequest {
    fn validate(&self) -> AppResult<()> {
        validate_identifier(&self.database, "database")?;
        validate_identifier(&self.table, "table")?;
        if self.statements.is_empty()
            || self.statements.len() > 5000
            || self.statements.iter().map(|sql| sql.len()).sum::<usize>() > MAX_SQL_BYTES
            || self.statements.iter().any(|sql| {
                !matches!(
                    database_statement(sql).as_str(),
                    "INSERT" | "UPDATE" | "DELETE"
                )
            })
        {
            return Err(AppError::new(
                "DATABASE_CHANGES_INVALID",
                "Table changes must contain INSERT, UPDATE or DELETE statements, up to 1 MB",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    session_id: String,
    adapter: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    database: Option<String>,
    server_version: String,
}

#[derive(Debug, Serialize)]
pub struct Catalog {
    name: String,
    system: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    database: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimated_rows: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseColumn {
    database: String,
    table: String,
    name: String,
    ordinal: i32,
    data_type: String,
    column_type: String,
    nullable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<String>,
    default_value: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    extra: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    length: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scale: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
}

#[derive(Debug, Serialize)]
struct ResultColumn {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated: Option<bool>,
    kind: String,
    columns: Vec<ResultColumn>,
    rows: Vec<Vec<Value>>,
    page: u32,
    page_size: u32,
    has_more: bool,
    affected_rows: u64,
    changed_rows: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    insert_id: Option<String>,
    warning_status: u16,
    duration_ms: u128,
    statement: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetails {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    notice: Option<String>,
}

#[derive(Deserialize)]
struct SchemaQuery {
    columns: Vec<String>,
    sql: String,
    parameters: Option<bool>,
    notice: Option<String>,
}

fn schema_query(
    adapter: &str,
    database: &str,
    table: &str,
    section: &str,
) -> AppResult<SchemaQuery> {
    validate_identifier(database, "database")?;
    validate_identifier(table, "table")?;
    let queries: Value = serde_json::from_str(include_str!(
        "../../src/shared/database-schema-queries.json"
    ))
    .map_err(|error| AppError::new("DATABASE_SCHEMA_INVALID", error.to_string()))?;
    let mut query: SchemaQuery = serde_json::from_value(queries[adapter][section].clone())
        .map_err(|_| AppError::new("DATABASE_SCHEMA_SECTION_INVALID", "Invalid schema section"))?;
    // Interpolate only the original template, never placeholders inside user identifiers.
    let mut parts = query.sql.split("{{");
    let mut sql = parts.next().unwrap_or_default().to_string();
    for part in parts {
        let (name, rest) = part
            .split_once("}}")
            .ok_or_else(|| AppError::new("DATABASE_SCHEMA_INVALID", "Invalid schema query"))?;
        let identifier = match name {
            "database" => database,
            "table" => table,
            _ => {
                return Err(AppError::new(
                    "DATABASE_SCHEMA_INVALID",
                    "Invalid schema query",
                ))
            }
        };
        sql.push_str(&format!("`{}`", identifier.replace('`', "``")));
        sql.push_str(rest);
    }
    query.sql = sql;
    Ok(query)
}

impl DatabaseManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            sessions: Default::default(),
        }
    }

    pub async fn connect(
        &self,
        connection: Connection,
        password: String,
    ) -> AppResult<ConnectResult> {
        let (backend, database, server_version) =
            open(&connection, &password, connection.database.as_deref()).await?;
        let adapter = connection.database_type.clone().unwrap_or_default();
        let session_id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            session_id.clone(),
            Arc::new(Mutex::new(Session {
                connection,
                password,
                database: database.clone(),
                backend,
                manual_transaction: false,
            })),
        );
        self.emit_status(&session_id, "connected", None);
        Ok(ConnectResult {
            session_id,
            adapter,
            database,
            server_version,
        })
    }

    pub async fn test(&self, connection: &Connection, password: &str) -> AppResult<()> {
        let (backend, _, _) = open(connection, password, connection.database.as_deref()).await?;
        close_backend(backend).await;
        Ok(())
    }

    pub async fn list_databases(&self, session_id: &str) -> AppResult<Vec<Catalog>> {
        let session = self.session(session_id).await?;
        let mut session = session.try_lock().map_err(|_| busy())?;
        match &mut session.backend {
            Backend::Postgres(connection) => {
                let rows = query_timeout(sqlx::query_as::<_, (String,)>("SELECT datname FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname").fetch_all(connection)).await?;
                Ok(rows
                    .into_iter()
                    .map(|(name,)| Catalog {
                        system: is_postgres_system_database(&name),
                        name,
                    })
                    .collect())
            }
            Backend::MySql(connection) => {
                let rows = query_timeout(
                    sqlx::query_as::<_, (String,)>("SHOW DATABASES").fetch_all(connection),
                )
                .await?;
                Ok(rows
                    .into_iter()
                    .map(|(name,)| Catalog {
                        system: matches!(
                            name.to_ascii_lowercase().as_str(),
                            "information_schema" | "mysql" | "performance_schema" | "sys"
                        ),
                        name,
                    })
                    .collect())
            }
        }
    }

    pub async fn use_database(&self, session_id: &str, database: String) -> AppResult<String> {
        validate_identifier(&database, "database")?;
        let session = self.session(session_id).await?;
        let mut session = session.try_lock().map_err(|_| busy())?;
        if session.database.as_deref() == Some(&database) {
            return Ok(database);
        }
        let (backend, active, _) =
            open(&session.connection, &session.password, Some(&database)).await?;
        let previous = std::mem::replace(&mut session.backend, backend);
        session.database = active.clone();
        close_backend(previous).await;
        Ok(active.unwrap_or(database))
    }

    pub async fn list_tables(&self, session_id: &str, database: String) -> AppResult<Vec<Table>> {
        validate_identifier(&database, "database")?;
        let session = self.session(session_id).await?;
        let mut session = session.try_lock().map_err(|_| busy())?;
        match &mut session.backend {
            Backend::Postgres(connection) => {
                let rows = query_timeout(sqlx::query_as::<_, (String, String, String, i64)>(
                    "SELECT n.nspname, c.relname, c.relkind::text, c.reltuples::bigint FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r', 'p', 'v', 'm') ORDER BY n.nspname, c.relkind, c.relname"
                ).fetch_all(connection)).await?;
                Ok(rows
                    .into_iter()
                    .map(|(schema, name, kind, estimated)| Table {
                        database: schema,
                        name,
                        kind: if kind == "v" || kind == "m" {
                            "view".into()
                        } else {
                            "table".into()
                        },
                        estimated_rows: (estimated >= 0).then_some(estimated),
                    })
                    .collect())
            }
            Backend::MySql(connection) => {
                let rows = query_timeout(sqlx::query_as::<_, (String, String, Option<u64>)>(
                    "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME"
                ).bind(&database).fetch_all(connection)).await?;
                Ok(rows
                    .into_iter()
                    .map(|(name, kind, estimated)| Table {
                        database: database.clone(),
                        name,
                        kind: if kind.eq_ignore_ascii_case("VIEW") {
                            "view".into()
                        } else {
                            "table".into()
                        },
                        estimated_rows: estimated.and_then(|value| i64::try_from(value).ok()),
                    })
                    .collect())
            }
        }
    }

    pub async fn list_columns(
        &self,
        session_id: &str,
        database: String,
        table: String,
    ) -> AppResult<Vec<DatabaseColumn>> {
        validate_identifier(&database, "database")?;
        validate_identifier(&table, "table")?;
        let session = self.session(session_id).await?;
        let mut session = session.try_lock().map_err(|_| busy())?;
        match &mut session.backend {
            Backend::Postgres(connection) => {
                type Row = (
                    String,
                    i32,
                    String,
                    String,
                    String,
                    Option<String>,
                    bool,
                    Option<i32>,
                    Option<i32>,
                    Option<String>,
                );
                let rows = query_timeout(sqlx::query_as::<_, Row>(
                    "SELECT c.column_name, c.ordinal_position, c.data_type, COALESCE(c.domain_name, c.udt_name), c.is_nullable, c.column_default, EXISTS (SELECT 1 FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace JOIN pg_catalog.pg_index i ON i.indrelid = t.oid AND i.indisprimary WHERE n.nspname = c.table_schema AND t.relname = c.table_name AND c.ordinal_position = ANY(i.indkey)), c.character_maximum_length, c.numeric_scale, pg_catalog.col_description(format('%I.%I', c.table_schema, c.table_name)::regclass::oid, c.ordinal_position) FROM information_schema.columns c WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position"
                ).bind(&database).bind(&table).fetch_all(connection)).await?;
                Ok(rows
                    .into_iter()
                    .map(
                        |(
                            name,
                            ordinal,
                            data_type,
                            column_type,
                            nullable,
                            default_value,
                            primary,
                            length,
                            scale,
                            comment,
                        )| DatabaseColumn {
                            database: database.clone(),
                            table: table.clone(),
                            name,
                            ordinal,
                            data_type,
                            column_type,
                            nullable: nullable == "YES",
                            key: primary.then(|| "PRI".into()),
                            extra: default_value
                                .as_deref()
                                .filter(|value| value.starts_with("nextval("))
                                .map(|_| "auto increment".into()),
                            default_value: default_value.map(Value::String).unwrap_or(Value::Null),
                            length: length.map(i64::from),
                            scale: scale.map(i64::from),
                            comment,
                        },
                    )
                    .collect())
            }
            Backend::MySql(connection) => {
                type Row = (
                    String,
                    u32,
                    String,
                    String,
                    String,
                    String,
                    Option<String>,
                    String,
                    Option<u64>,
                    Option<u64>,
                    String,
                );
                let rows = query_timeout(sqlx::query_as::<_, Row>(
                    "SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH, NUMERIC_SCALE, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION"
                ).bind(&database).bind(&table).fetch_all(connection)).await?;
                Ok(rows
                    .into_iter()
                    .map(
                        |(
                            name,
                            ordinal,
                            data_type,
                            column_type,
                            nullable,
                            key,
                            default_value,
                            extra,
                            length,
                            scale,
                            comment,
                        )| DatabaseColumn {
                            database: database.clone(),
                            table: table.clone(),
                            name,
                            ordinal: ordinal as i32,
                            data_type,
                            column_type,
                            nullable: nullable == "YES",
                            key: (!key.is_empty()).then_some(key),
                            default_value: default_value.map(Value::String).unwrap_or(Value::Null),
                            extra: (!extra.is_empty()).then_some(extra),
                            length: length.and_then(|value| i64::try_from(value).ok()),
                            scale: scale.and_then(|value| i64::try_from(value).ok()),
                            comment: (!comment.is_empty()).then_some(comment),
                        },
                    )
                    .collect())
            }
        }
    }

    pub async fn list_table_details(
        &self,
        session_id: &str,
        database: String,
        table: String,
        section: String,
    ) -> AppResult<TableDetails> {
        let session = self.session(session_id).await?;
        let mut session = session.try_lock().map_err(|_| busy())?;
        let adapter = match &session.backend {
            Backend::Postgres(_) => "postgres",
            Backend::MySql(_) => "mysql",
        };
        let query = schema_query(adapter, &database, &table, &section)?;
        let rows = match &mut session.backend {
            Backend::Postgres(connection) => {
                let rows = query_timeout(
                    sqlx::query(&query.sql)
                        .bind(&database)
                        .bind(&table)
                        .fetch_all(connection),
                )
                .await?;
                rows.iter().map(pg_row).collect::<Vec<_>>()
            }
            Backend::MySql(connection) => {
                let mut statement = sqlx::query(&query.sql);
                if query.parameters != Some(false) {
                    statement = statement.bind(&database).bind(&table);
                }
                let rows = query_timeout(statement.fetch_all(connection)).await?;
                rows.iter().map(mysql_row).collect::<Vec<_>>()
            }
        };
        Ok(TableDetails {
            has_more: rows.len() > 5000,
            rows: rows
                .into_iter()
                .take(5000)
                .map(|row| row.into_iter().take(query.columns.len()).collect())
                .collect(),
            columns: query.columns,
            notice: query.notice,
        })
    }

    pub async fn query(&self, session_id: &str, request: QueryRequest) -> AppResult<QueryResult> {
        let (sql, page, page_size) = normalize_request(request)?;
        let statement = database_statement(&sql);
        let control = statement.clone();
        let pageable = statement == "SELECT" || statement == "WITH";
        let executable = if pageable {
            paged_query(&sql, page, page_size)
        } else {
            strip_semicolon(&sql).into()
        };
        let started = Instant::now();
        let session = self.session(session_id).await?;
        let mut session = session.try_lock().map_err(|_| busy())?;
        let result = match &mut session.backend {
            Backend::Postgres(connection) if pageable => {
                let describe = query_timeout(connection.describe(&executable)).await?;
                let columns = result_columns(describe.columns());
                let mut rows =
                    query_timeout(sqlx::query(&executable).fetch_all(connection)).await?;
                let has_more = rows.len() > page_size as usize;
                if has_more {
                    rows.pop();
                }
                Ok(rows_result(
                    columns,
                    rows.iter().map(pg_row).collect(),
                    page,
                    page_size,
                    has_more,
                    statement,
                    started,
                ))
            }
            Backend::MySql(connection) if pageable => {
                let describe = query_timeout(connection.describe(&executable)).await?;
                let columns = result_columns(describe.columns());
                let mut rows =
                    query_timeout(sqlx::query(&executable).fetch_all(connection)).await?;
                let has_more = rows.len() > page_size as usize;
                if has_more {
                    rows.pop();
                }
                Ok(rows_result(
                    columns,
                    rows.iter().map(mysql_row).collect(),
                    page,
                    page_size,
                    has_more,
                    statement,
                    started,
                ))
            }
            Backend::Postgres(connection) => {
                let describe = query_timeout(connection.describe(&executable)).await?;
                let columns = result_columns(describe.columns());
                if !columns.is_empty() {
                    let (rows, truncated) = query_timeout(async {
                        let mut stream = sqlx::query(&executable).fetch(&mut *connection);
                        let mut rows = Vec::new();
                        let mut truncated = false;
                        while let Some(row) = stream.try_next().await? {
                            if rows.len() < MAX_PAGE_SIZE as usize { rows.push(pg_row(&row)); }
                            else { truncated = true; }
                        }
                        Ok((rows, truncated))
                    }).await?;
                    let mut result = rows_result(columns, rows, 0, page_size, false, statement, started);
                    result.truncated = truncated.then_some(true);
                    return Ok(result);
                }
                let result = query_timeout(sqlx::query(&executable).execute(connection)).await?;
                Ok(mutation_result(
                    result.rows_affected(),
                    None,
                    page_size,
                    statement,
                    started,
                ))
            }
            Backend::MySql(connection) => {
                let describe = query_timeout(connection.describe(&executable)).await?;
                let columns = result_columns(describe.columns());
                if !columns.is_empty() {
                    let (rows, truncated) = query_timeout(async {
                        let mut stream = sqlx::query(&executable).fetch(&mut *connection);
                        let mut rows = Vec::new();
                        let mut truncated = false;
                        while let Some(row) = stream.try_next().await? {
                            if rows.len() < MAX_PAGE_SIZE as usize { rows.push(mysql_row(&row)); }
                            else { truncated = true; }
                        }
                        Ok((rows, truncated))
                    }).await?;
                    let mut result = rows_result(columns, rows, 0, page_size, false, statement, started);
                    result.truncated = truncated.then_some(true);
                    return Ok(result);
                }
                let result = query_timeout(sqlx::query(&executable).execute(connection)).await?;
                Ok(mutation_result(
                    result.rows_affected(),
                    Some(result.last_insert_id().to_string()),
                    page_size,
                    statement,
                    started,
                ))
            }
        };
        if result.is_ok() {
            if control == "BEGIN" || control == "START" {
                session.manual_transaction = true;
            } else if (control == "COMMIT" || control == "ROLLBACK")
                && !sql.to_uppercase().contains(" TO ")
            {
                session.manual_transaction = sql.to_uppercase().contains("AND CHAIN");
            }
        }
        result
    }

    pub async fn apply_changes(&self, session_id: &str, request: ChangesRequest) -> AppResult<()> {
        request.validate()?;
        let session_handle = self.session(session_id).await?;
        let mut session = session_handle.try_lock().map_err(|_| busy())?;
        if session.manual_transaction {
            return Err(AppError::new(
                "DATABASE_TRANSACTION_ACTIVE",
                "Commit or roll back the SQL editor transaction before saving table changes",
            ));
        }
        let result = match &mut session.backend {
            Backend::Postgres(connection) => {
                let mut transaction = query_timeout(connection.begin()).await?;
                let mut result = Ok(());
                for sql in &request.statements {
                    if let Err(error) =
                        query_timeout(sqlx::query(sql).execute(&mut *transaction)).await
                    {
                        result = Err(error);
                        break;
                    }
                }
                match result {
                    Ok(()) => query_timeout(transaction.commit()).await.map_err(|_| {
                        AppError::new(
                            "DATABASE_TRANSACTION_COMMIT_FAILED",
                            "Commit failed; check the saved data before reconnecting and retrying",
                        )
                    }),
                    Err(error) => match query_timeout(transaction.rollback()).await {
                        Ok(()) => Err(error),
                        Err(_) => Err(AppError::new(
                            "DATABASE_TRANSACTION_ROLLBACK_FAILED",
                            "Rollback failed; reconnect before making more changes",
                        )),
                    },
                }
            }
            Backend::MySql(connection) => {
                let (auto_commit,): (i64,) = query_timeout(
                    sqlx::query_as("SELECT @@autocommit").fetch_one(&mut *connection),
                )
                .await?;
                if auto_commit == 0 {
                    return Err(AppError::new(
                        "DATABASE_TRANSACTION_ACTIVE",
                        "Enable autocommit before saving table changes",
                    ));
                }
                let engine: Option<(String,)> = query_timeout(sqlx::query_as("SELECT e.TRANSACTIONS FROM information_schema.TABLES t JOIN information_schema.ENGINES e ON e.ENGINE = t.ENGINE WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?")
                    .bind(&request.database).bind(&request.table).fetch_optional(&mut *connection)).await?;
                if engine.as_ref().map(|row| row.0.as_str()) != Some("YES") {
                    return Err(AppError::new(
                        "DATABASE_TRANSACTION_UNAVAILABLE",
                        "This table does not support transactions; use the SQL editor to change it",
                    ));
                }
                let mut transaction = query_timeout(connection.begin()).await?;
                let mut result = Ok(());
                for sql in &request.statements {
                    if let Err(error) =
                        query_timeout(sqlx::query(sql).execute(&mut *transaction)).await
                    {
                        result = Err(error);
                        break;
                    }
                }
                match result {
                    Ok(()) => query_timeout(transaction.commit()).await.map_err(|_| {
                        AppError::new(
                            "DATABASE_TRANSACTION_COMMIT_FAILED",
                            "Commit failed; check the saved data before reconnecting and retrying",
                        )
                    }),
                    Err(error) => match query_timeout(transaction.rollback()).await {
                        Ok(()) => Err(error),
                        Err(_) => Err(AppError::new(
                            "DATABASE_TRANSACTION_ROLLBACK_FAILED",
                            "Rollback failed; reconnect before making more changes",
                        )),
                    },
                }
            }
        };
        if result.as_ref().is_err_and(|error| {
            matches!(
                error.code.as_str(),
                "DATABASE_TRANSACTION_ROLLBACK_FAILED" | "DATABASE_TRANSACTION_COMMIT_FAILED"
            )
        }) {
            drop(session);
            drop(session_handle);
            self.disconnect(session_id).await;
        }
        result
    }

    pub async fn disconnect(&self, session_id: &str) {
        let session = self.sessions.lock().await.remove(session_id);
        if let Some(session) = session {
            let session = Arc::try_unwrap(session).ok().map(Mutex::into_inner);
            if let Some(session) = session {
                close_backend(session.backend).await;
            }
            self.emit_status(session_id, "closed", None);
        }
    }

    async fn session(&self, session_id: &str) -> AppResult<Arc<Mutex<Session>>> {
        if session_id.is_empty() || session_id.len() > 100 {
            return Err(AppError::new(
                "DATABASE_SESSION_INVALID",
                "Database session identifier is invalid",
            ));
        }
        self.sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| {
                AppError::new(
                    "DATABASE_SESSION_NOT_FOUND",
                    "Database session is closed or missing",
                )
            })
    }

    fn emit_status(&self, session_id: &str, status: &str, message: Option<String>) {
        let _ = self.app.emit(
            "database:status",
            SessionStatusEvent {
                session_id: session_id.into(),
                status: status.into(),
                message,
            },
        );
    }
}

async fn open(
    connection: &Connection,
    password: &str,
    database: Option<&str>,
) -> AppResult<(Backend, Option<String>, String)> {
    let username = connection
        .username
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "DATABASE_USERNAME_REQUIRED",
                "Database username is required",
            )
        })?;
    match connection.database_type.as_deref() {
        Some("postgres") => {
            let database = database.unwrap_or(username);
            let ssl_mode = match connection.database_ssl_mode.as_deref().unwrap_or("disable") {
                "disable" => PgSslMode::Disable,
                "require" => PgSslMode::Require,
                "verify-full" => PgSslMode::VerifyFull,
                _ => {
                    return Err(AppError::new(
                        "DATABASE_SSL_INVALID",
                        "PostgreSQL SSL mode is invalid",
                    ))
                }
            };
            let options = PgConnectOptions::new()
                .host(&connection.host)
                .port(connection.port)
                .username(username)
                .password(password)
                .database(database)
                .application_name("RemoteHub")
                .ssl_mode(ssl_mode);
            let mut client = connect_timeout(PgConnection::connect_with(&options)).await?;
            let (version, active): (String, String) = query_timeout(
                sqlx::query_as("SELECT version(), current_database()").fetch_one(&mut client),
            )
            .await?;
            Ok((Backend::Postgres(client), Some(active), version))
        }
        Some("mysql") => {
            let mut options = MySqlConnectOptions::new()
                .host(&connection.host)
                .port(connection.port)
                .username(username)
                .password(password)
                .ssl_mode(match connection.database_ssl_mode.as_deref().unwrap_or("require") {
                    "disable" => MySqlSslMode::Disabled,
                    "require" => MySqlSslMode::Required,
                    "verify-full" => MySqlSslMode::VerifyIdentity,
                    _ => return Err(AppError::new("DATABASE_SSL_INVALID", "MySQL SSL mode is invalid")),
                })
                .charset("utf8mb4");
            if let Some(database) = database {
                options = options.database(database);
            }
            let mut client = connect_timeout(MySqlConnection::connect_with(&options)).await?;
            let (version, active): (String, Option<String>) = query_timeout(
                sqlx::query_as("SELECT VERSION(), DATABASE()").fetch_one(&mut client),
            )
            .await?;
            Ok((Backend::MySql(client), active, version))
        }
        _ => Err(AppError::new(
            "DATABASE_ADAPTER_UNAVAILABLE",
            "Android currently supports PostgreSQL and MySQL",
        )),
    }
}

async fn close_backend(backend: Backend) {
    match backend {
        Backend::Postgres(connection) => {
            let _ = connection.close().await;
        }
        Backend::MySql(connection) => {
            let _ = connection.close().await;
        }
    }
}

async fn connect_timeout<T>(
    future: impl std::future::Future<Output = Result<T, sqlx::Error>>,
) -> AppResult<T> {
    timeout(CONNECT_TIMEOUT, future)
        .await
        .map_err(|_| AppError::new("DATABASE_TIMEOUT", "Database connection timed out"))?
        .map_err(database_error)
}

async fn query_timeout<T>(
    future: impl std::future::Future<Output = Result<T, sqlx::Error>>,
) -> AppResult<T> {
    timeout(QUERY_TIMEOUT, future)
        .await
        .map_err(|_| AppError::new("DATABASE_TIMEOUT", "Database query timed out"))?
        .map_err(database_error)
}

fn normalize_request(request: QueryRequest) -> AppResult<(String, u32, u32)> {
    let sql = request.sql.trim().to_string();
    let page = request.page.unwrap_or(0);
    let page_size = request.page_size.unwrap_or(200);
    if sql.is_empty() || sql.len() > MAX_SQL_BYTES {
        return Err(AppError::new(
            "DATABASE_QUERY_INVALID",
            "SQL must contain between 1 byte and 1 MB",
        ));
    }
    if page > 1_000_000 || page_size == 0 || page_size > MAX_PAGE_SIZE {
        return Err(AppError::new(
            "DATABASE_PAGE_INVALID",
            "Query page is invalid",
        ));
    }
    Ok((sql, page, page_size))
}

fn database_statement(sql: &str) -> String {
    let mut source = sql.trim_start_matches('\u{feff}').trim_start();
    loop {
        if source.starts_with("--") || source.starts_with('#') {
            source = source
                .find('\n')
                .map_or("", |index| &source[index + 1..])
                .trim_start();
        } else if source.starts_with("/*") {
            source = source
                .find("*/")
                .map_or("", |index| &source[index + 2..])
                .trim_start();
        } else {
            break;
        }
    }
    source
        .chars()
        .take_while(|char| char.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase()
}

fn strip_semicolon(sql: &str) -> &str {
    sql.trim().trim_end_matches(';').trim_end()
}

fn paged_query(sql: &str, page: u32, page_size: u32) -> String {
    format!(
        "SELECT * FROM ({}) AS __remotehub_page LIMIT {} OFFSET {}",
        strip_semicolon(sql),
        page_size + 1,
        u64::from(page) * u64::from(page_size)
    )
}

fn result_columns<C: Column>(columns: &[C]) -> Vec<ResultColumn> {
    columns
        .iter()
        .map(|column| ResultColumn {
            name: column.name().into(),
            kind: column.type_info().name().into(),
        })
        .collect()
}

fn pg_row(row: &PgRow) -> Vec<Value> {
    (0..row.len()).map(|index| pg_value(row, index)).collect()
}
fn mysql_row(row: &MySqlRow) -> Vec<Value> {
    (0..row.len())
        .map(|index| mysql_value(row, index))
        .collect()
}

fn pg_value(row: &PgRow, index: usize) -> Value {
    if row.try_get_raw(index).map_or(true, |value| value.is_null()) {
        return Value::Null;
    }
    if let Ok(value) = row.try_get::<bool, _>(index) {
        return json!(value);
    }
    value_candidates!(row, index)
}

fn mysql_value(row: &MySqlRow, index: usize) -> Value {
    if row.try_get_raw(index).map_or(true, |value| value.is_null()) {
        return Value::Null;
    }
    if let Ok(value) = row.try_get::<u64, _>(index) {
        return safe_u64(value);
    }
    if let Ok(value) = row.try_get::<i64, _>(index) {
        return safe_i64(value);
    }
    value_candidates!(row, index)
}

macro_rules! value_candidates {
    ($row:expr, $index:expr) => {{
        if let Ok(value) = $row.try_get::<i16, _>($index) {
            json!(value)
        } else if let Ok(value) = $row.try_get::<i32, _>($index) {
            json!(value)
        } else if let Ok(value) = $row.try_get::<i64, _>($index) {
            safe_i64(value)
        } else if let Ok(value) = $row.try_get::<f32, _>($index) {
            finite_number(f64::from(value))
        } else if let Ok(value) = $row.try_get::<f64, _>($index) {
            finite_number(value)
        } else if let Ok(value) = $row.try_get::<String, _>($index) {
            Value::String(value)
        } else if let Ok(value) = $row.try_get::<sqlx::types::BigDecimal, _>($index) {
            Value::String(value.to_string())
        } else if let Ok(value) = $row.try_get::<sqlx::types::chrono::NaiveDate, _>($index) {
            Value::String(value.to_string())
        } else if let Ok(value) = $row.try_get::<sqlx::types::chrono::NaiveTime, _>($index) {
            Value::String(value.to_string())
        } else if let Ok(value) = $row.try_get::<sqlx::types::chrono::NaiveDateTime, _>($index) {
            Value::String(value.to_string())
        } else if let Ok(value) =
            $row.try_get::<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>, _>($index)
        {
            Value::String(value.to_rfc3339())
        } else if let Ok(value) = $row.try_get::<sqlx::types::Uuid, _>($index) {
            Value::String(value.to_string())
        } else if let Ok(value) = $row.try_get::<sqlx::types::Json<Value>, _>($index) {
            Value::String(value.0.to_string())
        } else if let Ok(value) = $row.try_get::<Vec<u8>, _>($index) {
            Value::String(binary_preview(&value))
        } else {
            Value::String(format!(
                "<unsupported {}>",
                $row.columns()[$index].type_info().name()
            ))
        }
    }};
}
use value_candidates;

fn safe_i64(value: i64) -> Value {
    if value.unsigned_abs() <= JS_SAFE_INTEGER as u64 {
        json!(value)
    } else {
        Value::String(value.to_string())
    }
}
fn safe_u64(value: u64) -> Value {
    if value <= JS_SAFE_INTEGER as u64 {
        json!(value)
    } else {
        Value::String(value.to_string())
    }
}
fn finite_number(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}
fn binary_preview(value: &[u8]) -> String {
    let preview = value
        .iter()
        .take(24)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!(
        "<binary {} bytes: {}{}>",
        value.len(),
        preview,
        if value.len() > 24 { "…" } else { "" }
    )
}

fn rows_result(
    columns: Vec<ResultColumn>,
    rows: Vec<Vec<Value>>,
    page: u32,
    page_size: u32,
    has_more: bool,
    statement: String,
    started: Instant,
) -> QueryResult {
    QueryResult {
        truncated: None,
        kind: "rows".into(),
        columns,
        rows,
        page,
        page_size,
        has_more,
        affected_rows: 0,
        changed_rows: 0,
        insert_id: None,
        warning_status: 0,
        duration_ms: started.elapsed().as_millis(),
        statement,
    }
}

fn mutation_result(
    affected: u64,
    insert_id: Option<String>,
    page_size: u32,
    statement: String,
    started: Instant,
) -> QueryResult {
    QueryResult {
        truncated: None,
        kind: "mutation".into(),
        columns: vec![],
        rows: vec![],
        page: 0,
        page_size,
        has_more: false,
        affected_rows: affected,
        changed_rows: affected,
        insert_id: insert_id.filter(|value| value != "0"),
        warning_status: 0,
        duration_ms: started.elapsed().as_millis(),
        statement,
    }
}

fn validate_identifier(value: &str, label: &str) -> AppResult<()> {
    if value.is_empty() || value.len() > 200 || value.contains(['\0', '\r', '\n']) {
        Err(AppError::new(
            "DATABASE_IDENTIFIER_INVALID",
            format!("Invalid {label} name"),
        ))
    } else {
        Ok(())
    }
}

fn busy() -> AppError {
    AppError::new(
        "DATABASE_BUSY",
        "Another database operation is still running in this workspace",
    )
}

fn is_postgres_system_database(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "postgres" | "rdsadmin" | "azure_maintenance"
    ) || name.to_ascii_lowercase().starts_with("template")
}

fn database_error(error: sqlx::Error) -> AppError {
    if matches!(&error, sqlx::Error::Io(_) | sqlx::Error::Protocol(_) | sqlx::Error::WorkerCrashed) {
        return AppError::new("DATABASE_CONNECTION_LOST", error.to_string());
    }
    if let sqlx::Error::Database(source) = &error {
        let code = source.code().unwrap_or_default();
        if matches!(code.as_ref(), "28P01" | "1045") {
            return AppError::new("DATABASE_AUTH_FAILED", "Database authentication failed");
        }
        if matches!(code.as_ref(), "3D000" | "1049") {
            return AppError::new("DATABASE_NOT_FOUND", source.message());
        }
    }
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    let code = if lower.contains("connection refused") {
        "DATABASE_CONNECTION_REFUSED"
    } else if lower.contains("dns")
        || lower.contains("lookup address")
        || lower.contains("failed to lookup")
    {
        "DATABASE_HOST_NOT_FOUND"
    } else {
        "DATABASE_FAILED"
    };
    AppError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_queries_are_scoped_read_only_and_quote_identifiers_once() {
        for adapter in ["mysql", "postgres"] {
            for section in ["indexes", "foreignKeys", "checks", "triggers", "advanced"] {
                let query = schema_query(adapter, "app", "a'b", section).unwrap();
                assert!(!query.columns.is_empty());
                assert!(
                    query.sql.starts_with("SELECT ") || query.sql.starts_with("SHOW CREATE TABLE ")
                );
                if query.parameters != Some(false) {
                    assert!(!query.sql.contains("a'b"));
                }
            }
            assert!(schema_query(adapter, "app", "cells", "fields").is_err());
            assert!(schema_query(adapter, "app", "cells\0", "indexes").is_err());
        }
        let query = schema_query("mysql", "a`{{table}}$&", "b`c", "advanced").unwrap();
        assert_eq!(query.sql, "SHOW CREATE TABLE `a``{{table}}$&`.`b``c`");
        assert_eq!(query.parameters, Some(false));
    }

    #[test]
    fn validates_bounded_table_changes() {
        let mut request = ChangesRequest {
            database: "app".into(),
            table: "cells".into(),
            statements: vec![
                "INSERT INTO cells VALUES (1)".into(),
                "UPDATE cells SET id = 2".into(),
            ],
        };
        assert!(request.validate().is_ok());
        request.statements = vec!["COMMIT".into()];
        assert!(request.validate().is_err());
        request.statements.clear();
        assert!(request.validate().is_err());
        request.statements = vec![format!(
            "INSERT INTO cells VALUES ('{}')",
            "x".repeat(MAX_SQL_BYTES)
        )];
        assert!(request.validate().is_err());
    }

    #[test]
    fn validates_and_pages_queries() {
        assert_eq!(database_statement("/* note */\nselect 1"), "SELECT");
        assert_eq!(
            paged_query("SELECT 1;", 2, 200),
            "SELECT * FROM (SELECT 1) AS __remotehub_page LIMIT 201 OFFSET 400"
        );
        assert!(normalize_request(QueryRequest {
            sql: " ".into(),
            page: None,
            page_size: None,
            _restart: None
        })
        .is_err());
    }
}
