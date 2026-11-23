package com.ygl100.harbourshift

import android.os.Build
import android.view.RoundedCorner
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ViewManager

class ScreenCornersPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ScreenCornersModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

/** Public Android 12+ window metrics only; no guessed device model or hidden resources. */
class ScreenCornersModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "HarbourScreenCorners"

  @ReactMethod
  fun getMetrics(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val result = Arguments.createMap()
      result.putBoolean("supported", false)
      result.putString("source", "unavailable")
      for (name in arrayOf("topLeft", "topRight", "bottomLeft", "bottomRight")) result.putDouble(name, 0.0)
      val window = reactApplicationContext.currentActivity?.window
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && window != null) {
        val insets = window.decorView.rootWindowInsets
        if (insets != null) {
          val density = window.decorView.resources.displayMetrics.density.toDouble()
          result.putBoolean("supported", true)
          result.putString("source", "android-window-insets")
          for ((name, position) in arrayOf(
            "topLeft" to RoundedCorner.POSITION_TOP_LEFT,
            "topRight" to RoundedCorner.POSITION_TOP_RIGHT,
            "bottomLeft" to RoundedCorner.POSITION_BOTTOM_LEFT,
            "bottomRight" to RoundedCorner.POSITION_BOTTOM_RIGHT,
          )) {
            // Null means no corner intersects this app window (including a square screen).
            result.putDouble(name, (insets.getRoundedCorner(position)?.radius ?: 0) / density)
          }
        }
      }
      promise.resolve(result)
    }
  }
}
