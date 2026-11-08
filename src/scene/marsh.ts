import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { LOW_POWER } from '../quality'
import type { Rig } from './timeline'

// The marsh is exported from the Blender scene "Marsh" (public/marsh.glb) and lit/shaded to match Blender's render:
// same world-sky ramp, same dawn sun (direction + colour + strength), same material colours, AgX tone mapping.
// Blender's sun/world strengths are radiance-style, three's are irradiance-style, hence the PI factors below.
export const MARSH_CAM_Z = 2.8 // Blender camera sways around (0, -2.8, 1.5); glTF z = -y
export const MARSH_FOG = 0.02
export const MARSH_HAZE = new THREE.Color().setRGB(0.52, 0.6, 0.7, THREE.LinearSRGBColorSpace)
/** Blender camera: 35 mm lens on a 36 mm sensor, sensor fit auto (fits the longer side). */
export const marshFov = (aspect: number) => {
  const h = 2 * Math.atan(18 / 35) // 54.4 deg across the longer side
  return THREE.MathUtils.radToDeg(aspect >= 1 ? 2 * Math.atan(Math.tan(h / 2) / aspect) : h)
}
const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
const T = { value: 0 } // shared wind clock
const RAIN = { value: 0 }

/** Vertex sway, strongest at the tip (mirrors the Blender geometry-nodes wind). `h` = height that gives full weight. */
function sway<M extends THREE.Material>(mat: M, h: number, amp: number, fragment?: string): M {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = T
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT; varying float vH; varying vec3 vP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vH = position.y; vP = position;
float w = pow(max(position.y, 0.0) / ${h.toFixed(2)}, 2.0);
float g = sin(position.x * 0.25 + uT * 1.3) * 0.6;
transformed.x += (sin(uT * 1.1 + position.x * 0.9 + position.z * 0.7) * 0.5 + sin(uT * 0.73 + position.z * 1.3) * 0.3 + g) * ${amp.toFixed(3)} * w;
transformed.z += (sin(uT * 0.9 + position.z * 0.8 - position.x * 0.5) * 0.5 + cos(uT * 0.61 + position.x * 1.1) * 0.3) * ${amp.toFixed(3)} * w;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vP;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (fragment ?? ''))
  }
  mat.customProgramCacheKey = () => `marsh${h}${amp}${fragment?.length ?? 0}`
  return mat
}

function leafTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.beginPath()
  g.ellipse(32, 32, 14, 31, 0, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Blender's water: glossy IOR 1.333 reflecting the sky, three layers of moving ripples, rain rings. */
function water(env: THREE.Texture): THREE.Material {
  const m = new THREE.MeshPhysicalMaterial({ color: lin(0.012, 0.03, 0.035), roughness: 0.03, metalness: 0, ior: 1.333, envMap: env, envMapIntensity: 1.0 })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = T; sh.uniforms.uRain = RAIN
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uT; uniform float uRain; varying vec3 vW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vW.xz;
  vec2 d = vec2(0.0);
  d += vec2(cos(p.x * 0.9 + p.y * 0.3 + uT * 0.5), cos(p.y * 1.1 - p.x * 0.2 + uT * 0.4)) * 0.03;
  d += vec2(cos(p.x * 3.1 - p.y * 1.7 + uT * 1.3), cos(p.y * 2.7 + p.x * 1.9 + uT * 1.1)) * 0.02;
  d += vec2(cos(p.x * 9.0 + p.y * 5.0 + uT * 2.6), cos(p.y * 8.0 - p.x * 6.0 + uT * 2.2)) * 0.008;
  vec2 cell = floor(p / 1.1); vec2 q = fract(p / 1.1) - 0.5;
  float seed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float ph = fract(uT * 0.7 + seed * 7.0); vec2 c0 = vec2(fract(seed * 13.7), fract(seed * 5.3)) - 0.5;
  float r = length(q - c0 * 0.6); float ring = sin((r - ph * 0.35) * 60.0) * smoothstep(0.35, 0.0, abs(r - ph * 0.35)) * (1.0 - ph);
  d += normalize(q - c0 * 0.6 + 1e-4) * ring * 0.05 * uRain * step(0.35, seed);
  normal = normalize(normal + (viewMatrix * vec4(d.x, 0.0, d.y, 0.0)).xyz);
}`)
  }
  m.customProgramCacheKey = () => 'marshwater'
  return m
}

// Material colours are the Blender node values (linear).
function makeMaterial(name: string, leaf: THREE.Texture, env: THREE.Texture): THREE.Material {
  switch (name) {
    case 'GrassBlade':
      return sway(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), 0.7, 0.2,
        'diffuseColor.rgb = mix(vec3(0.012,0.03,0.018), vec3(0.13,0.21,0.11), smoothstep(0.0,0.7,vH)) * (0.8 + 0.5*fract(sin(dot(floor(vP.xz*0.6),vec2(12.9,78.2)))*43758.5));')
    case 'CottonHead':
      return sway(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, vertexColors: true, emissive: 0x7a8aa8, emissiveIntensity: 0.5 }), 0.7, 0.2)
    case 'Leaf': // Blender: noise ramp (0.012,0.03,0.02) -> (0.06,0.09,0.03)
      return sway(new THREE.MeshStandardMaterial({ map: leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, color: lin(0.04, 0.09, 0.035) }), 9, 0.1)
    case 'Birch': return new THREE.MeshStandardMaterial({ color: lin(0.3, 0.3, 0.27), roughness: 0.8 })
    case 'Pad': return new THREE.MeshStandardMaterial({ color: lin(0.02, 0.07, 0.03), roughness: 0.5, side: THREE.DoubleSide })
    case 'Trunk': return new THREE.MeshStandardMaterial({ color: lin(0.05, 0.045, 0.04), roughness: 0.9 })
    case 'Water': return water(env)
    case 'Hill': return new THREE.MeshStandardMaterial({ color: lin(0.03, 0.06, 0.09), roughness: 1 })
    case 'Ridge1': return new THREE.MeshStandardMaterial({ color: lin(0.03, 0.055, 0.08), roughness: 1 })
    case 'Ridge2': return new THREE.MeshStandardMaterial({ color: lin(0.05, 0.085, 0.12), roughness: 1 })
    default: return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }) // ground: Blender's baked mud-to-grass colours
  }
}

/** The marsh the portal opens onto. Hidden until `rig.marsh` > 0; wind runs on the GPU. */
export function createMarsh(scene: THREE.Scene, renderer: THREE.WebGLRenderer, anchorZ: number) {
  const root = new THREE.Group()
  root.position.set(0, 0, anchorZ - MARSH_CAM_Z)
  root.visible = false
  scene.add(root)

  // Blender sun: strength 2.2, colour (1, 0.82, 0.62), rotation (84, 0, 185) deg -> light travels (0.087, -0.991, -0.105) in
  // Blender axes, i.e. from far behind the field, a few degrees above the horizon. glTF axes: (x, z, -y).
  const sun = new THREE.DirectionalLight(lin(0.9, 0.9, 0.92), 1.4)
  sun.position.set(-0.087, 0.105, -0.991).multiplyScalar(40)
  root.add(sun)
  // Blender world: the sky ramp lights everything (ambient ~ cosine-weighted mean of the ramp); ground bounce is dark green.
  root.add(new THREE.HemisphereLight(lin(0.3, 0.4, 0.55), lin(0.06, 0.09, 0.07), 1.1))

  // sky dome = the Blender world node tree: ramp on direction z, (-0.05..0.55) -> horizon, 0.25 mid, 1.0 zenith. No sun disc.
  const skyMat = () => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD;
void main(){
  float k = clamp((vD.y + 0.05) / 0.6, 0.0, 1.0);
  vec3 c = mix(vec3(0.62,0.68,0.74), vec3(0.3,0.42,0.56), smoothstep(0.0,0.25,k));
  c = mix(c, vec3(0.07,0.14,0.26), smoothstep(0.25,1.0,k));
  gl_FragColor = vec4(c, 1.0);
}`,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), skyMat())
  sky.renderOrder = -10
  sky.frustumCulled = false
  scene.add(sky)
  sky.visible = false

  // drifting ground mist: two soft noise sheets just above the water line (Blender's low mist volume)
  const mistMat = (off: number) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uT: T, uOff: { value: off } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uT; uniform float uOff; varying vec3 vW;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = vW.xz * 0.045 + vec2(uT * 0.012 + uOff, uT * 0.006);
  float m = n(p) * 0.55 + n(p * 2.3 + 7.0) * 0.3 + n(p * 5.1) * 0.15;
  float d = distance(vW, cameraPosition);
  float a = smoothstep(0.42, 0.8, m) * smoothstep(1.5, 14.0, d) * (1.0 - smoothstep(110.0, 190.0, d)) * 0.5;
  gl_FragColor = vec4(0.74, 0.8, 0.88, a);
}`,
  })
  const mists = [0.4, 1.0].map((y, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), mistMat(i * 31))
    m.rotation.x = -Math.PI / 2; m.position.set(0, y, 90); m.renderOrder = 5; m.frustumCulled = false
    root.add(m); return m
  })

  // soft rain: thin streaks falling in a box that follows the camera
  const STREAKS = LOW_POWER ? 1800 : 5000
  const rp = new Float32Array(STREAKS * 6), rr = new Float32Array(STREAKS * 2)
  for (let i = 0; i < STREAKS; i++) {
    const x = (Math.random() - 0.5) * 36, y = Math.random() * 16, z = (Math.random() - 0.5) * 36
    rp.set([x, y, z, x, y, z], i * 6); rr[i * 2] = rr[i * 2 + 1] = Math.random()
  }
  const rg = new THREE.BufferGeometry()
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3))
  rg.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(STREAKS * 2).map((_, i) => i % 2), 1)) // 0 = streak head, 1 = tail
  rg.setAttribute('aRnd', new THREE.BufferAttribute(rr, 1))
  const rainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uT: T, uRain: RAIN, uCam: { value: new THREE.Vector3() } },
    vertexShader: `uniform float uT; uniform vec3 uCam; attribute float aEnd; attribute float aRnd; varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y - uT * (7.0 + aRnd * 2.0), 16.0);
  p.x += (p.y - 16.0) * -0.06; // slight slant
  p.xz += floor((uCam.xz - p.xz) / 36.0 + 0.5) * 36.0; // wrap around the camera
  p.y += aEnd * 0.45;
  vA = (1.0 - aEnd) * 0.6 + 0.1;
  vec4 mv = viewMatrix * vec4(p + vec3(0.0, uCam.y - 3.0, 0.0), 1.0);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: 'uniform float uRain; varying float vA; void main(){ gl_FragColor = vec4(0.82, 0.88, 0.95, vA * 0.3 * uRain); }',
  })
  const rain = new THREE.LineSegments(rg, rainMat)
  rain.frustumCulled = false; rain.renderOrder = 6
  scene.add(rain); rain.visible = false

  const dracoLoader = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
  const loader = new GLTFLoader().setDRACOLoader(dracoLoader)
  const leaf = leafTexture()
  // reflection probe for the water: the same sky, baked once
  const envScene = new THREE.Scene()
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), skyMat()))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(envScene, 0, 0.1, 1000)
  pmrem.dispose()
  const mats = new Map<string, THREE.Material>()
  let disposed = false
  loader.load(
    `${import.meta.env.BASE_URL}${LOW_POWER ? 'marsh-lite.glb' : 'marsh.glb'}`, // phones: ~245k vertices instead of ~690k
    (gltf) => {
      if (disposed) return
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const n = (o.material as THREE.Material).name
        let m = mats.get(n)
        if (!m) { m = makeMaterial(n, leaf, envRT.texture); mats.set(n, m) }
        o.material = m
        o.frustumCulled = false // sway moves verts past the static bounds
      })
      root.add(gltf.scene)
    },
    undefined,
    (e) => console.error('marsh.glb failed to load', e),
  )

  function update(t: number, rig: Rig, cam: THREE.Camera) {
    T.value = t
    root.visible = rig.marsh > 0.5
    sky.visible = root.visible
    sky.position.copy(cam.position)
    RAIN.value = rig.rain
    rain.visible = root.visible && rig.rain > 0.01
    rainMat.uniforms.uCam.value.copy(cam.position)
  }

  function dispose() {
    disposed = true
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    for (const m of mats.values()) m.dispose()
    rg.dispose(); rainMat.dispose(); scene.remove(rain, sky)
    for (const m of mists) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
    sky.geometry.dispose()
    ;(sky.material as THREE.Material).dispose()
    leaf.dispose()
    envRT.dispose()
    envScene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } })
    dracoLoader.dispose()
  }

  return { update, dispose }
}
