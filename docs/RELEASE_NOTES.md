# RemoteHub 0.1.0-beta.11

本次预发布合并上游 beta.10，并加入 Android/iOS 移动适配。下载产物由 GitHub Actions 构建，本次发布没有在本地执行检查或打包。

## 本次更新

- 修复云端 Android SDK 安装：不再请求已移除的旧 `tools` 包。beta.10 发布构建未完成，保留原标签，以 beta.11 重新发布。

- 增加 Tokyo Night、Tokyo Storm、Tokyo Light；手机通过顶部图标菜单选择主题。
- 修复 Android 状态栏和刘海遮挡。移动端缩小图标与按钮外框，保留至少 44px 点击区域。
- 标签栏只显示连接；点击左上角应用图标返回首页，连接快捷键与恢复行为同步更新。
- SSH 按会话分发输出，消费确认后继续读取，保留分段 UTF-8 字符；更新连接取消、关闭与重连处理。
- 服务器概览增加负载显示，当前可见终端定时刷新。
- 数据库编辑 SQL 遵循对应方言，CSV 默认防护电子表格公式，也可选择原始导出；修复 PostgreSQL 刷新与用户事务处理。
- SFTP 接受最多 10000 个文件的批量上传，传输列表每次显示 200 条，可继续加载；移动端保留安全覆盖处理。
- 加强桌面 IPC 与连接、文件安全处理，升级 Electron 44.4.5 及原生依赖。
- iOS 源码与工程同步更新，本次没有 iPhone 安装包。

## 选择下载文件

- Android 7.0+ ARM64：`android-arm64-test.apk`，测试签名、应用 ID `com.cbgif.remotehub.debug`，页面内置，无需电脑开发服务。
- Windows x64：`win-x64-setup.exe` 为安装版，`win-x64-portable.exe` 为免安装版。
- macOS Intel：`mac-x64.dmg`；Apple Silicon：`mac-arm64.dmg`。
- Linux x64：`linux-x86_64.AppImage`。
- 安装包自带运行时，无需另装 Node.js、npm 或 pnpm。

## 检查与限制

- 发布仅在 GitHub 的源码检查、全部桌面打包及离线启动检查、安卓构建成功后执行。云端构建不等于真机功能验收。
- Android 沿用固定测试签名，可覆盖升级此前使用相同签名的测试 APK；不适合上架应用商店。
- 移动端尚未支持 FTP、SQLite、数据库 SSH 隧道、本地 Shell、串口、目录传输与传输暂停/重试，也不提供系统级后台保活或断点续传。
- 真实连接、设备、横竖屏与软键盘效果仍需手动验收；批量文件导入需要足够缓存空间。
- Windows/macOS 沿用现有签名策略，没有付费发布证书或 Apple Developer ID 公证，系统可能提示发布者未知。
- `SHA256SUMS.txt` 包含全部安装包的 SHA-256；校验值不等同于代码签名。
- 暂无自动更新服务，升级需手动下载安装。
