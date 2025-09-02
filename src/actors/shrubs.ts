import { Color, DodecahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Shader } from 'three';
import { Heightmap } from '../terrain/heightmap';
import { BiomeMask } from '../terrain/biomes';
import type { FireGrid } from '../fire/grid';
import { FireState } from '../fire/grid';

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function createShrubs(hm: Heightmap, biomes: BiomeMask, opts: { density?: number } = {}) {
  const geo = new DodecahedronGeometry(0.35, 0);
  const mat = new MeshStandardMaterial({ color: new Color('#6FA06F'), flatShading: true, roughness: 0.9 });
  mat.onBeforeCompile = (s: Shader) => {
    s.uniforms.uTime = { value: 0 };
    s.vertexShader = s.vertexShader.replace(
      '#include <common>',
      `#include <common>\n uniform float uTime;`
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n float sway = sin(uTime * 1.5 + position.y) * 0.03;\n transformed.x += sway;`
    );
    (mat as any).userData.shader = s;
  };

  const rng = seededRng(67890);
  const cols = hm.width;
  const rows = hm.height;
  const positions: { x: number; z: number; y: number; rot: number; scale: number; gx: number; gz: number }[] = [];
  const density = opts.density ?? 0.15;
  for (let z = 1; z < rows; z += 1) {
    for (let x = 1; x < cols; x += 1) {
      const i = z * (cols + 1) + x;
      if (!biomes.chaparral[i]) continue;
      if (rng() < density) {
        const jx = (rng() - 0.5) * 0.8;
        const jz = (rng() - 0.5) * 0.8;
        const wx = (x + jx) * hm.scale;
        const wz = (z + jz) * hm.scale;
        const wy = hm.sample(wx, wz);
        const gx = Math.max(0, Math.min(hm.width - 1, Math.round(wx / hm.scale)));
        const gz = Math.max(0, Math.min(hm.height - 1, Math.round(wz / hm.scale)));
        positions.push({ x: wx, z: wz, y: wy, rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.4, gx, gz });
      }
    }
  }

  const inst = new InstancedMesh(geo, mat, positions.length);
  inst.castShadow = inst.receiveShadow = true;

  const m = new Matrix4();
  const temp = new Object3D();
  for (let i = 0; i < positions.length; i++) {
    const it = positions[i];
    temp.position.set(it.x, it.y + 0.2 * it.scale, it.z);
    temp.rotation.set(0, it.rot, 0);
    temp.scale.setScalar(it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    inst.setMatrixAt(i, m);
    // initialize instance colors to white (no tint)
    ;(inst as any).setColorAt(i, new Color(1,1,1));
  }
  if (inst.instanceColor) (inst.instanceColor as any).needsUpdate = true;

  const update = (time: number) => {
    const s = (mat as any).userData?.shader;
    if (s) s.uniforms.uTime.value = time;
  };

  const applyFireTint = (grid: FireGrid) => {
    let any = false;
    const colForState = (state: FireState): Color => {
      if (state === FireState.Burned) return new Color(0.08, 0.08, 0.08);
      if (state === FireState.Smoldering) return new Color(0.60, 0.40, 0.25);
      if (state === FireState.Burning) return new Color(0.75, 0.65, 0.55);
      return new Color(1, 1, 1);
    };
    for (let i = 0; i < positions.length; i++) {
      const it = positions[i];
      const idx = it.gz * grid.width + it.gx;
      const state = grid.tiles[idx]?.state ?? 0;
      (inst as any).setColorAt(i, colForState(state));
      any = true;
    }
    if (any && inst.instanceColor) (inst.instanceColor as any).needsUpdate = true;
  };

  return { inst, update, applyFireTint };
}
