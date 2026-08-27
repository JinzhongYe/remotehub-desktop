# RemoteHub Desktop Architecture

## 目标

RemoteHub Desktop 是一个本地优先的跨平台开发运维工作台，围绕“一个连接、一个工作区、多个工具”组织 SSH、SFTP 和数据库能力。当前 Phase 1 交付连接管理、系统凭据引用和 TCP 可达性测试，不在渲染进程实现远程连接。

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
  ├─ SSHService / SFTPService
  ├─ DatabaseService / Adapters
  ├─ StorageService（better-sqlite3）
  └─ CredentialService（系统钥匙串）
```

Renderer 禁止直接访问 `fs`、`ssh2`、数据库驱动、私钥和密码。Main 进程只通过明确的 IPC 通道接收已校验的参数，并返回可序列化数据或标准化错误。

## IPC 设计

IPC 通道按领域命名：

```text
app:getInfo
connections:list
connections:save
connections:delete
connections:duplicate
connections:reorder
connections:test
groups:save
groups:delete
```

后续扩展：

```text
ssh:connect / ssh:write / ssh:resize / ssh:disconnect
sftp:list / sftp:transfer / sftp:mkdir / sftp:rename / sftp:delete
database:connect / database:query / database:getTables
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
- `SFTPService`：目录、文件信息、传输和 TransferManager。
- `DatabaseService`：统一 Adapter 接口；第一阶段实现 MySQL、PostgreSQL、SQLite。
- `StorageService`：本地 SQLite 只保存连接元数据和 `credentialId`，不保存密码。
- `CredentialService`：通过 Electron `safeStorage` 对接 macOS Keychain、Windows DPAPI 和 Linux Secret Service；Linux 明文后端不可用。

## 数据结构

```ts
interface Connection {
  id: string
  name: string
  type: 'ssh' | 'database'
  host: string
  port: number
  username?: string
  authType?: 'password' | 'privateKey'
  databaseType?: 'mysql' | 'postgres' | 'sqlite'
  database?: string
  credentialId?: string
  groupId?: string
  favorite?: boolean
  createdAt: number
  updatedAt: number
}
```

## 安全设计

- BrowserWindow 开启 `contextIsolation`，关闭 `nodeIntegration`。
- preload 只暴露白名单 API，不暴露通用 `ipcRenderer`。
- 密码、Token、私钥口令只进入系统凭据存储，日志中禁止出现。
- Host Key 首次连接显示指纹，变更时阻断静默连接。
- 默认本地优先，远程数据不自动上传云端。
- 连接名、主机、端口、SQL 和文件路径在 Main 进程再次校验。

## Phase 0 运行路径

Renderer 通过 `connections:list/save/delete` 验证 IPC；Main 进程打开用户数据目录中的 `remotehub.db`，初始化 `connections` 与 `groups` 表。若原生 SQLite 模块刚安装尚未就绪，StorageService 会回退到同目录的元数据 JSON 文件，且仍不保存任何凭据。远程连接服务在 Phase 2 以后接入，Phase 0 不创建 SSH、SFTP 或数据库网络 Session。

## Phase 1 运行路径

Renderer 通过白名单 IPC 管理连接与分组。连接顺序、最近成功测试时间和随机 `credentialId` 写入 SQLite；敏感值由 Main 进程加密后写入权限受限的凭据文件。`connections:test` 只执行五秒超时的 TCP 可达性检查，并返回稳定错误码，不建立 SSH 或数据库会话。
