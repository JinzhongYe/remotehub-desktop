# RemoteHub Desktop

RemoteHub Desktop 是一个本地优先的跨平台开发运维工作台。当前版本是 Phase 0 桌面骨架：可以管理连接元数据、搜索和收藏连接，并用本地 SQLite 持久化；SSH、SFTP、MySQL、PostgreSQL 和 SQLite 远程工作区会在后续阶段接入。

## 当前交付

- Electron + Vue 3 + TypeScript + Vite + Pinia
- 安全的 Renderer / Main 分层和白名单 preload IPC
- `better-sqlite3` 本地存储连接与分组
- Connection Explorer、Workspace、Status Bar 和连接编辑弹窗
- 紧凑的深色开发工具界面

Phase 0 不会建立 SSH、SFTP 或数据库网络连接，也不会保存密码。凭据引用和系统钥匙串接入会在后续 Connection Manager 阶段实现。

## 启动

在本目录执行：

```powershell
npm install
npm run dev
```

`npm run dev` 会先生成 Electron 主进程产物，再启动 Vite 和桌面窗口。关闭窗口即可结束本地开发进程。项目不要求预装 pnpm。

Windows 也可以双击 `start.bat`；它会检查 Node.js / pnpm，首次运行时自动安装依赖。

## 校验与构建

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`pnpm build` 生成：

- `dist/`：Vue 渲染进程静态资源
- `dist-electron/`：Electron Main / preload 编译产物

当前尚未接入安装包打包器；Windows EXE、macOS DMG 和 Linux AppImage 按路线图在发布阶段加入。

## 数据位置

应用运行后会在 Electron 的用户数据目录创建 `remotehub.db`，只保存连接元数据和分组。密码、Token、私钥口令等敏感信息不进入数据库。若某台机器刚完成依赖安装、SQLite 原生模块暂时不可用，Phase 0 会自动使用同目录的 `remotehub.metadata.json` 作为元数据临时回退，以便桌面壳仍能打开；原生模块可用后恢复 SQLite 主路径。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [开发路线图](docs/ROADMAP.md)
