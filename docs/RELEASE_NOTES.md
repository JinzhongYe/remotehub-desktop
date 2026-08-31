# RemoteHub Desktop 0.1.0-beta.1

首个可下载安装的预发布版本，包含 Phase 0–9 功能以及 P10 三平台打包。

## 选择下载文件

- Windows 10/11 x64：`win-x64-setup.exe` 为安装版，`win-x64-portable.exe` 为免安装版。
- macOS Intel：`mac-x64.dmg`；Apple Silicon：`mac-arm64.dmg`。
- Linux x64：`linux-x64.AppImage`，赋予执行权限后运行。
- 无需另装 Node.js、npm 或 pnpm。安装包不包含个人连接、密码、私钥和数据库。

## 功能

SSH 多终端、SFTP 传输队列、串口、MySQL、PostgreSQL（直连/SSH 隧道）、本地只读 SQLite、单/双/四视图，以及 SQL 完整单元格与 JSON 格式化。

## 预发布说明

- 流水线通过 lint、类型检查、单元测试、构建和打包程序启动检查后才上传安装包。
- 自动启动检查覆盖离线 Renderer、preload IPC、临时 SQLite 查询及串口原生模块；不代表真实 SSH/SFTP、MySQL/PostgreSQL 或串口设备已全部验收。
- 本版本尚无 Windows 发布者证书和 Apple Developer ID 公证。系统可能提示发布者未知或阻止首次打开；请仅使用此仓库的下载包并核对 SHA-256，不要全局关闭系统安全机制。macOS 在确认来源后可使用系统“隐私与安全性”中的“仍要打开”。
- `SHA256SUMS.txt` 供文件完整性核对，不等同于代码签名。
- 免安装版仍将设置保存在当前用户的系统应用数据目录；不支持把已加密凭据直接移到另一台机器。
- 暂无自动更新；下载新版本后手动安装，卸载默认保留用户配置。
- 首次发布使用 beta 标记；真实环境验收和代码签名完成前不作为稳定版。
