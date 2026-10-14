package com.cbgif.remotehub

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.UUID

@TauriPlugin
class AndroidFilesPlugin(private val activity: Activity) : Plugin(activity) {
  data class TextArgs(val text: String = "")
  data class CopyArgs(val uris: Array<String> = emptyArray())

  @Command
  fun copyText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(TextArgs::class.java)
      activity.runOnUiThread {
        try {
          val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
          clipboard.setPrimaryClip(ClipData.newPlainText("RemoteHub", args.text))
          invoke.resolve(JSObject())
        } catch (error: Exception) { invoke.reject(error.message ?: "Clipboard unavailable") }
      }
    } catch (error: Exception) { invoke.reject(error.message ?: "Clipboard unavailable") }
  }

  @Command
  fun readText(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(activity)?.toString() ?: ""
        invoke.resolve(JSObject().apply { put("text", text) })
      } catch (error: Exception) { invoke.reject(error.message ?: "Clipboard unavailable") }
    }
  }

  @Command
  fun copyFiles(invoke: Invoke) {
    Thread {
      val created = mutableListOf<File>()
      try {
        val uris = invoke.parseArgs(CopyArgs::class.java).uris
        require(uris.isNotEmpty() && uris.size <= 10000) { "Choose between 1 and 10000 files" }
        val files = uris.mapIndexed { index, value ->
          val uri = Uri.parse(value)
          require(uri.scheme == "content") { "Selected file is invalid" }
          val directory = File(activity.cacheDir, "sftp-uploads/${UUID.randomUUID()}").apply {
            check(mkdirs()) { "Could not prepare selected file" }
            created.add(this)
          }
          val output = File(directory, displayName(uri) ?: "upload-${index + 1}")
          activity.contentResolver.openInputStream(uri).use { input ->
            checkNotNull(input) { "Could not read selected file" }
            output.outputStream().use(input::copyTo)
          }
          output.absolutePath
        }
        invoke.resolve(JSObject().apply { put("files", JSArray.from(files.toTypedArray())) })
      } catch (error: Exception) {
        created.forEach(File::deleteRecursively)
        invoke.reject(error.message ?: "Could not prepare selected files", "ANDROID_FILE_ACCESS_FAILED", error)
      }
    }.start()
  }

  private fun displayName(uri: Uri): String? {
    val name = activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null).use { cursor ->
      if (cursor != null && cursor.moveToFirst()) cursor.getString(0) else null
    }
    return name?.takeIf { it.isNotBlank() && it.length <= 255 && it != "." && it != ".." && !it.contains('/') && !it.contains('\\') && !it.contains('\u0000') }
  }
}
