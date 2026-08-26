# RemoteHub Desktop

RemoteHub Desktop 是一个本地优先的跨平台开发运维工作台。当前版本进入 Phase 1 Connection Manager：可以管理、分组、复制、排序、收藏和测试连接，并用本地 SQLite 持久化；SSH、SFTP、MySQL、PostgreSQL 和 SQLite 远程工作区会在后续阶段接入。

## 当前交付

- Electron + Vue 3 + TypeScript + Vite + Pinia
- 安全的 Renderer / Main 分层和白名单 preload IPC
- `better-sqlite3` 本地存储连接与分组
- Connection Explorer、Workspace、Status Bar 和连接编辑弹窗
- 中英文切换、分组与拖动排序、最近连接和 TCP 可达性测试
- 系统保护的凭据引用（macOS Keychain、Windows DPAPI、Linux Secret Service）
- 紧凑的深色开发工具界面

Phase 1 的“连接测试”只检查目标主机和端口是否可达，不会登录 SSH 或数据库；协议握手从 Phase 2 开始。敏感凭据经 Electron `safeStorage` 使用操作系统加密能力保存，SQLite 只保存随机引用标识；Linux 检测到明文后端时会拒绝保存。

## 启动

在本目录执行：

```powershell
npm install
npm run dev
```

需要 Node.js 20 或更高版本（Intel 与 Apple Silicon macOS 均可）。

`npm run dev` 会先构建应用，再启动本地预览服务和桌面窗口。关闭窗口即可结束本地开发进程。项目不要求预装 pnpm。

Windows 也可以双击 `start.bat`；它会检查 Node.js / npm，首次运行时自动安装依赖。macOS 可直接在 Terminal 使用上述命令，并支持 `⌘K` 搜索和 `⌘N` 新建连接；Windows/Linux 对应 `Ctrl+K` 和 `Ctrl+N`。

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
