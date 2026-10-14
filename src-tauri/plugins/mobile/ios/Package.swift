// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-remotehub-mobile",
  platforms: [.iOS(.v14)],
  products: [.library(name: "tauri-plugin-remotehub-mobile", type: .static, targets: ["tauri-plugin-remotehub-mobile"])],
  dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
  targets: [.target(name: "tauri-plugin-remotehub-mobile", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
