import type { Rig } from './scene/timeline'

// Procedural audio (no assets). Browsers block audio until a gesture, so nothing starts before the first one.
export function createAudio() {
  let ctx: AudioContext | null = null
  let warm: GainNode, cool: GainNode, air: GainNode, shimmer: GainNode
  let lastTick = 0

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
    if (ctx) return void ctx.resume()
    ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.setValueAtTime(0, ctx.currentTime)
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 4)
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
  }

  const events = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const
  events.forEach((e) => window.addEventListener(e, start, { passive: true }))

  return {
    /** Mix the layers from the rig each frame. */
    update(rig: Rig) {
      if (!ctx) return
      const t = ctx.currentTime
      warm.gain.setTargetAtTime(0.35 * (1 - rig.nav), t, 0.5)
      cool.gain.setTargetAtTime(0.3 * rig.nav, t, 0.5)
      air.gain.setTargetAtTime(0.03 + 0.05 * rig.dust, t, 0.5)
      shimmer.gain.setTargetAtTime(0.18 * rig.glow, t, 0.5)
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
      g.gain.value = 0.12
      s.connect(f).connect(g).connect(ctx.destination)
      s.start()
    },
    dispose() {
      events.forEach((e) => window.removeEventListener(e, start))
      void ctx?.close()
    },
  }
}
