# RemoteHub Android 迁移分析

## 1. 结论

RemoteHub 当前是一个边界清晰的 Electron 应用：Vue Renderer 负责界面和可序列化状态，preload 将白名单能力暴露为 `window.api`，Electron Main 通过 IPC 调用 Node 服务并持有 SSH、SFTP、FTP、串口、本地 Shell 和数据库会话。

Android 版本可以继续复用现有 Vite、Vue、Pinia、xterm.js、CodeMirror 和 `src/shared` 中的纯 TypeScript 代码，但不能直接复用 Electron IPC、Node 原生模块、桌面文件路径或 `safeStorage`。迁移的第一步应是把 Renderer 对 `window.api` 的直接依赖收口到 service/provider 层；现有 Main 服务和 IPC 保留为 Desktop Provider，不搬迁、不重写。

当前 Renderer 没有使用 `window.electron`，也没有直接导入 `ipcRenderer`。实际平台耦合点是 preload 暴露的 `window.api`，以及 `src/renderer/types/env.d.ts` 从 preload 推导的 `RemoteHubApi` 类型。

## 2. 当前架构

### 2.1 运行结构

```text
Vue Renderer
  ├─ Views / Components
  ├─ Pinia stores
  ├─ xterm.js / CodeMirror
  └─ window.api
          │
          ▼
Electron preload
  ├─ contextBridge
  ├─ ipcRenderer.invoke
  └─ ipcRenderer.on / removeListener
          │
          ▼
Electron Main
  ├─ IPC handlers
  ├─ StorageService / CredentialService
  ├─ SshService / SftpService / FtpService
  ├─ LocalShellService / SerialService
  └─ DatabaseService / DatabaseAdapter
          │
          ▼
Node 与原生依赖
  ├─ ssh2 / node-pty / serialport
  ├─ mysql2 / pg / better-sqlite3
  ├─ basic-ftp / iconv-lite
  └─ node:fs / node:net / node:stream / node:child_process
```

`src/main/index.ts` 负责：

- 设置 Electron `userData` 目录并创建 `BrowserWindow`。
- 启用 `contextIsolation` 和 sandbox，关闭 `nodeIntegration`。
- 创建各领域服务单例并注册 IPC handler。
- 将服务事件通过 `webContents.send` 转发给 Renderer。
- 在应用退出前释放全部会话和本地数据库。

开发环境加载 Vite Preview，打包环境加载 `dist/index.html`。Vite 入口是 `src/renderer/main.ts`，路由使用 hash history，因此可以继续用于 Tauri WebView。

### 2.2 Main 与 IPC 目录

| 位置 | 职责 | 平台依赖 |
| --- | --- | --- |
| `src/main/index.ts` | Electron 生命周期、窗口、服务装配、事件转发 | Electron、Node |
| `src/main/ipc/app.ipc.ts` | 应用信息、剪贴板、主题、文件/目录选择、关闭确认 | Electron dialog/clipboard/BrowserWindow |
| `src/main/ipc/connection.ipc.ts` | 连接和分组 CRUD、导入导出、连通性测试 | Electron dialog、Node fs/net |
| `src/main/ipc/ssh.ipc.ts` | SSH 会话、Host Key、输入、resize、状态、Codex | Electron IPC |
| `src/main/ipc/sftp.ipc.ts` | SFTP/FTP 文件操作和传输队列 | Electron IPC |
| `src/main/ipc/local-shell.ipc.ts` | 本地 Shell 会话 | Electron IPC |
| `src/main/ipc/serial.ipc.ts` | 串口枚举和会话 | Electron IPC |
| `src/main/ipc/database.ipc.ts` | 数据库会话、查询、CSV 导出 | Electron dialog、Node fs |
| `src/main/services/*` | Desktop 业务实现和会话持有 | Node 或 Electron |
| `src/main/services/database/*` | MySQL、PostgreSQL、SQLite Adapter | Node 数据库驱动 |

IPC handler 主要负责读取连接、校验会话标识、调用服务和返回可序列化结果。会话对象保存在 Main 进程的 `Map` 中，Renderer 只持有 `sessionId`。

### 2.3 preload API

`src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('api', api)` 暴露以下能力：

| API 域 | 主要能力 | 事件 |
| --- | --- | --- |
| `app` | 应用信息、剪贴板、主题、本地目录、文件选择、关闭确认 | `close-requested`、`fullscreen-changed` |
| `files` | 使用 `webUtils.getPathForFile` 将拖放文件转成桌面绝对路径 | 无 |
| `connections` | 列表、保存、删除、复制、排序、导入、导出、测试 | 无 |
| `groups` | 保存、排序、删除 | 无 |
| `ssh` | 连接、信任 Host Key、临时凭据查询、输入、resize、状态、Codex、断开 | `ssh:data`、`ssh:status` |
| `sftp` | 连接、目录和文本操作、上传下载队列、断开 | `sftp:status`、`sftp:transfer` |
| `ftp` | 与 SFTP 相同的文件和传输 API，不含 Host Key | `ftp:status`、`ftp:transfer` |
| `serial` | 端口枚举、连接、输入、断开 | `serial:data`、`serial:status` |
| `shell` | 本地 Shell 连接、输入、resize、Codex、断开 | `shell:data`、`shell:status` |
| `database` | 连接、库表字段列表、切库、查询、CSV 导出、断开 | `database:status` |

preload 没有暴露通用 `ipcRenderer`，事件订阅均返回清理函数。这套调用形状适合作为 Desktop Provider 的行为基线，但 `RemoteHubApi = typeof api` 不能继续作为跨平台公共契约，因为它要求类型系统加载 Electron preload。

### 2.4 Renderer 的平台直连位置

Renderer 不直接引用 Electron 包，所有平台调用都经过 `window.api`：

| 位置 | 直接使用的能力 |
| --- | --- |
| `src/renderer/App.vue` | 应用关闭事件与确认关闭 |
| `src/renderer/views/WorkspaceView.vue` | 应用信息、主题、全屏事件 |
| `src/renderer/stores/connection.ts` | 连接、分组、导入导出、测试 |
| `src/renderer/components/ConnectionDialog.vue` | 串口枚举、私钥/SQLite/Shell 路径选择、连接测试 |
| `src/renderer/components/TerminalPane.vue` | SSH、本地 Shell、剪贴板、Host Key、服务器和 Codex 状态 |
| `src/renderer/components/SftpPane.vue` | SFTP/FTP、连接信息、本地目录、文件选择、拖放路径 |
| `src/renderer/components/SerialTerminalPane.vue` | 串口会话和事件 |
| `src/renderer/components/DatabasePane.vue` | 数据库会话、查询、状态、CSV 导出 |

第二阶段应替换这些直连点，不需要修改其他纯 UI 组件。

## 3. 领域实现分析

### 3.1 SSH

`SshService` 使用 `ssh2` 创建独立 Client 和交互式 shell：

- 连接只接收 `connectionId` 和可选临时密码；连接元数据和保存的凭据由 Main 读取。
- 支持密码、Private Key、Host Key SHA-256 固定、输入、UTF-8 输出、resize、断开和 keepalive。
- 首次遇到 Host Key 时先关闭会话并返回待确认指纹；确认后重新连接。
- 临时密码可以保留在 SSH 会话内存中并供同一连接的 SFTP 使用，不写入 Renderer 状态。
- `statusOverview` 和远程 Codex 状态通过 SSH `exec` 启动独立命令。

Android 不能复用 `ssh2` 或 Node Buffer/stream。Rust 后端需要重现现有 `sessionId`、Host Key 确认、状态事件和错误码语义。改造目标要求 Private Key passphrase，但当前 Desktop 数据结构和连接流程没有单独的 passphrase 字段或存储策略，这是新增能力而不是现状复刻。

### 3.2 SFTP 与 FTP

`SftpService` 使用独立于 Terminal 的 `ssh2` Client 和 SFTP session。它复用连接资产、凭据和 Host Key 规则，但不复用已经建立的 SSH transport。`FtpService` 使用 `basic-ftp`，并与 SFTP 共用 Renderer、共享类型和 `TransferManager`。

现有 SFTP 支持：

- 目录列表、创建、重命名、删除。
- 小于 2 MiB 的 UTF-8 文本读取和带修改时间检查的写入。
- 文件和目录上传下载、冲突检测、修改时间保留。
- 两路并发传输、暂停、继续、取消、重试和完成项清理。
- 本地绝对路径、文件数、目录深度和目标文件名校验。

目录规划、远程路径规范化、冲突展示和传输状态模型可以复用；Node fs/stream、绝对路径和 `ssh2` 传输实现必须替换。改造说明要求 Android SFTP 复用已有 SSH session，与当前 Desktop 的独立连接模型不同，统一接口必须允许底层实现采用不同会话策略。

FTP 不在 Android 主线范围内。Android UI 需要隐藏或明确标记不可用，不能让 `SftpPane` 因协议切换继续调用不存在的 Provider。

### 3.3 Terminal 与本地 Shell

远程 Terminal 和本地 Shell 共用 `TerminalPane.vue` 与 xterm.js。组件通过二选一调用 `window.api.ssh` 或 `window.api.shell`，订阅数据/状态事件，并将键盘输入和 resize 发送给 Main。

`LocalShellService` 使用 `node-pty` 启动 PowerShell、Zsh 或系统 Shell，并通过 Node 子进程执行本地 `codex app-server`。Android 不应模拟 Desktop Local Shell；首版应通过平台能力声明隐藏本地 Shell 和本地 Codex 入口。

xterm.js、ANSI 处理、终端主题、布局计算和绝大多数交互逻辑可继续复用。剪贴板、软键盘、触摸选择、后台恢复和 WebView resize 需要 Android 适配。

### 3.4 Database

`DatabaseService` 为每个工作区创建独立 session，以统一 `DatabaseAdapter` 管理 MySQL、PostgreSQL 和 SQLite，并阻止同一 session 并发查询。

- MySQL：`mysql2`，支持库表字段、分页、序列化、写操作和超时处理。
- PostgreSQL：`pg`，使用服务端 cursor 分页；可通过另一个 SSH 连接资产建立 `ssh2.forwardOut` tunnel。
- SQLite：`better-sqlite3`，直接打开桌面绝对路径。
- CSV：共享代码负责序列化，Electron IPC 负责选择保存位置和写文件。

数据库 UI、查询请求/结果类型、分页规则、CSV 编码和错误展示可以复用。Node 驱动、PostgreSQL SSH tunnel 和文件写入必须由 Rust/native 实现。

当前 SQLite 代码没有以只读模式打开数据库，并允许执行 mutation；这与 `docs/ARCHITECTURE.md` 的“只读打开”描述不一致。Android SQLite 是否支持写入必须在实现前单独确认，不能从现有架构文档推断。

### 3.5 本地文件系统

桌面端通过 Electron dialog、`webUtils.getPathForFile` 和 Node fs 使用绝对路径。本地目录浏览还依赖 home、desktop、documents、downloads 等 Electron 路径。

Android 文件选择通常返回受权限约束的资源，不能假设拖放文件或选择结果能转换成长期有效的绝对路径。文件选择、授权、读取、写入和权限续期应全部留在 Tauri/Rust Provider 内，Renderer 只处理平台无关的文件引用和展示名称。

### 3.6 配置、连接、密码和密钥

连接元数据由 `StorageService` 保存到 Electron `userData/remotehub.db`：

- `connections` 保存类型、主机、端口、用户名、认证方式、数据库设置、SSH tunnel、`credentialId`、Host Key 指纹、分组和界面元数据。
- `groups` 保存分组和排序。
- `better-sqlite3` 不可用时回退到 `remotehub.metadata.json`，回退文件仍不保存凭据内容。

敏感数据由 `CredentialService` 管理：

- 密码和 Private Key 内容通过 Electron `safeStorage` 加密。
- 密文以 base64 保存在权限为 `0600` 的 `remotehub.credentials.json`。
- 私钥路径仅用于 Main 进程读取；文件需小于 1 MiB，并校验 OpenSSH、PEM、PKCS#8 或 PPK 头。
- 保存成功后连接记录只持有随机 `credentialId`。
- 删除最后一个凭据引用时同步删除密文。
- 连接导入导出不包含 `credentialId`、密码、私钥或 Host Key 指纹。

主题、语言、Workspace Tab 和 SFTP 布局偏好另存在 WebView `localStorage`。Android 本地数据设计需要同时覆盖数据库元数据与这些界面偏好，否则会形成两套无法统一迁移和清理的状态。

## 4. 复用与重实现边界

### 4.1 可以直接复用

- `src/renderer` 的 Vue 页面、Pinia 状态、hash router、i18n 和大部分 CSS。
- xterm.js、xterm fit addon、CodeMirror 与数据库/SFTP 展示逻辑。
- `src/shared` 中不依赖 Node/Electron 的类型和纯函数，包括连接模型、状态事件、远程路径、SQL/CSV、ANSI、终端输入和串口设置规范化。
- `DatabaseAdapter` 的能力形状和现有 `sessionId` 模型可作为跨平台接口参考。

这些模块只有在移除 `window.api` 和 preload 类型依赖后，才算真正可被 Android 构建复用。

### 4.2 Desktop-only 模块

- `src/main/index.ts`、全部 `src/main/ipc` 和 `src/preload`。
- Electron BrowserWindow、dialog、clipboard、safeStorage、webUtils 和应用生命周期。
- `StorageService` 的 Electron 路径解析与 `better-sqlite3` 实现。
- `CredentialService` 的 Electron `safeStorage` 实现。
- `SshService`、`SftpService`、`FtpService` 的 Node 网络与 stream 实现。
- `LocalShellService`、`SerialService`、Node 本地文件服务。
- MySQL、PostgreSQL、SQLite 的 Node Adapter 和 PostgreSQL SSH tunnel。

这些代码应继续服务 Windows/macOS Desktop，不需要为了共享目录而搬迁。

### 4.3 Android 需要重新实现

- Tauri command/event bridge 和 Provider 装配。
- Android 元数据存储、安全凭据、Host Key 与私钥管理。
- Rust SSH session、命令执行、交互式 shell 和 SFTP。
- PostgreSQL/MySQL Rust/native Adapter；SQLite 延后决策。
- Android 文件选择、资源权限、本地文件读写、剪贴板和应用生命周期。
- 后台/前台切换后的会话状态、监听器恢复与清理。

FTP、串口、本地 Shell 和 Codex 不属于首轮 Android 实现；需要能力开关，不创建占位实现。

## 5. 推荐目录结构

保留当前 Electron 目录，避免无收益搬迁：

```text
remotehub-desktop/
├── src/
│   ├── main/                  # 现有 Electron Main，不搬迁
│   ├── preload/               # 现有 Desktop bridge
│   ├── renderer/              # 公共 Vue UI
│   ├── shared/                # 平台无关类型和纯函数
│   ├── platform/
│   │   ├── index.ts           # 选择并导出当前 Provider
│   │   ├── electron.ts        # 适配 window.api
│   │   └── tauri.ts           # 第三阶段随 src-tauri 一起加入
│   └── services/
│       ├── ssh/
│       ├── sftp/
│       ├── terminal/
│       ├── database/
│       └── storage/
├── src-tauri/                 # Tauri 2 / Android Rust 后端
├── package.json
└── vite.config.mjs
```

每个 service 只定义 Renderer 实际使用的最小接口并转发给当前 Provider。不要提前为未迁移的 FTP、串口、本地 Shell 或 Codex 创建空目录和假实现。

## 6. 迁移顺序

1. **平台抽象**：把公共契约从 preload 类型中移出；建立 service 和 Electron Provider；逐个替换 Renderer 的 `window.api` 直连，保持 Desktop 行为和事件清理不变。
2. **Tauri 外壳**：在现有 Vite 项目上初始化 `src-tauri`，加载同一 Renderer；先提供应用信息、主题、能力声明和必要的文件选择 Provider。
3. **Android 本地数据**：实现连接/分组存储和安全凭据，再开始真实网络能力。虽然原改造说明将它列为第八阶段，但 SSH/SFTP 需要先有可靠的凭据和 Host Key 存储。
4. **SSH 与 Terminal**：实现密码、Private Key、passphrase、Host Key、exec、shell、输入、输出、resize、断开和前后台状态处理；继续使用 xterm.js。
5. **SFTP**：在 Android SSH transport 上实现目录、文本和传输能力；保持现有队列状态和冲突交互。
6. **Database**：先 PostgreSQL，再 MySQL；复用统一请求/结果模型。SSH tunnel 依赖 Android SSH 层稳定后再接入。
7. **移动端 UI**：按真实设备问题调整 Sidebar、Tab、Terminal、SFTP、数据库树、Dialog、长按和软键盘；不重做桌面 UI。
8. **延后能力**：根据需求决定 SQLite、FTP、串口、本地 Shell 和 Codex，不因 Desktop 已有实现而默认纳入 Android。

每一步都保留 Electron Provider，并以 Desktop build/typecheck/test 作为回归门槛；Android 相关步骤额外验证 `tauri android dev`。

## 7. 风险点

| 优先级 | 风险 | 处理原则 |
| --- | --- | --- |
| 高 | Renderer 类型从 preload 推导，Android 构建会间接加载 Electron 类型 | 第二阶段先把公共接口移到平台无关模块 |
| 高 | 密码、私钥和 Host Key 不能沿用 `safeStorage` 文件 | 网络功能前先完成 Android 安全存储与生命周期设计 |
| 高 | Android 文件资源不等同于桌面绝对路径 | Provider 持有文件引用和权限，Renderer 不拼接本地路径 |
| 高 | Tauri event 与 Electron listener 的注册/清理方式不同 | service 统一返回 unsubscribe，并在 Tab/应用销毁时调用 |
| 高 | SFTP 目标要求复用 SSH session，Desktop 当前使用独立 Client | 接口不暴露底层 transport；Android 可复用，Desktop 保持现状 |
| 高 | Android 前后台切换可能终止 WebView 或网络 | Rust 持有会话；恢复时重新同步 session 状态，不能只依赖前端内存 |
| 中 | Private Key passphrase 是新增数据和交互 | 单独定义凭据用途，禁止与密码字段隐式混用 |
| 中 | PostgreSQL tunnel、分页和错误码容易出现平台差异 | 以现有共享结果类型和错误码为兼容基线 |
| 中 | SQLite 当前代码与架构文档的只读描述不一致 | 实现 Android SQLite 前先确定产品行为并补齐一致性测试 |
| 中 | FTP、串口、本地 Shell、Codex 入口在 Android 无实现 | 使用能力声明隐藏入口，不提供永远失败的 Provider |
| 中 | UI 仍以桌面尺寸为主，BrowserWindow 最小宽度为 1040 | 第三阶段只保证页面加载，第九阶段在真机上集中适配 |
| 低 | 元数据数据库、凭据文件和 WebView localStorage 分散 | storageService 统一访问入口，暂不强制迁移 Desktop 现有数据 |

## 8. Tauri 2 实施依据

- Tauri 2 支持在现有前端上单独初始化 Rust 后端，Android 环境需要 Android Studio、SDK Platform、Platform-Tools、NDK、Build-Tools 和 Command-line Tools：<https://v2.tauri.app/start/prerequisites/>
- 前端通过 `@tauri-apps/api/core` 的 `invoke` 调用 Rust command；页面不应直接调用 command，而应由 Tauri Provider 封装：<https://v2.tauri.app/develop/calling-rust/>
- Rust 可向前端发送事件；事件监听必须保留并调用清理函数：<https://v2.tauri.app/develop/calling-frontend/>
- 官方插件目录包含 filesystem、dialog、clipboard、store 和 Stronghold 等能力，但移动端支持和权限仍需逐项验证：<https://v2.tauri.app/plugin/>
- Stronghold 提供加密存储能力，可作为 Android 凭据方案候选；最终密钥派生和解锁策略需在第八阶段提前后的存储任务中确定：<https://v2.tauri.app/plugin/stronghold/>

## 9. 第一阶段完成标准

- 已覆盖 Electron Main、preload、Renderer 平台调用、SSH、SFTP、Terminal、数据库、`better-sqlite3`、本地文件、配置和凭据。
- 已区分可复用、Desktop-only 和 Android 重实现模块。
- 已给出不搬迁 Electron 代码的推荐目录和有依赖顺序的迁移路线。
- 已记录源码与现有架构说明之间的差异。
- 本阶段不修改 API、业务行为、依赖或构建配置。
