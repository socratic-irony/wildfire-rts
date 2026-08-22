import {
  AdditiveBlending,
  Camera,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { FireGrid } from '../fire/grid';

/** Hard cap on simultaneous ember instances. */
export const EMBER_CAP = 1500;

/** Hash-seeded [0,1) generator, same family as the flipbook rng(i). */
function hash01(i: number): number {
  let x = (i * 1664525 + 1013904223) | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0xffffffff;
}

/**
 * Pure spawn selection: given a burning-frontier length, a seed and a cap,
 * returns up to `cap` slot indices in [0, bCount). Deterministic for identical
 * inputs; jittered stride sampling keeps selections spread across the frontier
 * without duplicates.
 */
export function selectEmberSources(bCount: number, seed: number, cap: number): Uint32Array {
  const total = Math.max(0, Math.floor(bCount));
  const limit = Math.max(0, Math.floor(cap));
  const n = Math.min(total, limit);
  const out = new Uint32Array(n);
  if (total <= limit) {
    for (let k = 0; k < n; k++) out[k] = k;
    return out;
  }
  const stride = total / n;
  for (let k = 0; k < n; k++) {
    const jitter = hash01(k * 747796405 + seed * 2891336453);
    let idx = Math.floor(k * stride + jitter * stride);
    if (idx > total - 1) idx = total - 1;
    out[k] = idx >>> 0;
  }
  return out;
}

export function createEmbers(hm: Heightmap) {
  const group = new Group();
  const quad = new PlaneGeometry(1, 1);
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      cameraRight: { value: new Vector3(1, 0, 0) },
      cameraUp: { value: new Vector3(0, 1, 0) },
      uWindDir: { value: new Vector2(0, 1) },
      uWindSpeed: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec3 cameraRight;
      uniform vec3 cameraUp;
      uniform vec2 uWindDir;
      uniform float uWindSpeed;
      attribute vec3 iOffset;
      attribute vec4 iPack; // x=size, y=phase(seed), z=spiralAmp, w=loopRate
      varying float vLife;
      varying float vSeed;
      varying vec2 vUv;
      void main() {
        float iSize = iPack.x;
        float iPhase = iPack.y;
        float iAmp = iPack.z;
        float iRate = iPack.w;
        float lifeT = fract(iPhase + uTime * iRate);
        vLife = lifeT;
        vSeed = iPhase;
        vUv = position.xy + 0.5;
        vec3 world = iOffset;
        // buoyant rise
        world.y += lifeT * (0.9 + 0.9 * fract(iPhase * 7.31));
        // downwind drift (windDirRad convention: 0 = +Z, pi/2 = +X)
        world.xz += uWindDir * (uWindSpeed * 0.4 * lifeT);
        // per-seed spiral wander
        float ang = uTime * (1.2 + 2.2 * fract(iPhase * 13.7)) + iPhase * 6.2831853;
        world.x += cos(ang) * iAmp * lifeT;
        world.z += sin(ang * 1.13) * iAmp * lifeT;
        gl_Position = projectionMatrix * viewMatrix *
          vec4(world + cameraRight * (position.x * iSize) + cameraUp * (position.y * iSize), 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying float vLife;
      varying float vSeed;
      varying vec2 vUv;
      void main() {
        // warm orange -> deep red over life
        vec3 hot = vec3(1.55, 0.85, 0.25);   // HDR-bright young ember (feeds bloom)
        vec3 cool = vec3(0.55, 0.08, 0.02);  // dying deep red
        vec3 col = mix(hot, cool, smoothstep(0.15, 0.9, vLife));
        float twinkle = 0.8 + 0.2 * sin((vSeed * 41.0 + vLife * 25.0));
        float d = length(vUv - 0.5);
        float disc = smoothstep(0.5, 0.12, d);
        float fade = 1.0 - smoothstep(0.45, 1.0, vLife);
        float a = disc * fade * twinkle;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const mesh = new InstancedMesh(quad, mat, EMBER_CAP);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.count = 0;

  const iOffset = new Float32Array(EMBER_CAP * 3);
  const iPack = new Float32Array(EMBER_CAP * 4);
  mesh.geometry.setAttribute('iOffset', new InstancedBufferAttribute(iOffset, 3));
  mesh.geometry.setAttribute('iPack', new InstancedBufferAttribute(iPack, 4));

  group.add(mesh);

  let enabled = true;

  function update(
    grid: FireGrid,
    env: { windDirRad: number; windSpeed: number },
    dt: number,
    camera: Camera,
  ) {
    mat.uniforms.uTime.value += dt;
    const m = (camera as any).matrixWorld.elements as number[];
    (mat.uniforms.cameraRight.value as Vector3).set(m[0], m[1], m[2]);
    (mat.uniforms.cameraUp.value as Vector3).set(m[4], m[5], m[6]);
    (mat.uniforms.uWindDir.value as Vector2).set(Math.sin(env.windDirRad), Math.cos(env.windDirRad));
    mat.uniforms.uWindSpeed.value = env.windSpeed;

    if (!enabled) {
      mesh.count = 0;
      return;
    }

    const slots = selectEmberSources(grid.bCount, grid.seed, EMBER_CAP);
    const width = grid.width;
    const scale = hm.scale;
    let alive = 0;
    for (let k = 0; k < slots.length && alive < EMBER_CAP; k++) {
      const idx = grid.burning[slots[k]] | 0;
      const gx = idx % width;
      const gz = (idx / width) | 0;
      const wx = (gx + 0.5) * scale;
      const wz = (gz + 0.5) * scale;
      const h1 = hash01(idx * 131 + 17);
      const h2 = (((h1 * 65537.0) % 1) + ((idx % 97) * 0.0103)) % 1;
      const ox = (h1 * 2 - 1) * 0.35 * scale;
      const oz = (h2 * 2 - 1) * 0.35 * scale;
      const heat = grid.heat[idx] ?? 0.5;
      const i3 = alive * 3;
      const i4 = alive * 4;
      iOffset[i3 + 0] = wx + ox;
      iOffset[i3 + 1] = hm.sample(wx + ox, wz + oz) + 0.25 + 0.5 * h1;
      iOffset[i3 + 2] = wz + oz;
      iPack[i4 + 0] = 0.05 + 0.07 * hash01(idx * 31 + k); // size 0.05..0.12 world units
      iPack[i4 + 1] = hash01(idx * 613 + k * 7);          // phase/seed drives loop offset
      iPack[i4 + 2] = 0.18 + 0.32 * h2;                   // spiral amplitude
      iPack[i4 + 3] = 0.35 + 0.5 * heat;                  // loop rate (hotter = livelier)
      alive++;
    }
    mesh.count = alive;
    (mesh.geometry.getAttribute('iOffset') as any).needsUpdate = true;
    (mesh.geometry.getAttribute('iPack') as any).needsUpdate = true;
  }

  function setEnabled(on: boolean) {
    enabled = on;
    mesh.visible = on;
    if (!on) mesh.count = 0;
  }

  return {
    group,
    update,
    setEnabled,
    updateTerrain: (newHeightmap: Heightmap) => {
      hm = newHeightmap;
    },
  } as const;
}
