import { createTimeline } from 'animejs'

/** Everything the scroll timeline drives. Camera + dissolve + atmosphere. */
export interface Rig {
  z: number
  y: number
  lookY: number
  R: number // dissolve radius around the viewer
  dust: number
  exp: number
  fog: number
  nav: number // 0 = warm cathedral void, 1 = cool deep-space void
  portal: number // 0..1 portal fade-in
  glow: number // 0..1 portal brightness: dim at first, strongest up close
}

export const TEXT_END = 45000 // floating-text scene fills the void between cathedral and portal
const CROSS = 7000 // final crossing to the portal
export const TOTAL = TEXT_END + CROSS // ms of timeline, mapped 0..1 onto scroll progress

export const createRig = (): Rig => ({ z: 2, y: 1.6, lookY: 3.0, R: 0, dust: 0, exp: 1.0, fog: 0.012, nav: 0, portal: 0, glow: 0 })

/** Paused anime.js timeline; scrub it with `seek(progress * TOTAL)`. */
export function createRigTimeline(rig: Rig) {
  const tl = createTimeline({ autoplay: false, defaults: { ease: 'linear' } })
    .add(rig, { z: -30, duration: 8000, ease: 'inOutSine' }, 0) // up the aisle to the altar
    .add(rig, { z: -42, duration: 2000, ease: 'linear' }, 8000) // on into the void
    .add(rig, { z: -54, duration: TEXT_END - 10000, ease: 'linear' }, 10000) // slow drift while the words float by
    .add(rig, { z: -70, duration: CROSS, ease: 'linear' }, TEXT_END) // across the void toward the portal
    .add(rig, { y: 3.4, lookY: 2.0, duration: 4500, ease: 'inOutSine' }, 5500) // eyes lift as the walls go
    .add(rig, { y: 3.1, lookY: 2.8, duration: CROSS, ease: 'inOutSine' }, TEXT_END) // settle on the gate
    .add(rig, { R: 60, duration: 7000, ease: 'inSine' }, 2500) // dissolution radius
    .add(rig, { R: 140, duration: 3000, ease: 'linear' }, 9500) // keep the cathedral gone as we travel on
    .add(rig, { fog: 0.004, exp: 1.25, duration: 4000, ease: 'inOutSine' }, 6000)
    .add(rig, { dust: 1, duration: 3500, ease: 'inOutSine' }, 5000)
    .add(rig, { nav: 1, duration: 3500, ease: 'inOutSine' }, 10000) // void turns from ember-black to deep blue
    .add(rig, { portal: 1, duration: 4500, ease: 'inOutSine' }, TEXT_END - 5500) // the portal fades in
    .add(rig, { glow: 1, duration: 5500, ease: 'inQuad' }, TEXT_END - 5500) // ...dim at first, blazing as we close in
  tl.seek(0)
  return tl
}
