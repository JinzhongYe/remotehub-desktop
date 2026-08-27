# RemoteHub Desktop Architecture

## 目标

RemoteHub Desktop 是一个本地优先的跨平台开发运维工作台，围绕“一个连接、一个工作区、多个工具”组织 SSH、SFTP、串口和数据库能力。当前 Phase 4 交付连接管理、系统凭据引用、Host Key 固定、多个独立 SSH/SFTP/串口工作区；所有设备与远程连接仍在 Main 进程实现。

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
app:getInfo / app:copyText
connections:list
connections:save
connections:delete
connections:duplicate
connections:reorder
connections:test
groups:save
groups:delete
ssh:connect / ssh:trustHostKey / ssh:write / ssh:resize / ssh:disconnect
sftp:connect / sftp:list / sftp:upload / sftp:download / sftp:mkdir / sftp:rename / sftp:remove / sftp:disconnect
serial:listPorts / serial:connect / serial:write / serial:disconnect
```

后续扩展：

```text
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
- `SFTPService`：独立 SSH/SFTP 会话、目录、文件信息和基础传输进度。
- `SerialService`：跨平台设备枚举、串口会话、输入输出和连接测试。
- `DatabaseService`：统一 Adapter 接口；第一阶段实现 MySQL、PostgreSQL、SQLite。
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

## Phase 0 运行路径

Renderer 通过 `connections:list/save/delete` 验证 IPC；Main 进程打开用户数据目录中的 `remotehub.db`，初始化 `connections` 与 `groups` 表。若原生 SQLite 模块刚安装尚未就绪，StorageService 会回退到同目录的元数据 JSON 文件，且仍不保存任何凭据。远程连接服务在 Phase 2 接入，Phase 0 不创建 SSH、SFTP 或数据库网络 Session。

## Phase 1 运行路径

Renderer 通过白名单 IPC 管理连接与分组。连接顺序、最近成功测试时间和随机 `credentialId` 写入 SQLite；敏感值由 Main 进程加密后写入权限受限的凭据文件。`connections:test` 只执行五秒超时的 TCP 可达性检查，并返回稳定错误码，不建立 SSH 或数据库会话。

## Phase 2 运行路径

SSH Terminal 打开时，Renderer 只提交 `connectionId`。Main 进程从 StorageService 读取 SSH 元数据，从 CredentialService 读取系统加密凭据，再由 `SshService` 创建 `ssh2` Client 和 shell stream。终端输入、输出和状态通过 `ssh:*` 白名单 IPC 传输；关闭工作区或应用退出时释放 stream 和 client。当前实现支持密码 / Private Key、UTF-8、resize、断开和重连；Private Key 口令仍待后续认证能力补齐。

## Phase 3 运行路径

每个 Workspace Tab 独立创建和持有 SSH `sessionId`，切换 Tab 不卸载 Terminal，关闭单个 Tab 只释放对应 Session。同一连接资产可以重复打开；数据库资产也使用独立 SQL Tab，实际数据库 Session 在 Phase 6–8 Adapter 接入后挂载。首次 SSH 握手返回 SHA-256 Host Key 指纹，用户确认后持久化；已保存指纹不匹配时直接阻断。SSH 使用十秒握手超时、十秒心跳和三次失联阈值，并将网络、认证、握手错误映射为稳定代码。

## Phase 4 运行路径

SFTP Tab 使用独立 `ssh2` Client 和 SFTP Session，并复用同一连接资产的凭据与 Host Key 固定策略。Renderer 只传递受校验的远程路径与用户通过系统文件对话框/拖放选择的本地路径；目录列表和传输进度通过序列化 IPC 返回。串口资产使用 `host` 保存设备路径、`port` 保存波特率，Main 进程通过 `serialport` 持有会话并向独立 xterm.js Tab 推送数据。关闭 Tab 或应用时会释放 SSH、SFTP 与串口资源。
