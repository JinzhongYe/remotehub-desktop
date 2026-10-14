package com.cbgif.remotehub

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.doOnAttach

class MainActivity : TauriActivity() {
  private var hubWebView: WebView? = null
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onResume() {
    super.onResume()
    hubWebView?.post { hubWebView?.evaluateJavascript("window.dispatchEvent(new Event('remotehub:resume'))", null) }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    hubWebView = webView
    webView.doOnAttach {
      // WebView padding does not offset the HTML viewport; lay out its container instead.
      val content = findViewById<View>(android.R.id.content)
      ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
        val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        val safe = insets.getInsets(types)
        view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
        WindowInsetsCompat.Builder(insets).setInsets(types, Insets.NONE).build()
      }
      ViewCompat.requestApplyInsets(content)
    }
  }
}
