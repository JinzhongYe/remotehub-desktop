# Android 构建

RemoteHub 使用 Tauri 2 的 Android 工程。生成目录是 `src-tauri/gen/android`，最低支持 Android 7.0（API 24）。

## 环境准备

安装以下工具：

- Node.js 22.12 或更高版本；
- Rust stable；
- Android Studio 及其自带的 JDK 21；
- Android SDK Platform 36、SDK Build-Tools、Platform-Tools 和 Command-line Tools；
- Android NDK 27.0.12077973。

在 Android Studio 的 SDK Manager 中安装 SDK 和 NDK，然后配置环境变量。macOS 示例：

```sh
export JAVA_HOME="/path/to/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
```

首次构建前安装依赖和 Rust Android targets：

```sh
npm ci
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

需要检查或调试原生工程时，用 Android Studio 打开 `src-tauri/gen/android`。

## 开发与调试构建

启动模拟器或连接已开启 USB 调试的设备，然后运行：

```sh
npm run android:dev
```

构建 Debug APK 和 AAB：

```sh
npm run android:build -- --debug
```

主要产物位于：

- APK：`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- AAB：`src-tauri/gen/android/app/build/outputs/bundle/universalDebug/app-universal-debug.aab`

只为常见 ARM64 设备构建可缩短等待时间：

```sh
npm run android:build -- --debug --target aarch64
```

## Release 构建

构建所有 ABI 的 Release APK 和 AAB：

```sh
npm run android:build
```

主要产物位于：

- 未签名 APK：`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`
- 已签名 APK：`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
- AAB：`src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`

未配置签名时，Release APK 文件名带有 `-unsigned`，不能直接发布。

## Release 签名

创建并妥善备份上传密钥；不要把密钥或密码提交到 Git：

```sh
keytool -genkey -v -keystore "$HOME/upload-keystore.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

创建 `src-tauri/gen/android/keystore.properties`：

```properties
password=密钥密码
keyAlias=upload
storeFile=/绝对路径/upload-keystore.jks
```

再次执行 `npm run android:build`。Gradle 检测到该文件后会签名 Release APK 和 AAB；仓库已忽略属性文件以及 `*.jks`、`*.keystore`。上传 Google Play 时建议启用 Play App Signing，并保存好上传密钥的离线备份。

环境与发布流程以 [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/)、[Android signing](https://v2.tauri.app/distribute/sign/android/) 和 [Google Play distribution](https://v2.tauri.app/distribute/google-play/) 为准。
