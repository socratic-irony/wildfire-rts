import { Color, DodecahedronGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from 'three';
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
  const mat = new MeshStandardMaterial({ color: new Color('#ffffff'), flatShading: true, roughness: 0.9 });
  mat.onBeforeCompile = (shader: any) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n uniform float uTime;`
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n float sway = sin(uTime * 1.5 + position.y) * 0.03;\n transformed.x += sway;`
    );
    (mat as any).userData.shader = shader;
  };

  const rng = seededRng(67890);
  const cols = hm.width;
  const rows = hm.height;
  type ShrubInst = {
    x: number; z: number; y: number; rot: number;
    scale: number; squash: number;
    gx: number; gz: number; baseCol: Color;
  };
  const positions: ShrubInst[] = [];
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
        // Per-instance hue range: sage greens through dry olive.
        const baseCol = new Color('#6FA06F');
        baseCol.offsetHSL((rng() - 0.5) * 0.08, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.12);
        positions.push({
          x: wx, z: wz, y: wy, rot: rng() * Math.PI * 2,
          scale: 0.8 + rng() * 0.4, squash: 0.55 + rng() * 0.6,
          gx, gz, baseCol,
        });
      }
    }
  }

  const inst = new InstancedMesh(geo, mat, positions.length);
  inst.castShadow = inst.receiveShadow = true;
  const group = new Group();
  group.name = 'shrubs';
  group.add(inst);

  const m = new Matrix4();
  const temp = new Object3D();
  for (let i = 0; i < positions.length; i++) {
    const it = positions[i];
    temp.position.set(it.x, it.y + 0.2 * it.scale * it.squash, it.z);
    temp.rotation.set(0, it.rot, 0);
    temp.scale.set(it.scale, it.scale * it.squash, it.scale);
    temp.updateMatrix();
    m.copy(temp.matrix);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, it.baseCol);
  }
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

  const update = (time: number) => {
    const s = (mat as any).userData?.shader;
    if (s) s.uniforms.uTime.value = time;
  };

  const tmpFactor = new Color();
  const tmpOut = new Color();
  const applyFireTint = (grid: FireGrid) => {
    const factorForState = (state: FireState): Color | null => {
      if (state === FireState.Burned) return tmpFactor.setRGB(0.1, 0.1, 0.1);
      if (state === FireState.Smoldering) return tmpFactor.setRGB(0.75, 0.5, 0.32);
      if (state === FireState.Burning) return tmpFactor.setRGB(0.95, 0.62, 0.4);
      return null;
    };
    for (let i = 0; i < positions.length; i++) {
      const it = positions[i];
      const idx = it.gz * grid.width + it.gx;
      const state = grid.tiles[idx]?.state ?? FireState.Unburned;
      const f = factorForState(state);
      inst.setColorAt(i, f ? tmpOut.copy(it.baseCol).multiply(f) : it.baseCol);
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  };

  return { group, inst, update, applyFireTint };
}
