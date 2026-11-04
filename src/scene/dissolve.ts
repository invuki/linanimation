import * as THREE from 'three'

// Fragments within `uR` (+ noise) of the camera are discarded; a thin ember rim marks the edge.
export const U = {
  uCam: { value: new THREE.Vector3() },
  uR: { value: 0 },
  uTime: { value: 0 },
}

const NOISE = /* glsl */ `
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
`

interface PatchOptions {
  floor?: boolean
  glow?: boolean
}

/** Adds the dissolve (and stone/brick grain) to a built-in three material. */
export function patch(mat: THREE.Material, { floor = false, glow = true }: PatchOptions = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.0)).xyz;')
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE)
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nfloat dT = dsT();\nif (uR > 0.0 && dT > 0.0) discard;',
      )
    const grain = floor
      ? `{ float row=floor(vWPos.z/0.15); float off=mod(row,2.0)*0.5; vec2 f=fract(vec2(vWPos.x/0.3+off,vWPos.z/0.15));
           float m=clamp(step(f.x,0.045)+step(f.y,0.07),0.0,1.0);
           diffuseColor.rgb*=0.6*mix(1.0,0.3,m)*(0.75+0.5*h3(vec3(floor(vWPos.x/0.3+off),row,3.0))); }`
      : 'diffuseColor.rgb*=0.8+0.4*vn(vWPos*5.0);'
    if (fs.includes('#include <color_fragment>'))
      fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + grain)
    if (glow && fs.includes('#include <emissivemap_fragment>'))
      fs = fs.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nif(uR>0.0) totalEmissiveRadiance += EMBER*1.4*smoothstep(-0.9,0.0,dT);',
      )
    sh.fragmentShader = fs
  }
  mat.customProgramCacheKey = () => 'dissolve' + (floor ? 'F' : 'S')
  mat.needsUpdate = true
}

/** Stained glass: 3D voronoi cells + lead lines, emissive, same dissolve. */
export function createGlassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec3 vWPos; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWPos=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
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
  if(uR>0.0) col += EMBER*1.6*smoothstep(-0.9,0.0,dT);
  gl_FragColor = vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  })
}
