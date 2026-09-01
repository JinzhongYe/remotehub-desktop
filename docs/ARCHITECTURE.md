# RemoteHub Desktop Architecture

## 目标

RemoteHub Desktop 是一个本地优先的跨平台开发运维工作台，围绕“一个连接、一个工作区、多个工具”组织 SSH、SFTP、串口和数据库能力。当前 Phase 9 交付连接管理、系统凭据引用、Host Key 固定、独立 SSH/SFTP/串口工作区、受控 SFTP 传输队列、MySQL/PostgreSQL/SQLite 工作区，以及可恢复、可固定并支持单/双/四视图的 Workspace Tab；所有设备、文件与远程连接仍在 Main 进程实现。

## Electron 分层

```text
Vue Renderer
  ├─ Components / Views
  ├─ Pinia stores（只保存可序列化状态）
  └─ window.api（preload 暴露的白名单 IPC）
          │
          ▼
Electron Main
  ├─ IPC handlers
  ├─ SessionManager
  ├─ SSHService / SFTPService / TransferManager
  ├─ DatabaseService / Adapters
  ├─ StorageService（better-sqlite3）
  └─ CredentialService（系统钥匙串）
```

Renderer 禁止直接访问 `fs`、`ssh2`、数据库驱动、私钥和密码。Main 进程只通过明确的 IPC 通道接收已校验的参数，并返回可序列化数据或标准化错误。

## IPC 设计

IPC 通道按领域命名：

```text
app:getInfo / app:copyText / app:chooseDatabaseFile
connections:list
connections:save
connections:delete
connections:duplicate
connections:reorder
connections:test
groups:save
groups:delete
ssh:connect / ssh:trustHostKey / ssh:write / ssh:resize / ssh:disconnect
sftp:connect / sftp:list / sftp:mkdir / sftp:rename / sftp:remove / sftp:disconnect
sftp:enqueueUploads / sftp:enqueueDownload / sftp:listTransfers
sftp:pauseTransfer / sftp:resumeTransfer / sftp:cancelTransfer / sftp:retryTransfer / sftp:clearFinishedTransfers
serial:listPorts / serial:connect / serial:write / serial:disconnect
database:connect / database:disconnect / database:listDatabases / database:useDatabase
database:listTables / database:listColumns / database:query / database:exportCsv
```

每个 handler 只负责输入校验、调用服务和错误映射；业务逻辑不写入 Vue 组件。

## SessionManager

Main 进程集中持有 SSH、SFTP 和数据库连接对象，使用 `sessionId` 与 Renderer 关联。Pinia 只保存：

```text
sessionId、connectionId、状态、错误码、展示元数据
```

关闭 Tab 时，必须按顺序释放监听器、Stream、Terminal 和底层 Session。

## 服务边界

- `SSHService`：连接、Shell、输入输出、resize、重连、Host Key 校验。
- `SFTPService`：独立 SSH/SFTP 会话、目录操作、递归传输计划、覆盖检查和文件流适配。
- `TransferManager`：内存队列、双并发调度、任务状态、进度限流、暂停/继续、取消和重试。
- `SerialService`：跨平台设备枚举、串口会话、输入输出和连接测试。
- `DatabaseService`：独立数据库 Session、并发保护和统一 Adapter 接口；Phase 6–8 接入 MySQLAdapter、PostgresAdapter 与 SqliteAdapter。
- `MySQLAdapter`：密码认证、结构元数据、数据库切换、查询分页、结果序列化和稳定错误映射。
- `PostgresAdapter`：Schema 元数据、服务端游标分页、SSL 和经可信 SSH 资产建立的隧道。
- `SqliteAdapter`：本地文件只读打开、表结构、分页查询和稳定错误映射。
- `StorageService`：本地 SQLite 只保存连接元数据和 `credentialId`，不保存密码。
- `CredentialService`：通过 Electron `safeStorage` 对接 macOS Keychain、Windows DPAPI 和 Linux Secret Service；Linux 明文后端不可用。

## 数据结构

```ts
interface Connection {
  id: string
  name: string
  type: 'ssh' | 'database' | 'serial'
  host: string
  port: number
  username?: string
  authType?: 'password' | 'privateKey'
  databaseType?: 'mysql' | 'postgres' | 'sqlite'
  database?: string
  credentialId?: string
  hostKeyFingerprint?: string
  groupId?: string
  favorite?: boolean
  sortOrder: number
  lastConnectedAt?: number
  createdAt: number
  updatedAt: number
}
```

## 安全设计

- BrowserWindow 开启 `contextIsolation`，关闭 `nodeIntegration`。
- preload 只暴露白名单 API，不暴露通用 `ipcRenderer`。
- 密码、Token、私钥口令只进入系统凭据存储，日志中禁止出现。
- 私钥文件只在 Main 进程读取，验证 OpenSSH/PEM/PKCS#8/PPK 头后立即加密保存；Renderer 不接收文件内容。
- 首次 SSH 连接必须确认 SHA-256 Host Key 指纹；后续指纹变化会阻断连接，修改主机或端口时清除旧指纹。
- 默认本地优先，远程数据不自动上传云端。
- 连接名、主机、端口、SQL 和文件路径在 Main 进程再次校验。
- SQLite 文件支持查询和写入；CSV 只能写入用户通过系统对话框选定的位置。

## Phase 0 运行路径

Renderer 通过 `connections:list/save/delete` 验证 IPC；Main 进程打开用户数据目录中的 `remotehub.db`，初始化 `connections` 与 `groups` 表。若原生 SQLite 模块刚安装尚未就绪，StorageService 会回退到同目录的元数据 JSON 文件，且仍不保存任何凭据。远程连接服务在 Phase 2 接入，Phase 0 不创建 SSH、SFTP 或数据库网络 Session。

## Phase 1 运行路径

Renderer 通过白名单 IPC 管理连接与分组。连接顺序、最近成功测试时间和随机 `credentialId` 写入 SQLite；敏感值由 Main 进程加密后写入权限受限的凭据文件。SSH 和未接入的数据库 Adapter 使用五秒 TCP 可达性测试；Phase 6 起 MySQL 测试会建立短连接并验证认证，串口测试会短暂打开设备，所有路径都返回稳定错误码。

## Phase 2 运行路径

SSH Terminal 打开时，Renderer 只提交 `connectionId`。Main 进程从 StorageService 读取 SSH 元数据，从 CredentialService 读取系统加密凭据，再由 `SshService` 创建 `ssh2` Client 和 shell stream。终端输入、输出和状态通过 `ssh:*` 白名单 IPC 传输；关闭工作区或应用退出时释放 stream 和 client。当前实现支持密码 / Private Key、UTF-8、resize、断开和重连；Private Key 口令仍待后续认证能力补齐。

## Phase 3 运行路径

每个 Workspace Tab 独立创建和持有 SSH `sessionId`，切换 Tab 不卸载 Terminal，关闭单个 Tab 只释放对应 Session。同一连接资产可以重复打开；数据库资产也使用独立 SQL Tab，实际数据库 Session 在 Phase 6–8 Adapter 接入后挂载。首次 SSH 握手返回 SHA-256 Host Key 指纹，用户确认后持久化；已保存指纹不匹配时直接阻断。SSH 使用十秒握手超时、十秒心跳和三次失联阈值，并将网络、认证、握手错误映射为稳定代码。

## Phase 4 运行路径

SFTP Tab 使用独立 `ssh2` Client 和 SFTP Session，并复用同一连接资产的凭据与 Host Key 固定策略。Renderer 只传递受校验的远程路径与用户通过系统文件对话框/拖放选择的本地路径；目录列表和传输进度通过序列化 IPC 返回。串口资产使用 `host` 保存设备路径、`port` 保存波特率，Main 进程通过 `serialport` 持有会话并向独立 xterm.js Tab 推送数据。关闭 Tab 或应用时会释放 SSH、SFTP 与串口资源。

## Phase 5 运行路径

SFTPService 先递归生成文件传输计划并检查同名目标；Renderer 确认覆盖后，文件任务才会进入 Main 进程的 TransferManager。队列同时运行最多两个流任务，Renderer 仅接收限频后的可序列化任务快照。运行中的流可暂停和继续；取消会销毁两端流，失败或取消后重试会从零开始并覆盖不完整文件。关闭 SFTP Session 时，队列会取消并清理该 Session 的全部任务。目录深度、文件数量、绝对本地路径和跨平台文件名都在 Main 进程校验。

## Phase 6 运行路径

MySQL SQL Tab 创建独立 Database Session。Main 进程从 StorageService 读取连接元数据、从 CredentialService 解密密码，再由 MySQLAdapter 建立 `mysql2` 连接；Renderer 不接触驱动或密码。结构 Explorer 通过 `information_schema` 获取表和字段，SQL Editor 只提交 SQL、页码和页大小。`SELECT`/`WITH` 会追加受控 `LIMIT/OFFSET`；原语句已有顶层 `LIMIT` 时使用派生表包装，每页默认 200 行并多取一行判断下一页。其他语句直接执行。日期、大整数、二进制和对象在 Main 进程转换为可序列化单元格后才通过 IPC 返回。单个 Session 同时只执行一个查询，SQL 限制 1 MB，驱动查询超时为 30 秒，关闭 Tab 时销毁连接。

## Phase 7 运行路径

PostgreSQL SQL Tab 复用数据库 UI，把 Schema 映射为结构 Explorer 的顶层目录。`SELECT`/`WITH` 在只读事务中通过 `DECLARE SCROLL CURSOR`、`MOVE` 和 `FETCH` 分页，切换 SQL 或执行写操作时关闭游标。连接可启用 SSL 加密或严格证书校验；SSH Tunnel 复用已有 SSH 资产、系统凭据和已固定的 Host Key，通过 `forwardOut` 将 PostgreSQL 流量直接送入数据库驱动，不开放本地监听端口。

## Phase 8 运行路径

SQLite 连接资产以 `host` 保存用户选择的绝对本地文件路径，不保存凭据。Main 进程通过为 Electron ABI 重建的 `better-sqlite3` 以只读模式打开文件，Explorer 读取 `sqlite_schema` 与 `PRAGMA table_info`，查询层只执行 `reader` 语句并复用受控分页。Renderer 只持有序列化结果；当前页 CSV 经过大小和行列校验后，由 Main 进程写入用户在系统保存对话框中选择的位置。
