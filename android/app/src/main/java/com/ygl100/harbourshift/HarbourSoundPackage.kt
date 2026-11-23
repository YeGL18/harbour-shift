package com.ygl100.harbourshift

import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class HarbourSoundPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(HarbourSoundModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

/** Short, bundled game cues. No network, microphone or notification permission. */
class HarbourSoundModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val main = Handler(Looper.getMainLooper())
  private val pool = SoundPool.Builder().setMaxStreams(24).setAudioAttributes(
    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
  ).build()
  private var offerId = 0
  private var acceptId = 0
  private var hornId = 0
  private val hornStreams = mutableMapOf<String, Int>()
  private val hornGains = mutableMapOf<String, Float>()
  private val hornStarted = mutableMapOf<String, Long>()
  private val hornStops = mutableMapOf<String, Runnable>()
  private val hornLeases = mutableMapOf<String, Runnable>()
  private var offerStream = 0
  private var acceptStream = 0
  private var wantOffer = false
  private var wantAccept = false
  private val cueNames = setOf("tap", "select", "open", "pause", "resume", "park", "rest", "service", "complete", "cancel", "error", "event")
  private val cueIds = mutableMapOf<String, Int>()
  private var cueStream = 0
  private var pendingCue: String? = null
  private var pendingCueAt = 0L
  private var acceptUntil = 0L
  private var enabled = true
  private var active = true
  private var released = false
  private val loaded = mutableSetOf<Int>()

  init {
    context.addLifecycleEventListener(this)
    pool.setOnLoadCompleteListener { _, id, status -> main.post {
      if (!released && status == 0) {
        loaded.add(id)
        if (id == offerId && wantOffer) startOffer()
        if (id == acceptId && wantAccept) startAccept()
        if (id == hornId) for (key in hornGains.keys.toList()) startHornNow(key, hornGains[key] ?: 0f)
        val cue = pendingCue
        if (cue != null && cueIds[cue] == id) {
          if (SystemClock.uptimeMillis() - pendingCueAt <= 250) startCue(cue)
          else pendingCue = null
        }
      }
    } }
    val offerResource = context.resources.getIdentifier("harbour_offer", "raw", context.packageName)
    val acceptResource = context.resources.getIdentifier("harbour_accept", "raw", context.packageName)
    if (offerResource != 0) offerId = pool.load(context, offerResource, 1)
    if (acceptResource != 0) acceptId = pool.load(context, acceptResource, 1)
    val hornResource = context.resources.getIdentifier("harbour_horn", "raw", context.packageName)
    if (hornResource != 0) hornId = pool.load(context, hornResource, 1)
    for (name in cueNames) {
      val resource = context.resources.getIdentifier("harbour_$name", "raw", context.packageName)
      if (resource != 0) cueIds[name] = pool.load(context, resource, 1)
    }
  }
  override fun getName() = "HarbourSound"
  private fun startOffer() {
    if (!enabled || !active || released || offerStream != 0 || !loaded.contains(offerId)) return
    stopCueNow()
    offerStream = pool.play(offerId, .65f, .65f, 2, -1, 1f)
    Log.i("HarbourSound", "offer stream=$offerStream")
  }
  private fun stopOfferNow() { wantOffer = false; if (!released && offerStream != 0) pool.stop(offerStream); offerStream = 0 }
  private fun startAccept() {
    if (!enabled || !active || released || !loaded.contains(acceptId)) return
    wantAccept = false
    stopCueNow()
    if (acceptStream != 0) pool.stop(acceptStream)
    acceptStream = pool.play(acceptId, .7f, .7f, 3, 0, 1f)
    acceptUntil = SystemClock.uptimeMillis() + 600
    Log.i("HarbourSound", "accepted stream=$acceptStream")
  }
  private fun stopCueNow() { pendingCue = null; if (!released && cueStream != 0) pool.stop(cueStream); cueStream = 0 }
  private fun startCue(name: String) {
    if (!enabled || !active || released || name !in cueNames) return
    if (name == "pause") stopOfferNow()
    if (offerStream != 0 || SystemClock.uptimeMillis() < acceptUntil) { pendingCue = null; return }
    val id = cueIds[name] ?: return
    if (!loaded.contains(id)) return
    stopCueNow()
    cueStream = pool.play(id, .35f, .35f, 1, 0, 1f)
    if (name == "pause" || name == "resume") Log.i("HarbourSound", "cue=$name stream=$cueStream")
  }
  @ReactMethod fun playCue(name: String) { main.post {
    if (name !in cueNames || !enabled || !active || released) return@post
    pendingCue = name; pendingCueAt = SystemClock.uptimeMillis(); startCue(name)
  } }
  private fun stopHornNow(id: String) {
    hornStops.remove(id)?.let { main.removeCallbacks(it) }
    hornLeases.remove(id)?.let { main.removeCallbacks(it) }
    hornGains.remove(id); hornStarted.remove(id)
    hornStreams.remove(id)?.let { if (!released) pool.stop(it) }
  }
  private fun stopAllHornsNow() { for (id in (hornStreams.keys + hornGains.keys).toSet()) stopHornNow(id) }
  private fun startHornNow(id: String, gain: Float) {
    if (!enabled || !active || released) return
    hornStops.remove(id)?.let { main.removeCallbacks(it) }
    hornLeases.remove(id)?.let { main.removeCallbacks(it) }
    hornGains[id] = gain
    val existing = hornStreams[id]
    if (existing != null) pool.setVolume(existing, .27f * gain, .27f * gain)
    else if (loaded.contains(hornId)) {
      if (hornStreams.size >= 16) hornStreams.keys.firstOrNull()?.let { stopHornNow(it) }
      val stream = pool.play(hornId, .27f * gain, .27f * gain, 2, -1, 1f)
      if (stream != 0) { hornStreams[id] = stream; hornStarted[id] = SystemClock.uptimeMillis(); Log.i("HarbourSound", "horn start stream=$stream") }
    }
    val lease = Runnable { stopHornNow(id) }; hornLeases[id] = lease; main.postDelayed(lease, 5000)
  }
  @ReactMethod fun startHorn(id: String, gain: Double) { main.post {
    if (!id.matches(Regex("[A-Za-z0-9:_-]{1,160}")) || !gain.isFinite()) return@post
    startHornNow(id, gain.coerceIn(0.0, 1.0).toFloat())
  } }
  @ReactMethod fun stopHorn(id: String) { main.post {
    val remaining = 300L - (SystemClock.uptimeMillis() - (hornStarted[id] ?: 0L))
    if (remaining > 0 && hornStreams.containsKey(id)) {
      hornStops.remove(id)?.let { main.removeCallbacks(it) }
      val stop = Runnable { stopHornNow(id) }; hornStops[id] = stop; main.postDelayed(stop, remaining)
    } else stopHornNow(id)
  } }
  @ReactMethod fun stopAllHorns() { main.post { stopAllHornsNow() } }
  @ReactMethod fun playOffer() { main.post { wantOffer = true; startOffer() } }
  @ReactMethod fun stopOffer() { main.post { stopOfferNow() } }
  @ReactMethod fun playAccepted() { main.post { stopOfferNow(); wantAccept = true; startAccept() } }
  @ReactMethod fun setEnabled(value: Boolean) { main.post {
    enabled = value
    if (!value) { stopAllHornsNow(); stopOfferNow(); stopCueNow(); wantAccept = false; if (!released && acceptStream != 0) pool.stop(acceptStream); acceptStream = 0; acceptUntil = 0L }
  } }
  override fun onHostResume() { main.post { active = true } }
  override fun onHostPause() { main.post { active = false; stopAllHornsNow(); stopOfferNow(); stopCueNow(); wantAccept = false; if (!released && acceptStream != 0) pool.stop(acceptStream); acceptStream = 0; acceptUntil = 0L } }
  override fun onHostDestroy() { onHostPause() }
  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    main.post { if (!released) { stopAllHornsNow(); stopOfferNow(); stopCueNow(); pool.release(); released = true } }
    super.invalidate()
  }
}
