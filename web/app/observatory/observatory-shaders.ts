// Procedural GLSL for the observatory. Everything is analytic noise so the scene needs
// no downloaded textures: surfaces are sampled in object space (seamless on spheres)
// and lit in world space by one distant sun.

const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec4 mod289(vec4 x) { return x - floor(x * (1. / 289.)) * 289.; }
vec4 permute(vec4 x) { return mod289(((x * 34.) + 1.) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - .85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1. / 6., 1. / 3.);
  const vec4 D = vec4(0., .5, 1., 2.);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1. - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0., i1.z, i2.z, 1.)) + i.y + vec4(0., i1.y, i2.y, 1.)) + i.x + vec4(0., i1.x, i2.x, 1.));
  vec3 ns = .142857142857 * D.wyz - D.xzx;
  vec4 j = p - 49. * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7. * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1. - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2. + 1.;
  vec4 s1 = floor(b1) * 2. + 1.;
  vec4 sh = -step(h, vec4(0.));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.);
  m = m * m;
  return 42. * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p) { float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * snoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s; }
float fbm4(vec3 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.05 + vec3(3.3, 1.1, 8.4); a *= .5; } return s; }
float fbm3(vec3 p) { float a = .5, s = 0.; for (int i = 0; i < 3; i++) { s += a * snoise(p); p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= .5; } return s; }
`

// Rings: faint inner ring, bright main ring, a Cassini-like gap and ragged edges.
const RING_DENSITY = /* glsl */ `
float ringDensity(float t) {
  float d = .66 + .16 * sin(t * 19. + .4) + .1 * sin(t * 47. + 2.1) + .04 * sin(t * 113. + 1.3);
  d *= mix(.35, 1., smoothstep(.05, .32, t));
  d *= 1. - .9 * (smoothstep(.62, .632, t) - smoothstep(.672, .684, t));
  d *= smoothstep(0., .04, t) * (1. - smoothstep(.9, 1., t));
  return clamp(d, 0., 1.);
}
`

const SHADE = /* glsl */ `
uniform vec3 uSun;
uniform float uSeed;
uniform float uDim;
varying vec3 vObj;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
// Soft terminator, limb darkening and a faint cool fill so night sides keep a silhouette.
vec3 shade(vec3 albedo, vec3 N, vec3 V, vec3 L) {
  float ndl = dot(N, L);
  float diffuse = smoothstep(-.08, .55, ndl) * max(ndl + .08, 0.) / 1.08;
  float limb = mix(.55, 1., pow(max(dot(N, V), 0.), .45));
  return albedo * (diffuse * 2.1 * limb) + albedo * vec3(.018, .022, .035);
}
`

export const SURFACE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vObj = position;
  vec4 world = modelMatrix * vec4(position, 1.);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

// Ocean world with warped continents, arid belts, ice caps, specular sea and city lights.
export const TERRESTRIAL_FRAG = /* glsl */ `
${NOISE}
${SHADE}
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSun);
  vec3 q = p * 1.35 + uSeed;
  vec3 w = vec3(fbm3(q + vec3(0., 3.1, 0.)), fbm3(q + vec3(5.2, 1.3, 2.8)), fbm3(q + vec3(1.7, 9.2, 4.4)));
  float h = fbm(q + w * .6);
  float land = smoothstep(.03, .055, h);
  vec3 ocean = mix(vec3(.004, .018, .06), vec3(.02, .11, .2), smoothstep(-.35, .045, h));
  float lat = abs(p.y);
  float arid = smoothstep(.45, .7, fbm3(p * 3. + uSeed + 7.) * .5 + .5 + .35 - abs(lat - .3) * 1.4);
  vec3 ground = mix(vec3(.05, .09, .035), vec3(.33, .24, .13), arid);
  ground = mix(ground, vec3(.2, .18, .16), smoothstep(.2, .42, h));
  float ice = smoothstep(.74, .83, lat + fbm3(p * 6.) * .07);
  vec3 albedo = mix(mix(ocean, ground, land), vec3(.78, .82, .88), ice);
  float ndl = dot(N, L);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.), 70.) * (1. - land) * (1. - ice) * step(0., ndl);
  float cities = smoothstep(.62, .82, snoise(p * 42. + uSeed) * .5 + .5) * smoothstep(.45, .7, snoise(p * 8. + 2.) * .5 + .5);
  cities *= land * (1. - ice) * (1. - arid * .8) * (1. - smoothstep(-.22, .02, ndl));
  float fresnel = pow(1. - max(dot(N, V), 0.), 3.);
  vec3 color = shade(albedo, N, V, L)
    + vec3(1., .92, .8) * spec * 1.1
    + vec3(1., .66, .3) * cities * 1.4
    + vec3(.28, .52, 1.) * fresnel * smoothstep(-.15, .4, ndl) * .8;
  gl_FragColor = vec4(color * uDim, 1.);
  ${OUTPUT}
}
`

export const CLOUD_FRAG = /* glsl */ `
${NOISE}
${SHADE}
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uSun);
  float c = fbm(p * 2.3 + vec3(0., uSeed, 0.) + fbm3(p * 1.4 + uSeed) * .9);
  float cover = smoothstep(.06, .42, c) * (1. - smoothstep(.8, .95, abs(p.y)) * .5);
  float ndl = dot(N, L);
  float light = smoothstep(-.1, .5, ndl) * max(ndl + .1, 0.) * 1.8 + .01;
  gl_FragColor = vec4(vec3(light) * uDim, cover * .82);
  ${OUTPUT}
}
`

// Banded gas giant with turbulent belt edges, a long-lived storm and the ring's shadow.
export const GIANT_FRAG = /* glsl */ `
${NOISE}
${RING_DENSITY}
${SHADE}
uniform vec3 uRingN;
uniform vec3 uCenter;
uniform float uRingIn;
uniform float uRingOut;
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSun);
  float lat = p.y;
  float y = lat + fbm(vec3(p.x * 1.6, p.y * 7., p.z * 1.6) + uSeed) * .055;
  float belts = sin(y * 17.) * .5 + .5;
  float fine = sin(y * 46. + 1.3) * .5 + .5;
  vec3 albedo = mix(vec3(.74, .6, .42), vec3(.46, .28, .13), smoothstep(.3, .75, belts));
  albedo = mix(albedo, vec3(.22, .12, .06), smoothstep(.78, .98, fine) * .45);
  albedo = mix(albedo, vec3(.86, .78, .62), smoothstep(.55, .9, snoise(vec3(y * 70., 0., uSeed)) * .5 + .5) * .3);
  albedo *= .86 + .28 * (fbm3(p * vec3(4., 16., 4.) + uSeed * 2.) * .5 + .5);
  vec2 sp = vec2(atan(p.z, p.x), lat);
  float storm = 1. - smoothstep(.07, .15, length((sp - vec2(1.05, -.3)) * vec2(1., 2.6)));
  albedo = mix(albedo, vec3(.58, .22, .09), storm * .75);
  albedo *= mix(1., .6, smoothstep(.62, .96, abs(lat)));
  float shadow = 1.;
  float denom = dot(L, uRingN);
  if (abs(denom) > .001) {
    float t = dot(uCenter - vWorldPos, uRingN) / denom;
    if (t > 0.) {
      float r = (length(vWorldPos + L * t - uCenter) - uRingIn) / (uRingOut - uRingIn);
      if (r > 0. && r < 1.) shadow = 1. - ringDensity(r) * .7;
    }
  }
  gl_FragColor = vec4(shade(albedo, N, V, L) * shadow * uDim, 1.);
  ${OUTPUT}
}
`

// Ice giant: low-contrast methane haze, bright cirrus streaks and one dark vortex.
export const ICE_FRAG = /* glsl */ `
${NOISE}
${SHADE}
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSun);
  float lat = p.y;
  float y = lat + fbm3(p * vec3(2., 5., 2.) + uSeed) * .04;
  float bands = sin(y * 9.) * .5 + .5;
  vec3 albedo = mix(vec3(.018, .03, .13), vec3(.06, .1, .32), bands * .6 + .2);
  albedo = mix(albedo, vec3(.12, .15, .36), smoothstep(.7, .98, abs(lat)) * .35);
  float streaks = smoothstep(.64, .82, fbm(vec3(p.x * 3., p.y * 26., p.z * 3.) + uSeed) * .5 + .5);
  albedo = mix(albedo, vec3(.4, .45, .7), streaks * .3);
  vec2 sp = vec2(atan(p.z, p.x), lat);
  float vortex = 1. - smoothstep(.05, .11, length((sp - vec2(-.7, -.22)) * vec2(1., 2.2)));
  albedo = mix(albedo, vec3(.08, .07, .24), vortex * .7);
  gl_FragColor = vec4(shade(albedo, N, V, L) * uDim, 1.);
  ${OUTPUT}
}
`

export const MOON_FRAG = /* glsl */ `
${NOISE}
${SHADE}
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSun);
  float maria = smoothstep(.45, .6, fbm4(p * 1.8 + uSeed) * .5 + .5);
  float craters = smoothstep(.62, .72, snoise(p * 9. + 2.) * .5 + .5) - smoothstep(.72, .8, snoise(p * 9. + 2.) * .5 + .5) * .6;
  vec3 albedo = mix(vec3(.4, .39, .37), vec3(.17, .165, .16), maria) * (.85 + .3 * (fbm3(p * 12.) * .5 + .5)) + craters * .06;
  gl_FragColor = vec4(shade(albedo, N, V, L) * uDim, 1.);
  ${OUTPUT}
}
`

// Scattering shell drawn slightly larger than the planet: bright at the lit limb, fading to space.
export const ATMOSPHERE_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uColor;
uniform float uStrength;
uniform float uDim;
varying vec3 vObj;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = max(dot(N, V), 0.);
  float glow = pow(1. - ndv, 3.5) * smoothstep(0., .32, ndv);
  float day = smoothstep(-.35, .45, dot(N, normalize(uSun)));
  gl_FragColor = vec4(uColor * glow * day * uStrength * uDim, 1.);
  ${OUTPUT}
}
`

export const RING_VERT = /* glsl */ `
varying vec2 vLocal;
varying vec3 vWorldPos;
void main() {
  vLocal = position.xy;
  vec4 world = modelMatrix * vec4(position, 1.);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const RING_FRAG = /* glsl */ `
${RING_DENSITY}
uniform vec3 uSun;
uniform vec3 uRingN;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uRingIn;
uniform float uRingOut;
uniform float uDim;
varying vec2 vLocal;
varying vec3 vWorldPos;
void main() {
  float t = (length(vLocal) - uRingIn) / (uRingOut - uRingIn);
  float density = ringDensity(t);
  if (density < .01) discard;
  vec3 L = normalize(uSun);
  vec3 oc = vWorldPos - uCenter;
  float along = dot(oc, L);
  float perpendicular = sqrt(max(dot(oc, oc) - along * along, 0.));
  float shadow = along < 0. ? smoothstep(uRadius * .96, uRadius * 1.04, perpendicular) : 1.;
  vec3 tint = mix(vec3(.62, .52, .4), vec3(.44, .37, .29), smoothstep(.2, .9, sin(t * 29. + 1.) * .5 + .5));
  float light = (.35 + .65 * abs(dot(normalize(uRingN), L))) * 1.9 * shadow + .015;
  gl_FragColor = vec4(tint * light * uDim, density * .72);
  ${OUTPUT}
}
`

// Milky Way: a tilted galactic band with a warm core, dust lanes, faint emission nebulae
// and forward-scattered sunlight. Drawn on an inside-out sphere that follows the camera.
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  gl_Position = clip.xyww;
}
`

export const SKY_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uBand;
uniform vec3 uCore;
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float b = dot(d, normalize(uBand));
  float band = exp(-b * b * 16.);
  float core = pow(max(dot(d, normalize(uCore)), 0.), 5.);
  float n = fbm4(d * 3.1) * .5 + .5;
  float dust = smoothstep(.5, .74, fbm4(d * 6.2 + 9.) * .5 + .5) * exp(-b * b * 55.) * .6;
  float glow = band * (.25 + .75 * n * n) * (1. - dust * .88);
  vec3 bandColor = mix(vec3(.07, .085, .15), vec3(.3, .23, .16), clamp(core * 1.4 + n * .25, 0., 1.));
  vec3 color = vec3(.0015, .002, .006) + bandColor * glow * .22 + vec3(.9, .74, .52) * core * band * .08 * (1. - dust);
  float nebula = fbm3(d * 2.3 + 13.) * .5 + .5;
  color += mix(vec3(.16, .03, .1), vec3(.02, .09, .12), step(0., d.x)) * smoothstep(.62, .9, nebula) * .05;
  color += vec3(1., .7, .4) * pow(max(dot(d, normalize(uSun)), 0.), 40.) * .12;
  gl_FragColor = vec4(color, 1.);
  ${OUTPUT}
}
`

export const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  float twinkle = 1. + .22 * sin(uTime * (1.2 + aPhase * 2.3) + aPhase * 40.);
  vColor = aColor * twinkle;
  gl_PointSize = aSize * uPixelRatio * mix(1., twinkle, step(2.2, aSize));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}
`

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - .5;
  float d2 = dot(c, c);
  float intensity = exp(-d2 * 42.) + exp(-d2 * 10.) * .18;
  if (intensity < .01) discard;
  gl_FragColor = vec4(vColor * intensity, 1.);
}
`

// Wormhole: a billboarded throat that behaves like a lensing sphere. A swirling accretion
// disc spirals into a thin photon ring; through the throat you glimpse Town's dusk sky.
export const WORMHOLE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}
`

export const WORMHOLE_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uOpen;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2. - 1.;
  float r = length(p);
  if (r > 1.) discard;
  float a = atan(p.y, p.x);
  float throat = .3 + uOpen * .05;
  float swirl = a + 1.9 / max(r, .08) - uTime * .55;
  float arms = fbm4(vec3(cos(swirl) * 1.6, sin(swirl) * 1.6, r * 3.5 - uTime * .3)) * .5 + .5;
  float band = smoothstep(throat, throat + .05, r) * (1. - smoothstep(.5, 1., r));
  float disk = band * (.35 + .9 * arms * arms) * pow(max(1. - (r - throat) / (1. - throat), 0.), 1.6);
  vec3 diskColor = mix(vec3(1., .88, .66), mix(vec3(1., .5, .24), vec3(.46, .36, 1.), smoothstep(.45, .85, r)), smoothstep(throat, .58, r));
  float ring = exp(-pow((r - throat) / .014, 2.)) * 2.4;
  vec2 q = p / throat;
  float lens = max(1. - dot(q, q), 0.);
  vec2 view = q * (1. + .55 * lens) + vec2(sin(uTime * .3), cos(uTime * .23)) * .05;
  vec3 dusk = mix(vec3(1., .6, .32), vec3(.2, .26, .56), smoothstep(-.55, .85, view.y));
  vec2 sunOffset = view - vec2(.12, -.22);
  dusk += vec3(1., .82, .52) * exp(-dot(sunOffset, sunOffset) * 38.);
  float hills = smoothstep(0., .04, -view.y - .3 - .07 * sin(view.x * 7.) - .04 * sin(view.x * 17. + 1.));
  dusk = mix(dusk, vec3(.05, .035, .07), hills);
  float windows = step(.93, fract(sin(floor(view.x * 22.) * 91.7) * 4375.)) * hills * step(-view.y, .52);
  dusk += vec3(1., .75, .4) * windows * .8;
  float inside = 1. - smoothstep(throat - .015, throat, r);
  vec3 color = dusk * inside * (.55 + .45 * lens) * (.75 + uOpen * .7)
    + diskColor * disk * 1.7 * (1. + uOpen * .8)
    + vec3(1., .9, .76) * ring
    + vec3(.4, .32, .9) * exp(-pow((r - .62) / .32, 2.)) * .1;
  float alpha = clamp(max(inside, max(disk * 1.3, ring)) + .12 * (1. - r), 0., 1.);
  gl_FragColor = vec4(color, alpha);
  ${OUTPUT}
}
`

// Matter spiralling into the throat, accelerating as it falls.
export const INFALL_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform float uRadius;
uniform float uPixelRatio;
varying float vFade;
varying vec3 vColor;
void main() {
  float life = fract(aSeed.z + uTime * (.04 + aSeed.y * .05));
  float r = mix(1.85, .32, life * life) * uRadius;
  float angle = aSeed.x * 6.2831 + 2.6 / (r / uRadius) + uTime * .35;
  vec3 local = vec3(cos(angle) * r, sin(angle) * r * .92, (aSeed.y - .5) * .08 * uRadius * (1. - life));
  vFade = smoothstep(0., .2, life) * (1. - smoothstep(.88, 1., life));
  vColor = mix(vec3(.55, .5, 1.), vec3(1., .8, .52), life);
  vec4 mv = modelViewMatrix * vec4(local, 1.);
  gl_PointSize = (1. + aSeed.y * 1.8) * uPixelRatio * (50. / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`

export const SOFT_POINT_FRAG = /* glsl */ `
varying float vFade;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - .5;
  float intensity = exp(-dot(c, c) * 18.) * vFade;
  if (intensity < .01) discard;
  gl_FragColor = vec4(vColor * intensity, 1.);
}
`

// Comet tails always stream away from the sun: a curved golden dust tail and a straight blue ion tail.
export const COMET_VERT = /* glsl */ `
attribute float aAlong;
attribute vec3 aColor;
attribute float aSize;
uniform float uTime;
uniform float uPixelRatio;
varying float vFade;
varying vec3 vColor;
void main() {
  vec3 shimmer = vec3(sin(uTime * 2. + aAlong * 40.), cos(uTime * 1.7 + aAlong * 33.), 0.) * aAlong * .12;
  vec4 mv = modelViewMatrix * vec4(position + shimmer, 1.);
  vFade = pow(1. - aAlong, 1.6);
  vColor = aColor;
  gl_PointSize = aSize * uPixelRatio * (60. / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`
