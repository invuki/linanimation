import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTimeline, animate } from 'animejs';
import Lenis from 'lenis';

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const VOID = new THREE.Color(0x070403);
scene.background = VOID;
scene.fog = new THREE.FogExp2(0x070403, 0.012);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300);

// ---------------------------------------------------------------- dissolve (shared uniforms)
// Fragments within uR (+ noise) of the camera are discarded; a thin ember rim marks the edge.
const U = { uCam: { value: new THREE.Vector3() }, uR: { value: 0 }, uTime: { value: 0 } };

const NOISE = /* glsl */`
uniform vec3 uCam; uniform float uR; uniform float uTime;
varying vec3 vWPos;
float h3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float dsT(){
  float n = vn(vWPos*0.9)*0.6 + vn(vWPos*2.7)*0.3 + vn(vWPos*8.0)*0.1;
  return uR - distance(vWPos,uCam) + (n-0.5)*9.0 + sin(uTime*0.6+vWPos.y)*0.25;
}
const vec3 EMBER = vec3(1.0,0.42,0.08);
`;

function patch(mat, { floor = false, glow = true } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.0)).xyz;');
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE)
      .replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nfloat dT = dsT();\nif (uR > 0.0 && dT > 0.0) discard;');
    const grain = floor
      ? `{ float row=floor(vWPos.z/0.15); float off=mod(row,2.0)*0.5; vec2 f=fract(vec2(vWPos.x/0.3+off,vWPos.z/0.15));
           float m=clamp(step(f.x,0.045)+step(f.y,0.07),0.0,1.0);
           diffuseColor.rgb*=0.6*mix(1.0,0.3,m)*(0.75+0.5*h3(vec3(floor(vWPos.x/0.3+off),row,3.0))); }`
      : `diffuseColor.rgb*=0.8+0.4*vn(vWPos*5.0);`;
    if (fs.includes('#include <color_fragment>')) fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + grain);
    if (glow && fs.includes('#include <emissivemap_fragment>'))
      fs = fs.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nif(uR>0.0) totalEmissiveRadiance += EMBER*1.4*smoothstep(-0.9,0.0,dT);');
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'dissolve' + (floor ? 'F' : 'S');
  mat.needsUpdate = true;
}

// Stained glass: 3D voronoi cells + lead lines, emissive, same dissolve.
const glassMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide,
  vertexShader: `varying vec3 vWPos; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWPos=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: /* glsl */`
${NOISE}
vec3 h33(vec3 p){ p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }
vec3 vor(vec3 x){ vec3 n=floor(x), f=fract(x); float md=8.0, sd=8.0; vec3 id=vec3(0.0);
  for(int k=-1;k<=1;k++)for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec3 g=vec3(float(i),float(j),float(k)); vec3 r=g+h33(n+g)-f; float d=dot(r,r);
    if(d<md){sd=md;md=d;id=n+g;} else if(d<sd){sd=d;} }
  return vec3(sqrt(sd)-sqrt(md), h3(id), h3(id+7.0)); }
float ell(vec2 p, vec2 c, vec2 r){ vec2 q=(p-c)/r; return 1.0-step(1.0,dot(q,q)); }
void main(){
  float dT = dsT(); if (uR > 0.0 && dT > 0.0) discard;
  vec3 v = vor(vWPos*6.5);
  vec3 pal[6]; pal[0]=vec3(.85,.04,.03); pal[1]=vec3(.95,.55,.06); pal[2]=vec3(.98,.82,.2); pal[3]=vec3(.06,.12,.65); pal[4]=vec3(.55,.03,.08); pal[5]=vec3(.08,.4,.18);
  int k = int(floor(v.y*5.99)); vec3 col = pal[0];
  for(int i=0;i<6;i++){ if(i==k) col=pal[i]; }
  // figure in the centre light of the east window
  float robe = ell(vWPos.xy, vec2(0.0,5.2), vec2(0.55,1.5)) * step(abs(vWPos.z+30.0),1.0);
  float head = ell(vWPos.xy, vec2(0.0,7.0), vec2(0.28,0.35)) * step(abs(vWPos.z+30.0),1.0);
  col = mix(col, vec3(.9,.04,.03), robe); col = mix(col, vec3(1.0,.85,.35), head);
  col *= smoothstep(0.02,0.09,v.x);                    // lead lines
  col *= 2.6 * (0.8+0.4*v.z);
  if(uR>0.0) col += EMBER*1.4*smoothstep(-0.9,0.0,dT);
  gl_FragColor = vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
});

// ---------------------------------------------------------------- lights (glTF is Y-up: blender (x,y,z) -> (x,z,-y))
scene.add(new THREE.HemisphereLight(0x6b4a2a, 0x120a05, 0.10));
const key = new THREE.SpotLight(0xffa24d, 1300, 0, 0.75, 1, 1.6);
key.position.set(0, 9, -27); key.target.position.set(0, 0, -2); scene.add(key, key.target);
[-3, -17].forEach(z => { const p = new THREE.PointLight(0xffb070, 50, 0, 1.6); p.position.set(0, 12, z); scene.add(p); });
const lamp = new THREE.PointLight(0xffc080, 35, 16, 1.8); scene.add(lamp);   // travels with the viewer

// ---------------------------------------------------------------- dust (the void's only inhabitants)
const DUST = 1800, dpos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) { dpos[i*3] = (Math.random()-.5)*60; dpos[i*3+1] = (Math.random()-.5)*28+3; dpos[i*3+2] = (Math.random()-.5)*70; }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xffc58a, size: 0.07, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const dust = new THREE.Points(dustGeo, dustMat); scene.add(dust);

// ---------------------------------------------------------------- model
new GLTFLoader().load('cathedral.glb', (gltf) => {
  const seen = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name;
    if (name.startsWith('Glass')) { o.material = glassMat; return; }
    if (name === 'Flame') { o.material = new THREE.MeshBasicMaterial({ color: 0xffb050 }); patch(o.material, { glow: false }); return; }
    if (!seen.has(o.material)) {
      const m = o.material; m.side = THREE.DoubleSide;
      if (name === 'Floor') { m.roughness = 0.2; patch(m, { floor: true }); } else patch(m);
      seen.set(m, true);
    }
  });
  scene.add(gltf.scene);
  const L = document.getElementById('loader'); L.classList.add('done'); setTimeout(() => L.remove(), 1500);
}, undefined, (e) => { console.error(e); 0; });

// ---------------------------------------------------------------- anime.js timeline, scrubbed by scroll
const TOTAL = 10000;
const S = { z: -7, y: 1.6, lookY: 5.5, R: 0, dust: 0, exp: 1.0, fog: 0.012 };
const tl = createTimeline({ autoplay: false, defaults: { ease: 'linear' } })
  .add(S, { z: -30, duration: 8000, ease: 'inOutSine' }, 0)                   // up the aisle to the altar
  .add(S, { z: -42, duration: 2000, ease: 'linear' }, 8000)                   // on into the void
  .add(S, { y: 3.4, lookY: 2.0, duration: 4500, ease: 'inOutSine' }, 5500)    // eyes lift as the walls go
  .add(S, { R: 60, duration: 7000, ease: 'inSine' }, 2500)                   // dissolution radius around the viewer
  .add(S, { fog: 0.004, exp: 1.25, duration: 4000, ease: 'inOutSine' }, 6000)
  .add(S, { dust: 1, duration: 3500, ease: 'inOutSine' }, 5000)
  ;
tl.seek(0);

// ---------------------------------------------------------------- Lenis
const lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 0.9, smoothWheel: true });
const bar = document.getElementById('bar');
let progress = 0;
function onScroll(p) {
  progress = p; tl.seek(p * TOTAL);
  bar.style.transform = `scaleX(${p})`;
}
lenis.on('scroll', (e) => { onScroll(e.progress || 0); resetIdle(); });

// idle hint: after 30 s without scrolling, fade a hint in; any scroll hides it and restarts the clock
const hint = document.getElementById('hint'); let idleT, shown = false;
const IDLE = +new URLSearchParams(location.search).get('idle') || 30000;   // ?idle=ms for testing
function showHint() {
  if (progress > 0.98) return;                       // nothing left to scroll to
  shown = true; animate(hint, { opacity: [0, 1], translateY: [10, 0], duration: 900, ease: 'outQuad' });
}
function resetIdle() {
  if (shown) { shown = false; animate(hint, { opacity: 0, duration: 400, ease: 'outQuad' }); }
  clearTimeout(idleT); idleT = setTimeout(showHint, IDLE);
}
resetIdle();
window.seekTo = (p) => onScroll(p);   // debug hook
const startP = parseFloat(new URLSearchParams(location.search).get('p'));
if (!Number.isNaN(startP)) onScroll(startP);

// ---------------------------------------------------------------- loop
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w / h < 1 ? 72 : 52; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

function frame(t) {
  lenis.raf(t);
  const time = t / 1000;
  camera.position.set(Math.sin(time * 0.4) * 0.05, S.y + Math.sin(time * 0.9) * 0.015, S.z);
  camera.lookAt(0, S.lookY, S.z - 18);
  lamp.position.copy(camera.position);
  U.uCam.value.copy(camera.position); U.uR.value = S.R; U.uTime.value = time;
  scene.fog.density = S.fog; renderer.toneMappingExposure = S.exp;
  dust.position.z = S.z; dust.position.y = 0; dust.rotation.y = time * 0.01; dustMat.opacity = S.dust * 0.85;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
