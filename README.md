# RemoteHub Desktop

RemoteHub Desktop 是一个本地优先的跨平台开发运维工作台。当前版本完成 Phase 6：可以管理连接，通过 SSH 打开多个终端和带传输队列的 SFTP 文件工作区，连接本机串口设备，并直接连接 MySQL；PostgreSQL 和 SQLite 工作区会在后续阶段接入。

## 当前交付

- Electron + Vue 3 + TypeScript + Vite + Pinia
- 安全的 Renderer / Main 分层和白名单 preload IPC
- `better-sqlite3` 本地存储连接与分组
- Connection Explorer、Workspace、Status Bar 和连接编辑弹窗
- 中英文切换、可折叠分组与拖动排序、最近连接和 TCP 可达性测试
- 系统保护的凭据引用（macOS Keychain、Windows DPAPI、Linux Secret Service）
- SSH 密码 / Private Key 登录、Host Key 指纹确认、终端多开、右键复制、resize、断开和重连
- SFTP 目录浏览、文件/文件夹递归上传下载、新建文件夹、重命名和删除
- 双并发传输队列、实时进度与速度、暂停/继续、取消、失败重试和覆盖确认
- 串口设备发现、波特率配置、连接测试和独立串口终端
- 私钥支持粘贴，也支持直接选择 OpenSSH、PEM、PKCS#8 和 PuTTY PPK 文件
- MySQL 密码登录、数据库/表/字段浏览、CodeMirror SQL 编辑器和分页结果表格
- MySQL 查询单页最多 200 行、最大可调至 500 行，支持选中 SQL 执行和 30 秒查询超时
- 紧凑的深色开发工具界面

SSH 和尚未接入的数据库类型使用 TCP 可达性测试；MySQL 测试会真实验证用户名、密码和默认数据库，串口测试会短暂打开并关闭所选设备。SSH/SFTP、MySQL 和串口都只在 Main 进程建立会话，Renderer 只能通过白名单 IPC 操作。敏感凭据经 Electron `safeStorage` 使用操作系统加密能力保存，SQLite 只保存随机引用标识；选择私钥文件后，应用读取并加密保存内容，不依赖原文件长期存在。

## 启动

在本目录执行：

```powershell
npm install
npm run dev
```

需要 Node.js 20 或更高版本（Intel 与 Apple Silicon macOS 均可）。

`npm run dev` 会先构建应用，再启动本地预览服务和桌面窗口。关闭窗口即可结束本地开发进程。项目不要求预装 pnpm。

Windows 也可以双击 `start.bat`；它会检查 Node.js / npm，并在首次运行或缺少串口组件时自动更新依赖。macOS 可直接在 Terminal 使用上述命令，并支持 `⌘K` 搜索和 `⌘N` 新建连接；Windows/Linux 对应 `Ctrl+K` 和 `Ctrl+N`。

SSH 连接保存后，单击连接打开终端；连接行上的 `⇄` 按钮打开 SFTP。可以选择或拖入文件与文件夹，下载远程目录时会保留目录结构；同名文件会先集中确认，传输队列支持暂停、继续、取消和重试。串口连接选择 `Serial / 串口` 类型，选取 `COM3`、`/dev/ttyUSB0` 等设备并填写波特率。

传输任务属于当前 SFTP 标签：关闭标签或断开连接会取消未完成任务。失败或取消的传输可能留下不完整目标文件，点击“重试”会从头覆盖该文件。

MySQL 连接选择 `Database` 和 `MySQL · Phase 6`，填写主机、端口、用户名、密码及可选默认数据库。打开连接后可以切换数据库、展开表查看字段，双击表生成预览 SQL；`Ctrl/⌘ + Enter` 执行选中内容，没有选中时执行全文。分页仅用于 `SELECT`/`WITH` 查询，其他语句直接执行并显示影响行数。

## 校验与构建

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm run build` 生成：

- `dist/`：Vue 渲染进程静态资源
- `dist-electron/`：Electron Main / preload 编译产物

当前尚未接入安装包打包器；Windows EXE、macOS DMG 和 Linux AppImage 按路线图在发布阶段加入。

## 数据位置

应用运行后会在 Electron 的用户数据目录创建 `remotehub.db`，只保存连接元数据、分组和凭据引用。加密后的凭据载荷位于权限受限的 `remotehub.credentials.json`，加密密钥由操作系统管理。若某台机器刚完成依赖安装、SQLite 原生模块暂时不可用，应用会自动使用同目录的 `remotehub.metadata.json` 作为元数据临时回退；原生模块可用后恢复 SQLite 主路径。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [开发路线图](docs/ROADMAP.md)
