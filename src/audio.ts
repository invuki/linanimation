import type { Rig } from './scene/timeline'

// Procedural audio (no assets). Browsers block audio until a gesture, so nothing starts before the first one.
export function createAudio() {
  let ctx: AudioContext | null = null
  let warm: GainNode, cool: GainNode, air: GainNode, shimmer: GainNode, rainGain: GainNode, wind: GainNode
  let lastTick = 0
  let muted = false
  let master: GainNode
  let suspendTimer = 0

  const osc = (f: number, dest: AudioNode, lfoHz: number) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain(), l = ctx!.createOscillator(), lg = ctx!.createGain()
    o.frequency.value = f
    g.gain.value = 0.5
    l.frequency.value = lfoHz // slow swell so the drone breathes
    lg.gain.value = 0.25
    l.connect(lg).connect(g.gain)
    o.connect(g).connect(dest)
    o.start(); l.start()
  }

  const start = () => {
    if (ctx) return void (muted || ctx.resume())
    ctx = new AudioContext()
    if (muted) void ctx.suspend()
    master = ctx.createGain()
    master.gain.setValueAtTime(0, ctx.currentTime)
    master.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 4)
    master.connect(ctx.destination)
    const bus = (cut: number) => {
      const g = ctx!.createGain(), f = ctx!.createBiquadFilter()
      f.type = 'lowpass'; f.frequency.value = cut; g.gain.value = 0
      g.connect(f).connect(master)
      return g
    }
    warm = bus(500); cool = bus(900); shimmer = bus(2400)
    ;[55, 82.4, 110, 164.8].forEach((f, i) => osc(f, warm, 0.05 + i * 0.03)) // cathedral: low, stone-like
    ;[98, 147, 196, 293.7].forEach((f, i) => osc(f, cool, 0.04 + i * 0.025)) // void: higher, open fifths
    ;[392, 587.3, 784].forEach((f, i) => osc(f, shimmer, 0.07 + i * 0.04)) // portal: faint glow

    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter()
    n.buffer = buf; n.loop = true
    nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 0.6
    air = ctx.createGain(); air.gain.value = 0
    n.connect(nf).connect(air).connect(master)
    n.start()

    // marsh air: soft wind through the reeds, swelling slowly (replaces the drones once we arrive)
    const wn = ctx.createBufferSource(), wf = ctx.createBiquadFilter(), wl = ctx.createOscillator(), wlg = ctx.createGain(), gust = ctx.createGain()
    wn.buffer = buf; wn.loop = true; wn.playbackRate.value = 0.7
    wf.type = 'bandpass'; wf.frequency.value = 650; wf.Q.value = 0.35
    wind = ctx.createGain(); wind.gain.value = 0
    gust.gain.value = 0.65; wl.frequency.value = 0.09; wlg.gain.value = 0.35 // gusts: ~11 s swell between 0.3x and 1x
    wl.connect(wlg).connect(gust.gain)
    wn.connect(wf).connect(gust).connect(wind).connect(master)
    wn.start(); wl.start()

    // rain: the recorded loop, softened to sit inside the mist (no rumble, no harsh top end)
    const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = 140
    lp.type = 'lowpass'; lp.frequency.value = 9000
    rainGain = ctx.createGain(); rainGain.gain.value = 0
    hp.connect(lp).connect(rainGain).connect(master)
    const c = ctx
    void fetch(`${import.meta.env.BASE_URL}rain.mp3`)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .then((decoded) => {
        const src = c.createBufferSource()
        src.buffer = decoded; src.loop = true
        src.connect(hp); src.start()
      })
      .catch((e) => console.error('rain.mp3 failed to load', e))
  }

  const events = ['wheel', 'keydown', 'pointerdown', 'touchstart', 'touchend', 'click'] as const // iOS only unlocks audio on touchend/click
  events.forEach((e) => window.addEventListener(e, start, { passive: true }))

  return {
    /** Mix the layers from the rig each frame. */
    update(rig: Rig) {
      if (!ctx) return
      const t = ctx.currentTime
      warm.gain.setTargetAtTime(0.35 * (1 - rig.nav), t, 0.5)
      const music = 1 - rig.marsh // the drones give way entirely once we're in the marsh; only rain remains
      cool.gain.setTargetAtTime(0.3 * rig.nav * music, t, 1.2)
      air.gain.setTargetAtTime((0.03 + 0.05 * rig.dust) * music, t, 1.2)
      shimmer.gain.setTargetAtTime(0.18 * rig.glow * music, t, 1.2)
      rainGain.gain.setTargetAtTime(0.5 * rig.rain, t, 1.5) // rain fades in slowly as the white clears
      wind.gain.setTargetAtTime(0.06 * rig.marsh, t, 2.5)
    },
    /** Mute/unmute everything by suspending the context (works before the first gesture too). */
    setMuted(m: boolean) {
      muted = m
      if (!ctx) return
      const c = ctx
      window.clearTimeout(suspendTimer)
      master.gain.cancelScheduledValues(c.currentTime)
      master.gain.setValueAtTime(master.gain.value, c.currentTime)
      if (m) { // fade out, then suspend once silent
        master.gain.setTargetAtTime(0, c.currentTime, 0.18)
        suspendTimer = window.setTimeout(() => { if (muted) void c.suspend() }, 900)
      } else {
        void c.resume().then(() => master.gain.setTargetAtTime(0.35, c.currentTime, 0.3))
      }
    },
    /** Soft key tick; throttled so fast scrolling doesn't machine-gun. */
    tick() {
      if (!ctx || ctx.state !== 'running' || ctx.currentTime - lastTick < 0.04) return
      lastTick = ctx.currentTime
      const len = Math.floor(ctx.sampleRate * 0.02), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
      s.buffer = buf
      f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 1400; f.Q.value = 1.2
      g.gain.value = 0.085
      s.connect(f).connect(g).connect(ctx.destination)
      s.start()
    },
    dispose() {
      events.forEach((e) => window.removeEventListener(e, start))
      window.clearTimeout(suspendTimer)
      void ctx?.close()
    },
  }
}
