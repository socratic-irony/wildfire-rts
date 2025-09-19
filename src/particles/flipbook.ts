import {
  Camera,
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
      attribute vec4 iPack1; // x=size, y=angle, z=f0, w=rate
      attribute vec4 iPack2; // x=fBase, y=fCount, z=aspect, w=phase
      attribute vec4 iPack3; // x=rise, y=colorR, z=colorG, w=colorB
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vFrame;
      void main() {
        // Unpack attributes
        float iSize = iPack1.x;
        float iAngle = iPack1.y;
        float iF0 = iPack1.z;
        float iRate = iPack1.w;
        float iFBase = iPack2.x;
        float iFCount = iPack2.y;
        float iAspect = iPack2.z;
        float iPhase = iPack2.w;
        float iRise = iPack3.x;
        vec3 iColor = iPack3.yzw;
        
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

type ParticleQuality = 'low' | 'med' | 'high';

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
  // Per-instance attributes (packed to reduce attribute count)
  const iOffset = new Float32Array(caps.total * 3);
  const iPack1 = new Float32Array(caps.total * 4); // size, angle, f0, rate
  const iPack2 = new Float32Array(caps.total * 4); // fBase, fCount, aspect, phase
  const iPack3 = new Float32Array(caps.total * 4); // rise, colorR, colorG, colorB
  mesh.geometry.setAttribute('iOffset', new InstancedBufferAttribute(iOffset, 3));
  mesh.geometry.setAttribute('iPack1', new InstancedBufferAttribute(iPack1, 4));
  mesh.geometry.setAttribute('iPack2', new InstancedBufferAttribute(iPack2, 4));
  mesh.geometry.setAttribute('iPack3', new InstancedBufferAttribute(iPack3, 4));

  group.add(mesh);

  function setQuality(q: ParticleQuality) {
    if (q === 'low') caps.total = 4000; else if (q === 'high') caps.total = 12000; else caps.total = 8000;
  }
  function setEnabled(part: Partial<typeof enabled>) { Object.assign(enabled, part); mesh.visible = enabled.flames || enabled.smoke; }

  function rng(i: number) { let x = i * 1664525 + 1013904223; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0xffffffff; }

  function update(grid: FireGrid, env: { windDirRad: number; windSpeed: number }, dt: number, camera: Camera) {
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
            const i4 = alive * 4;
            iOffset[i3 + 0] = wx + ox;
            iOffset[i3 + 1] = hm.sample(wx + ox, wz + oz) + 0.45;
            iOffset[i3 + 2] = wz + oz;
            // Pack attributes into vec4s
            iPack1[i4 + 0] = 0.6 + 0.8 * heat; // size
            iPack1[i4 + 1] = h * Math.PI * 2;   // angle
            iPack1[i4 + 2] = Math.floor(h * atlasInfo.flameFrames); // f0
            iPack1[i4 + 3] = 8 + 8 * heat * lod; // rate
            iPack2[i4 + 0] = atlasInfo.flameBase;     // fBase
            iPack2[i4 + 1] = atlasInfo.flameFrames;   // fCount
            iPack2[i4 + 2] = 1.6 + 0.4 * heat;       // aspect
            iPack2[i4 + 3] = h;                       // phase
            iPack3[i4 + 0] = 0.30 + 0.35 * heat;     // rise
            iPack3[i4 + 1] = 1.0;                     // colorR
            iPack3[i4 + 2] = 0.85;                    // colorG
            iPack3[i4 + 3] = 0.6;                     // colorB
            alive++;
          }
        }
        // Smoke (occasional)
        if (enabled.smoke && alive < caps.total && heat > 0.2) {
          const h2 = rng(idx * 977);
          const ox = (h2 * 2 - 1) * 0.4 * scale;
          const oz = (((h2 * 8191.0) % 1) * 2 - 1) * 0.4 * scale;
          const i3 = alive * 3;
          const i4 = alive * 4;
          iOffset[i3 + 0] = wx + ox;
          iOffset[i3 + 1] = hm.sample(wx + ox, wz + oz) + 0.2;
          iOffset[i3 + 2] = wz + oz;
          // Pack attributes into vec4s
          iPack1[i4 + 0] = 0.8 + 1.2 * heat;          // size
          iPack1[i4 + 1] = h2 * Math.PI * 2;          // angle
          iPack1[i4 + 2] = Math.floor(h2 * atlasInfo.smokeFrames); // f0
          iPack1[i4 + 3] = 6 + 4 * lod;               // rate
          iPack2[i4 + 0] = atlasInfo.smokeBase;        // fBase
          iPack2[i4 + 1] = atlasInfo.smokeFrames;      // fCount
          iPack2[i4 + 2] = 1.2 + 0.3 * (1.0 - heat);  // aspect
          iPack2[i4 + 3] = h2;                         // phase
          iPack3[i4 + 0] = 1.2 + 0.8 * lod;           // rise
          iPack3[i4 + 1] = 0.7;                        // colorR
          iPack3[i4 + 2] = 0.7;                        // colorG
          iPack3[i4 + 3] = 0.7;                        // colorB
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
        const i4 = alive * 4;
        iOffset[i3 + 0] = wx + ox;
        iOffset[i3 + 1] = hm.sample(wx + ox, wz + oz) + 0.2;
        iOffset[i3 + 2] = wz + oz;
        // Pack attributes into vec4s
        iPack1[i4 + 0] = 0.6 + 0.8 * (1 - t.heat);      // size
        iPack1[i4 + 1] = h2 * Math.PI * 2;               // angle
        iPack1[i4 + 2] = Math.floor(h2 * atlasInfo.smokeFrames); // f0
        iPack1[i4 + 3] = 4 + 3 * lod;                    // rate
        iPack2[i4 + 0] = atlasInfo.smokeBase;             // fBase (smolder uses smoke frames)
        iPack2[i4 + 1] = atlasInfo.smokeFrames;           // fCount
        iPack2[i4 + 2] = 1.1 + 0.3 * (1.0 - t.heat);     // aspect
        iPack2[i4 + 3] = h2;                              // phase
        iPack3[i4 + 0] = 0.8 + 0.4 * lod;                // rise (gentle rise for smolder)
        iPack3[i4 + 1] = 0.82;                            // colorR (a bit lighter/whiter for smolder)
        iPack3[i4 + 2] = 0.82;                            // colorG
        iPack3[i4 + 3] = 0.82;                            // colorB
        alive++;
      }
    }

    mesh.count = alive;
    (mesh.geometry.getAttribute('iOffset') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iPack1') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iPack2') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iPack3') as any).needsUpdate = true;
  }

  return { 
    group, 
    update, 
    setQuality, 
    setEnabled,
    updateTerrain: (newHeightmap: Heightmap) => {
      // Update internal heightmap reference
      hm = newHeightmap;
    }
  } as const;
}
