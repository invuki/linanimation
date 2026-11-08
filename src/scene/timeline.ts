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
  white: number // 0..1 white-out overlay while passing through the portal
  marsh: number // 0/1 marsh scene on (switched while the screen is white)
  rain: number // 0..1 soft rain, fades in as the white clears
}

export const TEXT_END = 45000 // floating-text scene fills the void between cathedral and portal
const CROSS = 7000 // final crossing to the portal
const START = TEXT_END + CROSS
const ENTER = 20000 // through the portal, then the white slowly clears onto the marsh
export const NARRATION = START + ENTER // the narrator returns once the white has cleared onto the marsh
export const ASK_SHOW = NARRATION + 13200 // the yes/no choice appears once the question has typed
export const ASK_LOCK = NARRATION + 14000 // scroll is held here until the user answers
export const ANSWERED = NARRATION + 19500 // after answering we glide on to here (response line has typed by then)
export const TOTAL = NARRATION + 46000 // ms of timeline, mapped 0..1 onto scroll progress

export const createRig = (): Rig => ({ z: 2, y: 1.6, lookY: 3.0, R: 0, dust: 0, exp: 1.0, fog: 0.012, nav: 0, portal: 0, glow: 0, white: 0, marsh: 0, rain: 0 })

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
    .add(rig, { z: [-70, -96], duration: 11000, ease: 'linear' }, START) // through the opening
    .add(rig, { z: [-96, -99], duration: 9000, ease: 'outSine' }, START + 11000) // a slow drift once on the other side
    .add(rig, { white: [0, 1], duration: 3000, ease: 'inQuad' }, START + 6500) // the opening fills the view
    .add(rig, { portal: [1, 0], duration: 600, ease: 'linear' }, START + 10000) // gate vanishes behind the white
    .add(rig, { marsh: [0, 1], duration: 500, ease: 'linear' }, START + 10500) // swap scenes while fully white
    .add(rig, { lookY: [2.8, 0.1], y: [3.1, 1.5], duration: 9000, ease: 'inOutSine' }, START + 5000) // drops to a low, cinematic eye line: horizon on the upper third
    .add(rig, { exp: [1.25, 1.0], duration: 8000, ease: 'inOutSine' }, START + 12000) // Blender's exposure is 0 (= 1.0)
    .add(rig, { rain: [0, 1], duration: 9000, ease: 'inOutSine' }, START + 13000) // rain comes in gently once the marsh is visible
    .add(rig, { white: [1, 0], duration: 8000, ease: 'inOutSine' }, START + 12000) // the white slowly fades into the marsh
  tl.seek(0)
  return tl
}
