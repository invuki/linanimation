import * as THREE from 'three'

// Scene exported from Blender (public/start/*.bin): positions are (x, z, -y) of the Blender
// scene, 1 px of the 1200x684 reference = 0.02 units. Wind sway mirrors the Blender node group.
const W = 24, H = 13.68, LOOP = 10

const VERT = /* glsl */ `
uniform float uTime, uAmp, uOmega, uFx, uFz;
attribute float aW;
attribute vec4 aCol;
varying vec4 vCol;
void main() {
  vec3 p = position;
  float ph = uOmega * uTime + p.x * uFx + p.y * uFz;
  float s = sin(ph) + 0.4 * sin(2.0 * ph + 1.0);
  p.x += s * uAmp * aW;
  p.y += sin(ph + 1.57) * uAmp * 0.15 * aW;
  vCol = aCol;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`
const FRAG = /* glsl */ `varying vec4 vCol; void main() { gl_FragColor = vCol; }`

interface Part { name: string; amp?: number; k?: number; fx?: number; fz?: number; blend?: boolean }
const PARTS: Part[] = [
  { name: 'static' },
  { name: 'shTree', blend: true }, { name: 'shRockR', blend: true }, { name: 'shRockL', blend: true },
  { name: 'shBerry', blend: true }, { name: 'haze', blend: true },
  { name: 'canopy', amp: 0.07, k: 2, fx: 0.9, fz: 0.7 },
  { name: 'grass', amp: 0.2, k: 3, fx: 0.25, fz: 0.2 },
]

async function loadPart(p: Part, n: number, m: number) {
  const buf = await (await fetch(`/start/${p.name}.bin`)).arrayBuffer()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 0, n * 3), 3))
  g.setAttribute('aCol', new THREE.BufferAttribute(new Uint8Array(buf, n * 12, n * 4), 4, true))
  g.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(buf, n * 16, n), 1))
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, n * 20, m), 1))
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: p.amp ?? 0 }, uOmega: { value: (2 * Math.PI * (p.k ?? 0)) / LOOP },
      uFx: { value: p.fx ?? 0 }, uFz: { value: p.fz ?? 0 },
    },
    transparent: !!p.blend, depthWrite: !p.blend, side: THREE.DoubleSide, // polygon winding is mixed
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  return mesh
}

/** Animated version of the start-screen render. Calls onReady once geometry is loaded. */
export function createStartScreen(canvas: HTMLCanvasElement, onReady: () => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace // vertex colours are already sRGB bytes
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new THREE.Scene()
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 120)
  cam.position.z = 20

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight
    renderer.setSize(w, h, false)
    const a = w / h, ref = W / H // cover: crop whichever axis overflows
    const hw = a >= ref ? W / 2 : (H / 2) * a, hh = a >= ref ? W / 2 / a : H / 2
    Object.assign(cam, { left: -hw, right: hw, top: hh, bottom: -hh })
    cam.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)

  const mats: THREE.ShaderMaterial[] = []
  let disposed = false

  // falling leaves: same recipe as the Blender drivers (240-frame loop at 24 fps)
  const leafGeo = new THREE.CircleGeometry(1, 6).scale(0.17, 0.09, 1)
  const leafMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0x3c / 255, 0x6f / 255, 0xcc / 255, THREE.LinearSRGBColorSpace), side: THREE.DoubleSide })
  const leaves = Array.from({ length: 9 }, (_, i) => {
    const mesh = new THREE.Mesh(leafGeo, leafMat)
    mesh.position.z = 10
    scene.add(mesh)
    const sz = -1 + Math.random() * 5.5
    return {
      mesh, i, sx: 2.5 + Math.random() * 7, sz, dz: -(sz + 3 + Math.random() * 0.8),
      drift: -3.5 + Math.random() * 3, ph: Math.random() * 6.28, spin: -9 + Math.random() * 18, amp: 0.4 + Math.random() * 0.5,
    }
  })

  ;(async () => {
    const meta = await (await fetch('/start/meta.json')).json()
    const meshes = await Promise.all(PARTS.map(p => loadPart(p, meta[p.name].n, meta[p.name].m)))
    if (disposed) { meshes.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose() }); return }
    meshes.forEach(m => { scene.add(m); mats.push(m.material as THREE.ShaderMaterial) })
    onReady()
  })()

  let raf = 0
  const frame = (ms: number) => {
    const t = ms / 1000, f = t * 24
    for (const m of mats) m.uniforms.uTime.value = t
    for (const l of leaves) {
      const u = ((f + l.i * 27) % 240) / 240
      l.mesh.position.x = l.sx + l.drift * u + l.amp * Math.sin(Math.PI * 4 * u + l.ph)
      l.mesh.position.y = l.sz + l.dz * u
      l.mesh.rotation.z = l.spin * u + Math.sin(Math.PI * 6 * u)
      l.mesh.scale.setScalar(Math.min(1, Math.min(u, 1 - u) * 15))
    }
    renderer.render(scene, cam)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
      scene.traverse(o => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) (m.material as THREE.Material).dispose()
      })
      renderer.dispose()
    },
  }
}
