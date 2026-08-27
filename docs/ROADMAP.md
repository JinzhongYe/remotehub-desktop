# RemoteHub Desktop Roadmap

## Phase 0 — 项目骨架（已完成）

- Electron + Vue 3 + TypeScript + Vite + Pinia。
- 安全 BrowserWindow、preload 和白名单 IPC。
- better-sqlite3 存储连接资产与分组。
- 紧凑型 Connection Explorer、Workspace、Status Bar。
- 新增、编辑、删除、收藏和搜索连接的本地 UI。
- lint、typecheck、tests、build 可运行。

验收：应用能启动；重启后连接资产仍存在；Renderer 不能直接触达 Node API；构建产物可加载。

## Phase 1 — Connection Manager（当前）

- 完整连接 CRUD、分组、复制、收藏和拖动排序。
- 系统钥匙串凭据引用。
- 连接测试、错误码和最近连接。
- 中英文界面切换（本地记忆语言偏好）。
- Windows / macOS 快捷键和系统凭据加密兼容。

## Phase 2 — SSH

- `ssh2` SSHService 和 IPC。
- xterm.js 多 Terminal Tab、输入输出、resize、复制粘贴、UTF-8。
- 密码、Private Key、Key Passphrase。

## Phase 3 — SSH 稳定性

- Host Key 指纹确认和变更阻断。
- 超时、重连、心跳、资源释放和标准错误码。

## Phase 4 — SFTP

- 目录浏览、进入、返回、刷新、上传、下载、mkdir、重命名、删除。
- 中文文件名、大文件、权限错误测试。

## Phase 5 — Transfer Manager

- 多文件/文件夹队列、进度、速度、暂停、取消、重试、覆盖确认。

## Phase 6 — MySQL

- DatabaseAdapter、数据库/表/字段 Explorer、SQL Editor、Result Grid。

## Phase 7 — PostgreSQL

- PostgresAdapter、SSL、游标分页、SSH Tunnel，不修改数据库 UI 主体。

## Phase 8 — SQLite

- 打开本地 `.db` 文件、只读查询、表结构和导出。

## Phase 9 — Workspace 完善

- Tab 恢复、固定/批量关闭、Split View、快捷键、最近连接。

## Phase 10 — 发布

- Windows 10/11 EXE、macOS DMG、Linux AppImage。
- 每个 Phase 都必须通过 lint、typecheck、tests、build，并完成真实连接验收。
