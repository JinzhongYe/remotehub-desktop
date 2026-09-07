# RemoteHub Desktop 0.1.0-beta.5

本次预发布修复 SSH 终端换行显示，并完善页面标签颜色、连接状态和分组排序体验。

## 本次更新

- 修复 SSH 终端内容的换行显示，改善中文标点在终端行中的排版。
- 页面标签文字和图标跟随资产颜色，顶部工作区文字跟随当前页面颜色，连接状态圆点独立显示。
- 分组支持拖动排序和键盘调整，顺序持久化且不改变资产归属。
- 保留 FTP、数据库、SQLite、串口、SFTP、SQL JSON 展开和多视图等既有功能。

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
