package com.cbgif.remotehub

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@TauriPlugin
class CredentialVaultPlugin(private val activity: Activity) : Plugin(activity) {
  data class KeyArgs(val key: String = "")
  data class SetArgs(val key: String = "", val value: String = "")

  private val alias = "remotehub.credentials.v1"
  private val prefs by lazy { activity.getSharedPreferences("remotehub.credentials", Activity.MODE_PRIVATE) }

  @Command
  fun set(invoke: Invoke) = protect(invoke) {
    val args = invoke.parseArgs(SetArgs::class.java)
    requireKey(args.key)
    require(args.value.toByteArray().size <= 256 * 1024) { "Credential is too large" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    cipher.updateAAD(args.key.toByteArray())
    val encoded = "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}.${Base64.encodeToString(cipher.doFinal(args.value.toByteArray()), Base64.NO_WRAP)}"
    check(prefs.edit().putString(args.key, encoded).commit()) { "Credential storage failed" }
    invoke.resolve()
  }

  @Command
  fun get(invoke: Invoke) = protect(invoke) {
    val key = invoke.parseArgs(KeyArgs::class.java).key
    requireKey(key)
    val encoded = prefs.getString(key, null)
    val result = JSObject()
    if (encoded == null) {
      result.put("value", null)
    } else {
      val parts = encoded.split('.', limit = 2)
      require(parts.size == 2) { "Credential record is invalid" }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
      cipher.updateAAD(key.toByteArray())
      result.put("value", String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP))))
    }
    invoke.resolve(result)
  }

  @Command
  fun delete(invoke: Invoke) = protect(invoke) {
    val key = invoke.parseArgs(KeyArgs::class.java).key
    requireKey(key)
    check(prefs.edit().remove(key).commit()) { "Credential deletion failed" }
    invoke.resolve()
  }

  private fun requireKey(key: String) {
    require(Regex("connection/[0-9a-fA-F-]{36}/(credential|passphrase)").matches(key)) { "Credential key is invalid" }
  }

  private fun secretKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    return generator.generateKey()
  }

  private inline fun protect(invoke: Invoke, block: () -> Unit) {
    try { block() } catch (error: Exception) {
      invoke.reject(error.message ?: "Credential store unavailable", "CREDENTIAL_STORE_UNAVAILABLE", error)
    }
  }
}
