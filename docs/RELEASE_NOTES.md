# RemoteHub Desktop 0.1.0-beta.4

本次预发布新增 FTP 文件工作区，并集中优化数据库、SFTP 与桌面交互体验。

## 本次更新

- 新增 FTP 连接、目录浏览、上传下载、新建目录、重命名和删除，并复用现有文件传输界面。
- 数据库工作区新增更完整的数据表浏览与编辑操作，改进表结构、筛选、排序、列宽、导入导出和多标签体验。
- SQLite 从只读查询扩展为支持写入及数据表编辑。
- 精简数据库工具栏和重复的结果统计；数据库连接成功后在工作区标签显示绿色状态点。
- 优化 SFTP/FTP 文件操作、覆盖确认、新建目录及应用退出等对话框。
- 改进连接错误文本、界面图标、浅色/深色主题和多处布局细节。

## 选择下载文件

- Windows 10/11 x64：`win-x64-setup.exe` 为安装版，`win-x64-portable.exe` 为免安装版。
- macOS Intel：`mac-x64.dmg`；Apple Silicon：`mac-arm64.dmg`。
- Linux x64：`linux-x64.AppImage`。
- 安装包自带运行时，无需另装 Node.js、npm 或 pnpm。

## 预发布说明

- 发布流水线会通过 lint、类型检查、单元测试、生产构建和打包后离线启动检查，再创建 GitHub 预发布版。
- 离线检查覆盖 Renderer、preload IPC、临时 SQLite、串口原生模块、本地 PTY 和应用图标；真实 SSH/SFTP/FTP、MySQL/PostgreSQL、在线监控与串口设备仍需目标环境验收。
- 当前 Windows 和 macOS 包尚未使用付费发布证书或 Apple Developer ID 公证，系统可能提示发布者未知或阻止首次打开。
- 请使用 `SHA256SUMS.txt` 核对文件完整性；校验值不等同于代码签名。
- 暂无自动更新，升级需手动下载安装；卸载默认保留用户配置。
