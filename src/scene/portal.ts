import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Rig } from './timeline'

// Shared fade: fragments are stochastically discarded below this value, so the portal
// dissolves in out of the void (same visual language as the cathedral dissolving away).
const FADE = { value: 0 }

const RIBBONS = [0x4066ff, 0x7a4dff, 0xff7340, 0xff4d99, 0x33ccff, 0xe6ebff]
const GLOW = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k)
const OPENING = GLOW(0xc4dcff, 1) // unit colour of the portal opening; scaled by glow

function fadeable<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = FADE
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace(
        'void main() {',
        'void main() {\nif (uFade < 1.0 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453) > uFade) discard;',
      )
  }
  mat.customProgramCacheKey = () => 'portalfade'
  return mat
}

const stone = (hex?: number) =>
  fadeable(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.04, vertexColors: hex === undefined, color: hex ?? 0xffffff }))

function makeMaterial(name: string): THREE.Material {
  if (name === 'IslandRock' || name === 'Rock' || name === 'GateStone') return stone()
  if (name === 'Inlay') return fadeable(new THREE.MeshBasicMaterial({ color: GLOW(0x66e8ff, 2.2) }))
  if (name === 'Gem') return fadeable(new THREE.MeshBasicMaterial({ color: GLOW(0x40ffb0, 1.8) }))
  if (name === 'Glow') return fadeable(new THREE.MeshBasicMaterial({ color: OPENING.clone(), side: THREE.DoubleSide }))
  const r = /^Ribbon(\d)$/.exec(name)
  if (r) {
    const m = fadeable(new THREE.MeshBasicMaterial({ color: GLOW(RIBBONS[Number(r[1])] ?? 0xffffff, 2.4) }))
    m.userData.base = m.color.clone()
    return m
  }
  return stone(0x0b1a30) // panels etc.
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

interface Drifter {
  obj: THREE.Object3D
  base: THREE.Vector3
  rot: THREE.Euler
  ph: number[]
  sp: number
  spin: THREE.Vector3
}

/** The portal island: loaded once, placed far down the void, faded in by `rig.portal`. */
export function createPortal(scene: THREE.Scene, onReady?: () => void) {
  const root = new THREE.Group()
  root.position.set(0, -1.2, -96)
  root.scale.setScalar(1.7)
  root.visible = false
  scene.add(root)

  const lamp = new THREE.PointLight(0x9fd0ff, 0, 0, 1.4) // light spilling out of the opening
  lamp.position.set(0, 2.2, 2.2)
  const back = new THREE.PointLight(0x6a7cff, 0, 0, 1.4) // cool rim from behind
  back.position.set(0, 4, -8)
  root.add(lamp, back)

  const tex = glowTexture()
  const haze = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0x5d86ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }))
  haze.scale.setScalar(24)
  haze.position.set(0, 3, -1.5)
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xcfe2ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }))
  core.scale.set(5, 7, 1)
  core.position.set(0, 2.4, 0.9)
  root.add(haze, core)

  const drifters: Drifter[] = []
  const materials = new Map<string, THREE.Material>()
  let opening: THREE.MeshBasicMaterial | null = null
  const ribbons: THREE.MeshBasicMaterial[] = []
  let disposed = false

  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}portal.glb`,
    (gltf) => {
      if (disposed) return
      const model = gltf.scene
      model.position.y = -1.535 // gate's ground level -> root origin
      model.rotation.y = 0.384 // undo the gate's 22deg yaw so it faces the approach
      let i = 0
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const src = o.material as THREE.Material
        let m = materials.get(src.name)
        if (!m) { m = makeMaterial(src.name); materials.set(src.name, m) }
        if (src.name === 'Glow') opening = m as THREE.MeshBasicMaterial
        else if (/^Ribbon\d$/.test(src.name) && !ribbons.includes(m as THREE.MeshBasicMaterial)) ribbons.push(m as THREE.MeshBasicMaterial)
        o.material = m
        if (/^(Mini_|Frag)/.test(o.name)) {
          const k = i++
          const f = (n: number) => Math.abs(Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1
          drifters.push({
            obj: o,
            base: o.position.clone(),
            rot: o.rotation.clone(),
            ph: [f(1) * 6.28, f(2) * 6.28, f(3) * 6.28],
            sp: 0.6 + f(4) * 0.8,
            spin: new THREE.Vector3(f(5) - 0.5, f(6) - 0.5, f(7) - 0.5).multiplyScalar(0.18),
          })
        }
      })
      root.add(model)
      onReady?.()
    },
    undefined,
    (e) => console.error('portal.glb failed to load', e),
  )

  /** Per frame: fade + the little asteroids' slow wander. */
  function update(t: number, rig: Rig) {
    const f = rig.portal
    FADE.value = f
    root.visible = f > 0.002
    if (!root.visible) return
    const g = 0.06 + 0.94 * rig.glow // glow strength: a faint ember when it appears, full blaze up close
    lamp.intensity = 18 * f * g
    back.intensity = 9 * f * g
    ;(haze.material as THREE.SpriteMaterial).opacity = 0.13 * f * g
    ;(core.material as THREE.SpriteMaterial).opacity = 0.15 * f * g
    if (opening) opening.color.copy(OPENING).multiplyScalar(0.25 + 1.45 * g)
    for (const r of ribbons) r.color.copy(r.userData.base).multiplyScalar(0.35 + 0.65 * g)
    for (const d of drifters) {
      const a = t * d.sp * 0.35
      d.obj.position.set(
        d.base.x + Math.sin(a + d.ph[0]) * 0.32,
        d.base.y + Math.sin(a * 0.8 + d.ph[1]) * 0.26,
        d.base.z + Math.sin(a * 0.65 + d.ph[2]) * 0.32,
      )
      d.obj.rotation.set(d.rot.x + t * d.spin.x, d.rot.y + t * d.spin.y, d.rot.z + t * d.spin.z)
    }
  }

  function dispose() {
    disposed = true
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    for (const m of materials.values()) m.dispose()
    haze.material.dispose()
    core.material.dispose()
    tex.dispose()
  }

  return { update, dispose }
}
