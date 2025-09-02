import {
  DataTexture,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { FireGrid } from '../fire/grid';

// Procedural flipbook atlas: flames frames followed by smoke frames (vertical stack)
function makeProceduralAtlas(opts = { flameFrames: 16, smokeFrames: 8, size: 48 }): { tex: Texture; totalFrames: number; flameBase: number; smokeBase: number; flameFrames: number; smokeFrames: number } {
  const flameFrames = Math.max(1, opts.flameFrames);
  const smokeFrames = Math.max(1, opts.smokeFrames);
  const totalFrames = flameFrames + smokeFrames;
  const size = opts.size;
  const w = size;
  const h = size * totalFrames;
  const data = new Float32Array(w * h * 4);

  const writeFrame = (frameIndex: number, kind: 'flame' | 'Smoke') => {
    const isFlame = kind === 'flame';
    const localIdx = isFlame ? frameIndex : frameIndex - flameFrames;
    const t = localIdx / Math.max(1, (isFlame ? flameFrames : smokeFrames) - 1);
    // Color ramp per kind
    const fR = 1.0;
    const fG = 0.40 + 0.50 * t; // 0.40..0.90
    const fB = 0.05 + 0.22 * t; // 0.05..0.27
    const sR = 0.55 + 0.15 * t; // 0.55..0.70
    const sG = 0.55 + 0.15 * t;
    const sB = 0.55 + 0.15 * t;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size - 0.5;
        const v = (y + 0.5) / size - 0.5;
        // Make flames a bit taller (elliptical falloff), smoke rounder/softer
        const uu = isFlame ? u * 0.9 : u * 1.0;
        const vv = isFlame ? v * 1.2 : v * 1.0;
        const r2 = uu * uu + vv * vv;
        const fall = Math.max(0, 1 - r2 * (isFlame ? 3.6 : 2.4));
        const a = Math.pow(fall, isFlame ? 1.6 : 2.2);
        const idx = ((frameIndex * size + y) * w + x) * 4;
        if (isFlame) {
          data[idx + 0] = fR * (0.70 + 0.30 * fall);
          data[idx + 1] = fG * (0.60 + 0.40 * fall);
          data[idx + 2] = fB * (0.50 + 0.50 * fall);
          data[idx + 3] = a;
        } else {
          data[idx + 0] = sR * (0.60 + 0.40 * fall);
          data[idx + 1] = sG * (0.60 + 0.40 * fall);
          data[idx + 2] = sB * (0.60 + 0.40 * fall);
          data[idx + 3] = a * 0.85; // smoke a bit more transparent
        }
      }
    }
  };

  // Flames first, then smoke
  for (let f = 0; f < flameFrames; f++) writeFrame(f, 'flame');
  for (let s = 0; s < smokeFrames; s++) writeFrame(flameFrames + s, 'Smoke');

  const tex = new DataTexture(data, w, h, RGBAFormat, FloatType);
  tex.needsUpdate = true;
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  return { tex, totalFrames, flameBase: 0, smokeBase: flameFrames, flameFrames, smokeFrames };
}

function makeMaterial(atlas: Texture, frames: number) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAtlas: { value: atlas },
      uFrames: { value: frames },
      cameraRight: { value: new Vector3(1, 0, 0) },
      cameraUp: { value: new Vector3(0, 1, 0) },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec3 cameraRight;
      uniform vec3 cameraUp;
      attribute vec3 iOffset;
      attribute float iSize;
      attribute float iAngle;
      attribute float iF0;
      attribute float iRate;
      attribute float iFBase;
      attribute float iFCount;
      attribute float iAspect;
      attribute float iPhase;
      attribute float iRise;
      attribute vec3 iColor;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vFrame;
      void main() {
        vec2 p = position.xy; // -0.5..0.5
        float c = cos(iAngle), s = sin(iAngle);
        vec2 r = vec2(p.x*c - p.y*s, p.x*s + p.y*c);
        // size-over-life driven by time and per-instance phase
        float lifeT = fract(iPhase + uTime * (iRate * 0.08));
        float lifeS = 1.0 - abs(lifeT * 2.0 - 1.0);
        float sMul = mix(0.7, 1.2, lifeS);
        vec3 world = iOffset + cameraRight * (r.x * iSize) + cameraUp * (r.y * iSize * iAspect * sMul);
        // vertical rise over lifetime in world space
        world.y += iRise * lifeT;
        vUv = p + 0.5;
        vColor = iColor;
        // Choose frame within the per-instance frame range, then offset by base
        float localF = mod(iF0 + uTime * iRate, iFCount);
        vFrame = floor(iFBase + localF);
        gl_Position = projectionMatrix * viewMatrix * vec4(world,1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D uAtlas;
      uniform float uFrames;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vFrame;
      void main(){
        // vertical stack of frames (vFrame already in 0..uFrames-1)
        float f = vFrame;
        vec2 uv = vec2(vUv.x, (vUv.y + f) / uFrames);
        vec4 tex = texture2D(uAtlas, uv);
        vec3 col = tex.rgb * vColor;
        float a = tex.a;
        if (a < 0.02) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

export type ParticleQuality = 'low' | 'med' | 'high';

export function createFlipbookParticles(hm: Heightmap) {
  const group = new Group();
  const quad = new PlaneGeometry(1, 1);
  const atlasInfo = makeProceduralAtlas({ flameFrames: 16, smokeFrames: 8, size: 48 });
  const mat = makeMaterial(atlasInfo.tex, atlasInfo.totalFrames);

  let caps = { total: 8000 };
  let enabled = { flames: true, smoke: true };

  const mesh = new InstancedMesh(quad, mat, caps.total);
  (mesh as any).frustumCulled = false;
  mesh.count = 0;
  // Per-instance attributes
  const iOffset = new Float32Array(caps.total * 3);
  const iSize = new Float32Array(caps.total);
  const iAngle = new Float32Array(caps.total);
  const iF0 = new Float32Array(caps.total);
  const iRate = new Float32Array(caps.total);
  const iColor = new Float32Array(caps.total * 3);
  const iAspect = new Float32Array(caps.total);
  const iPhase = new Float32Array(caps.total);
  const iFBase = new Float32Array(caps.total);
  const iFCount = new Float32Array(caps.total);
  const iRise = new Float32Array(caps.total);
  mesh.geometry.setAttribute('iOffset', new InstancedBufferAttribute(iOffset, 3));
  mesh.geometry.setAttribute('iSize', new InstancedBufferAttribute(iSize, 1));
  mesh.geometry.setAttribute('iAngle', new InstancedBufferAttribute(iAngle, 1));
  mesh.geometry.setAttribute('iF0', new InstancedBufferAttribute(iF0, 1));
  mesh.geometry.setAttribute('iRate', new InstancedBufferAttribute(iRate, 1));
  mesh.geometry.setAttribute('iColor', new InstancedBufferAttribute(iColor, 3));
  mesh.geometry.setAttribute('iAspect', new InstancedBufferAttribute(iAspect, 1));
  mesh.geometry.setAttribute('iPhase', new InstancedBufferAttribute(iPhase, 1));
  mesh.geometry.setAttribute('iFBase', new InstancedBufferAttribute(iFBase, 1));
  mesh.geometry.setAttribute('iFCount', new InstancedBufferAttribute(iFCount, 1));
  mesh.geometry.setAttribute('iRise', new InstancedBufferAttribute(iRise, 1));

  group.add(mesh);

  function setQuality(q: ParticleQuality) {
    if (q === 'low') caps.total = 4000; else if (q === 'high') caps.total = 12000; else caps.total = 8000;
  }
  function setEnabled(part: Partial<typeof enabled>) { Object.assign(enabled, part); mesh.visible = enabled.flames || enabled.smoke; }

  function rng(i: number) { let x = i * 1664525 + 1013904223; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0xffffffff; }

  function update(grid: FireGrid, env: { windDirRad: number; windSpeed: number }, dt: number, camera: THREE.Camera) {
    // Update camera basis
    const m = (camera as any).matrixWorld.elements as number[];
    (mat.uniforms as any).cameraRight.value.set(m[0], m[1], m[2]);
    (mat.uniforms as any).cameraUp.value.set(m[4], m[5], m[6]);
    (mat.uniforms as any).uTime.value += dt;

    let alive = 0;
    const width = grid.width;
    const height = grid.height;
    const scale = hm.scale;
    // Distance LOD thresholds
    const near2 = 80 * 80, mid2 = 180 * 180, far2 = 300 * 300;
    // Burning tiles
    if (enabled.flames || enabled.smoke) {
      for (let bi = 0; bi < grid.bCount && alive < caps.total; bi++) {
        const idx = grid.burning[bi] | 0;
        const x = idx % width; const z = (idx / width) | 0;
        const wx = (x + 0.5) * scale; const wz = (z + 0.5) * scale;
        const dx = camera.position.x - wx; const dz = camera.position.z - wz;
        const d2 = dx * dx + dz * dz;
        let lod = 1.0;
        if (d2 > far2) lod = 0; else if (d2 > mid2) lod = 0.3; else if (d2 > near2) lod = 0.6;
        if (lod <= 0) continue;
        const heat = grid.tiles[idx].heat;
        // Flames (1-2 per hot tile)
        if (enabled.flames) {
          const n = heat > 0.6 ? 2 : 1;
          for (let k = 0; k < n && alive < caps.total; k++) {
            const h = rng(idx * 131 + k);
            const ox = (h * 2 - 1) * 0.35 * scale;
            const oz = (((h * 65537.0) % 1) * 2 - 1) * 0.35 * scale;
            const i3 = alive * 3;
            iOffset[i3 + 0] = wx + ox;
            iOffset[i3 + 1] = hm.sample(wx + ox, wz + oz) + 0.45;
            iOffset[i3 + 2] = wz + oz;
            iSize[alive] = 0.6 + 0.8 * heat;
            iAngle[alive] = h * Math.PI * 2;
            iFBase[alive] = atlasInfo.flameBase;
            iFCount[alive] = atlasInfo.flameFrames;
            iF0[alive] = Math.floor(h * atlasInfo.flameFrames);
            iRate[alive] = 8 + 8 * heat * lod;
            // New: aspect (taller flames) and size-over-life phase
            iAspect[alive] = 1.6 + 0.4 * heat;
            iPhase[alive] = h;
            iRise[alive] = 0.30 + 0.35 * heat; // small upward lick
            iColor[i3 + 0] = 1.0; iColor[i3 + 1] = 0.85; iColor[i3 + 2] = 0.6;
            alive++;
          }
        }
        // Smoke (occasional)
        if (enabled.smoke && alive < caps.total && heat > 0.2) {
          const h2 = rng(idx * 977);
          const ox = (h2 * 2 - 1) * 0.4 * scale;
          const oz = (((h2 * 8191.0) % 1) * 2 - 1) * 0.4 * scale;
          const i3 = alive * 3;
          iOffset[i3 + 0] = wx + ox;
          iOffset[i3 + 1] = hm.sample(wx + ox, wz + oz) + 0.2;
          iOffset[i3 + 2] = wz + oz;
          iSize[alive] = 0.8 + 1.2 * heat;
          iAngle[alive] = h2 * Math.PI * 2;
          iFBase[alive] = atlasInfo.smokeBase;
          iFCount[alive] = atlasInfo.smokeFrames;
          iF0[alive] = Math.floor(h2 * atlasInfo.smokeFrames);
          iRate[alive] = 6 + 4 * lod;
          iAspect[alive] = 1.2 + 0.3 * (1.0 - heat);
          iPhase[alive] = h2;
          iRise[alive] = 1.2 + 0.8 * lod; // floats higher before fade
          iColor[i3 + 0] = 0.7; iColor[i3 + 1] = 0.7; iColor[i3 + 2] = 0.7;
          alive++;
        }
      }
    }
    // Smoldering tiles → smoke only
    if (enabled.smoke) {
      for (let si = 0; si < grid.sCount && alive < caps.total; si++) {
        const idx = grid.smoldering[si] | 0;
        const x = idx % width; const z = (idx / width) | 0;
        const wx = (x + 0.5) * scale; const wz = (z + 0.5) * scale;
        const dx = camera.position.x - wx; const dz = camera.position.z - wz;
        const d2 = dx * dx + dz * dz;
        let lod = 1.0;
        if (d2 > far2) lod = 0; else if (d2 > mid2) lod = 0.3; else if (d2 > near2) lod = 0.6;
        if (lod <= 0) continue;
        const t = grid.tiles[idx];
        const h2 = rng(idx * 2713);
        const ox = (h2 * 2 - 1) * 0.45 * scale;
        const oz = (((h2 * 12289.0) % 1) * 2 - 1) * 0.45 * scale;
        const i3 = alive * 3;
        iOffset[i3 + 0] = wx + ox;
        iOffset[i3 + 1] = hm.sample(wx + ox, wz + oz) + 0.2;
        iOffset[i3 + 2] = wz + oz;
        iSize[alive] = 0.6 + 0.8 * (1 - t.heat);
        iAngle[alive] = h2 * Math.PI * 2;
        iFBase[alive] = atlasInfo.smokeBase; // smolder uses smoke frames
        iFCount[alive] = atlasInfo.smokeFrames;
        iF0[alive] = Math.floor(h2 * atlasInfo.smokeFrames);
        iRate[alive] = 4 + 3 * lod;
        iAspect[alive] = 1.1 + 0.3 * (1.0 - t.heat);
        iPhase[alive] = h2;
        iRise[alive] = 0.8 + 0.4 * lod; // gentle rise for smolder
        // a bit lighter/whiter for smolder
        iColor[i3 + 0] = 0.82; iColor[i3 + 1] = 0.82; iColor[i3 + 2] = 0.82;
        alive++;
      }
    }

    mesh.count = alive;
    (mesh.geometry.getAttribute('iOffset') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iSize') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iAngle') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iF0') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iRate') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iColor') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iAspect') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iPhase') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iFBase') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iFCount') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iRise') as any).needsUpdate = true;
  }

  return { group, update, setQuality, setEnabled } as const;
}
