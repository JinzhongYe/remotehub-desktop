import Foundation
import Security
import Tauri
import UIKit
import WebKit

private struct KeyArgs: Decodable { let key: String }
private struct SecretArgs: Decodable { let key: String; let value: String }
private struct TextArgs: Decodable { let text: String }
private struct ExportArgs: Decodable { let path: String }

final class MobilePlugin: Plugin, UIDocumentPickerDelegate {
  private let service = "com.cbgif.remotehub.credentials.v1"
  private var exportInvoke: Invoke?
  private var resumeObserver: NSObjectProtocol?

  override func load(webview: WKWebView) {
    if let observer = resumeObserver { NotificationCenter.default.removeObserver(observer) }
    resumeObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak webview] _ in
      webview?.evaluateJavaScript("window.dispatchEvent(new Event('remotehub:resume'))", completionHandler: nil)
    }
  }

  deinit { if let observer = resumeObserver { NotificationCenter.default.removeObserver(observer) } }

  private func query(_ key: String) throws -> [String: Any] {
    guard key.range(of: "^connection/[0-9a-fA-F-]{36}/(credential|passphrase)$", options: .regularExpression) != nil else {
      throw NSError(domain: service, code: 1, userInfo: [NSLocalizedDescriptionKey: "Credential key is invalid"])
    }
    return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
  }

  private func requireSuccess(_ status: OSStatus) throws {
    if status != errSecSuccess {
      throw NSError(domain: service, code: Int(status), userInfo: [NSLocalizedDescriptionKey: SecCopyErrorMessageString(status, nil) as String? ?? "Keychain operation failed"])
    }
  }

  @objc public func get(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(KeyArgs.self)
    var attributes = try query(args.key)
    attributes[kSecReturnData as String] = true
    attributes[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(attributes as CFDictionary, &value)
    if status == errSecItemNotFound { invoke.resolve(["value": NSNull()]); return }
    try requireSuccess(status)
    guard let data = value as? Data, let text = String(data: data, encoding: .utf8) else {
      invoke.reject("Credential record is invalid"); return
    }
    invoke.resolve(["value": text])
  }

  @objc public func set(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SecretArgs.self)
    let attributes = try query(args.key)
    let data = Data(args.value.utf8)
    guard !data.isEmpty && data.count <= 256 * 1024 else { invoke.reject("Credential is invalid"); return }
    let changes = [kSecValueData as String: data] as CFDictionary
    var status = SecItemUpdate(attributes as CFDictionary, changes)
    if status == errSecItemNotFound {
      var item = attributes
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      status = SecItemAdd(item as CFDictionary, nil)
    }
    try requireSuccess(status)
    invoke.resolve()
  }

  @objc public func delete(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(KeyArgs.self)
    let status = SecItemDelete(try query(args.key) as CFDictionary)
    if status != errSecItemNotFound { try requireSuccess(status) }
    invoke.resolve()
  }

  @objc public func copyText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TextArgs.self)
    DispatchQueue.main.async { UIPasteboard.general.string = args.text; invoke.resolve(["ok": true]) }
  }

  @objc public func readText(_ invoke: Invoke) {
    DispatchQueue.main.async { invoke.resolve(["text": UIPasteboard.general.string ?? ""]) }
  }

  @objc public func exportFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ExportArgs.self)
    let source = URL(fileURLWithPath: args.path).standardizedFileURL.resolvingSymlinksInPath()
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath()
    guard source.path.hasPrefix(cache.path + "/"), FileManager.default.fileExists(atPath: source.path) else {
      invoke.reject("Export file is outside the application cache"); return
    }
    DispatchQueue.main.async {
      guard self.exportInvoke == nil, let controller = self.manager.viewController else {
        invoke.reject("A file export is already open or the application is unavailable"); return
      }
      self.exportInvoke = invoke
      let picker = UIDocumentPickerViewController(forExporting: [source], asCopy: true)
      picker.delegate = self
      controller.present(picker, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    exportInvoke?.resolve(["canceled": false])
    exportInvoke = nil
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    exportInvoke?.resolve(["canceled": true])
    exportInvoke = nil
  }
}

@_cdecl("init_plugin_remotehub_mobile")
func initPlugin() -> Plugin { MobilePlugin() }
