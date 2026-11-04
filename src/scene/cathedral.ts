import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { createPortal } from './portal'
import { createGlassMaterial, patch, U } from './dissolve'
import type { Rig } from './timeline'

const VOID = 0x070403
const VOID_COOL = 0x02040d // the void once the cathedral is gone and the portal is near
const DUST_WARM = 0xffc58a
const DUST_COOL = 0x9cc4ff
const LOOK_YAW = THREE.MathUtils.degToRad(15) // look-around limits: 15deg left/right, 15deg up
const LOOK_UP = THREE.MathUtils.degToRad(15)
// response curve: gentle through the middle of the screen, full range only near the edges
const ease = (v: number) => Math.sign(v) * Math.abs(v) ** 2.6

/** Builds the cathedral scene on `canvas`. Call `dispose()` on unmount (StrictMode mounts twice). */
export function createCathedral(canvas: HTMLCanvasElement, onLoaded: () => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(VOID)
  const fog = new THREE.FogExp2(VOID, 0.012)
  scene.fog = fog

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400)

  // post: bloom only matters once the portal is on screen; tone mapping moves to OutputPass
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.7, 0.85)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const portal = createPortal(scene)
  const bgWarm = new THREE.Color(VOID), bgCool = new THREE.Color(VOID_COOL)
  const dustWarm = new THREE.Color(DUST_WARM), dustCool = new THREE.Color(DUST_COOL)
  let cathedralRoot: THREE.Object3D | null = null

  // look-around: mouse/pen only (touch drags are scrolling)
  const look = { x: 0, y: 0, yaw: 0, pitch: 0 }
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    look.x = (e.clientX / window.innerWidth) * 2 - 1
    look.y = (e.clientY / window.innerHeight) * 2 - 1
  }
  const onLeave = () => { look.x = 0; look.y = 0 }
  window.addEventListener('pointermove', onPointer)
  document.addEventListener('mouseleave', onLeave)
  const lookQ = new THREE.Quaternion(), lookE = new THREE.Euler(0, 0, 0, 'YXZ')
  let lastT = 0

  // lights (glTF is Y-up: blender (x,y,z) -> (x,z,-y))
  scene.add(new THREE.HemisphereLight(0x6b4a2a, 0x120a05, 0.1))
  const key = new THREE.SpotLight(0xffa24d, 1300, 0, 0.75, 1, 1.6)
  key.position.set(0, 9, -27)
  key.target.position.set(0, 0, -2)
  scene.add(key, key.target)
  for (const z of [-3, -17]) {
    const p = new THREE.PointLight(0xffb070, 50, 0, 1.6)
    p.position.set(0, 12, z)
    scene.add(p)
  }
  const lamp = new THREE.PointLight(0xffc080, 35, 16, 1.8) // travels with the viewer
  scene.add(lamp)

  // dust: the void's only inhabitants
  const DUST = 1800
  const dpos = new Float32Array(DUST * 3)
  for (let i = 0; i < DUST; i++) {
    dpos[i * 3] = (Math.random() - 0.5) * 60
    dpos[i * 3 + 1] = (Math.random() - 0.5) * 28 + 3
    dpos[i * 3 + 2] = (Math.random() - 0.5) * 70
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3))
  const dustMat = new THREE.PointsMaterial({
    color: 0xffc58a, size: 0.07, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const dust = new THREE.Points(dustGeo, dustMat)
  scene.add(dust)

  // model
  const glassMat = createGlassMaterial()
  let disposed = false
  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}cathedral.glb`,
    (gltf) => {
      if (disposed) return
      const seen = new Set<THREE.Material>()
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const m = o.material as THREE.MeshStandardMaterial
        if (m.name.startsWith('Glass')) { o.material = glassMat; return }
        if (m.name === 'Flame') {
          const flame = new THREE.MeshBasicMaterial({ color: 0xffb050 })
          patch(flame, { glow: false })
          o.material = flame
          return
        }
        if (seen.has(m)) return
        seen.add(m)
        m.side = THREE.DoubleSide
        if (m.name === 'Floor') { m.roughness = 0.2; patch(m, { floor: true }) } else patch(m)
      })
      cathedralRoot = gltf.scene
      scene.add(gltf.scene)
      onLoaded()
    },
    undefined,
    (e) => console.error('cathedral.glb failed to load', e),
  )

  function resize() {
    const w = window.innerWidth, h = window.innerHeight
    renderer.setSize(w, h, false)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.fov = w / h < 1 ? 72 : 52
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  /** Draw one frame. `t` is seconds. */
  function frame(t: number, rig: Rig) {
    camera.position.set(Math.sin(t * 0.4) * 0.05, rig.y + Math.sin(t * 0.9) * 0.015, rig.z)
    camera.lookAt(0, rig.lookY, rig.z - 18)
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t
    const k = 1 - Math.exp(-dt * 4)
    look.yaw += (-ease(look.x) * LOOK_YAW - look.yaw) * k
    look.pitch += (ease(Math.max(0, -look.y)) * LOOK_UP - look.pitch) * k
    lookE.set(look.pitch, look.yaw, 0)
    camera.quaternion.multiply(lookQ.setFromEuler(lookE))
    lamp.position.copy(camera.position)
    U.uCam.value.copy(camera.position)
    U.uR.value = rig.R
    U.uTime.value = t
    fog.density = rig.fog
    renderer.toneMappingExposure = rig.exp
    dust.position.set(0, 0, rig.z)
    dust.rotation.y = t * 0.01
    dustMat.opacity = rig.dust * 0.85
    dustMat.color.copy(dustWarm).lerp(dustCool, rig.nav)
    ;(scene.background as THREE.Color).copy(bgWarm).lerp(bgCool, rig.nav)
    fog.color.copy(scene.background as THREE.Color)
    if (cathedralRoot) cathedralRoot.visible = rig.R < 130
    portal.update(t, rig)
    bloom.strength = 0.35 * rig.portal * (0.1 + 0.9 * rig.glow)
    bloom.enabled = rig.portal > 0.02
    composer.render()
  }

  function dispose() {
    disposed = true
    window.removeEventListener('resize', resize)
    window.removeEventListener('pointermove', onPointer)
    document.removeEventListener('mouseleave', onLeave)
    portal.dispose()
    composer.dispose()
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose()
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
      }
    })
    glassMat.dispose()
    renderer.dispose()
  }

  return { frame, dispose }
}
