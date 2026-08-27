# RemoteHub Desktop Roadmap

## Phase 0 — 项目骨架（已完成）

- Electron + Vue 3 + TypeScript + Vite + Pinia。
- 安全 BrowserWindow、preload 和白名单 IPC。
- better-sqlite3 存储连接资产与分组。
- 紧凑型 Connection Explorer、Workspace、Status Bar。
- 新增、编辑、删除、收藏和搜索连接的本地 UI。
- lint、typecheck、tests、build 可运行。

验收：应用能启动；重启后连接资产仍存在；Renderer 不能直接触达 Node API；构建产物可加载。

## Phase 1 — Connection Manager（已完成）

- 完整连接 CRUD、分组、复制、收藏和拖动排序。
- 系统钥匙串凭据引用。
- 连接测试、错误码和最近连接。
- 中英文界面切换（本地记忆语言偏好）。
- Windows / macOS 快捷键和系统凭据加密兼容。

## Phase 2 — SSH（基础能力已完成）

- `ssh2` SSHService 和白名单 IPC。
- xterm.js Terminal、输入输出、resize、UTF-8、断开和重连。
- 密码和 Private Key 凭据从系统加密存储读取。
- 当前限制：Private Key 口令仍属于后续认证能力迭代。

## Phase 3 — SSH 稳定性（已完成）

- Host Key 指纹确认和变更阻断。
- 超时、重连、心跳、资源释放和标准错误码。
- 同一 SSH / 数据库资产可打开多个独立 Workspace Tab；数据库网络会话随 Phase 6–8 Adapter 接入。
- SSH 终端选中文本后支持右键复制；连接分组支持折叠和更清晰的字号。

## Phase 4 — SFTP、串口与私钥文件（已完成）

- 目录浏览、进入、返回、刷新、上传、下载、mkdir、重命名、删除。
- 多文件选择和本地文件拖动上传、传输进度、中文文件名与权限错误反馈。
- 串口设备枚举、波特率配置、连接测试、终端输入输出、断开和重连。
- OpenSSH、PEM、PKCS#8、PuTTY PPK 私钥文件选择、格式校验与系统加密保存。
- 当前限制：加密私钥口令后续补齐。

## Phase 5 — Transfer Manager（已完成）

- 本地文件/文件夹递归上传和远程文件/文件夹递归下载，保留相对目录结构。
- 双并发文件队列、实时进度与速度、排队状态和完成记录。
- 运行中或排队任务暂停/继续、取消，失败或取消任务从头重试。
- 上传与下载批量冲突检测、覆盖确认，以及目录阻塞和跨平台文件名冲突保护。
- 单次最多 5000 个文件、100 层目录，并限制 Renderer 进度事件频率。

## Phase 6 — MySQL（已完成）

- MySQL DatabaseAdapter、加密凭据读取、独立数据库 Session 和真实认证测试。
- 数据库、表、视图和字段 Explorer，支持双击表生成预览查询。
- CodeMirror MySQL SQL Editor，支持选中执行和 `Ctrl/⌘ + Enter` 快捷键。
- Result Grid、影响行数、耗时、错误映射，以及 `SELECT`/`WITH` 服务端分页。
- 单页默认 200 行、最大 500 行、SQL 最大 1 MB、查询 30 秒超时和单 Session 串行保护。

## Phase 7 — PostgreSQL（已完成）

- PostgresAdapter、SSL、游标分页、SSH Tunnel，不修改数据库 UI 主体。

## Phase 8 — SQLite

- 打开本地 `.db` 文件、只读查询、表结构和导出。

## Phase 9 — Workspace 完善

- Tab 恢复、固定/批量关闭、Split View、快捷键、最近连接。

## Phase 10 — 发布

- Windows 10/11 EXE、macOS DMG、Linux AppImage。
- 每个 Phase 都必须通过 lint、typecheck、tests、build，并完成真实连接验收。
