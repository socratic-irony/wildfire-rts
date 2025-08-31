import { Color, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { BiomeMask } from '../terrain/biomes';

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function createRocks(hm: Heightmap, biomes: BiomeMask) {
  // Distorted low-poly rock: start from icosahedron, apply slight vertex jitter
  const baseGeo = new IcosahedronGeometry(0.5, 0);
  const pos = baseGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const j = i * 3;
    const dx = (Math.random() - 0.5) * 0.12;
    const dy = (Math.random() - 0.5) * 0.10;
    const dz = (Math.random() - 0.5) * 0.12;
    (pos.array as Float32Array)[j + 0] += dx;
    (pos.array as Float32Array)[j + 1] += dy;
    (pos.array as Float32Array)[j + 2] += dz;
  }
  baseGeo.computeVertexNormals();

  const mat = new MeshStandardMaterial({ color: new Color('#9A8C98'), flatShading: true, roughness: 0.95, metalness: 0 });

  // Scatter rules: prefer rock biome and steeper/higher elevations; low density
  const rng = seededRng(24680);
  const cols = hm.width;
  const rows = hm.height;
  const instances: { x: number; z: number; y: number; rot: number; sx: number; sy: number; sz: number }[] = [];
  for (let z = 2; z < rows; z += 2) {
    for (let x = 2; x < cols; x += 2) {
      const i = z * (cols + 1) + x;
      const rockish = biomes.rock[i] || (hm.data[i] > 6 ? 1 : 0);
      if (!rockish) continue;
      if (rng() < 0.08) {
        const wx = (x + (rng() - 0.5) * 0.6) * hm.scale;
        const wz = (z + (rng() - 0.5) * 0.6) * hm.scale;
        const wy = hm.sample(wx, wz);
        const yaw = rng() * Math.PI * 2;
        const s = 0.6 + rng() * 0.9;
        // Slight anisotropic scale to break uniformity
        const sx = s * (0.8 + rng() * 0.4);
        const sy = s * (0.7 + rng() * 0.6);
        const sz = s * (0.8 + rng() * 0.4);
        instances.push({ x: wx, z: wz, y: wy, rot: yaw, sx, sy, sz });
      }
    }
  }

  const inst = new InstancedMesh(baseGeo, mat, instances.length);
  inst.castShadow = true;
  inst.receiveShadow = true;
  const m = new Matrix4();
  const temp = new Object3D();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < instances.length; i++) {
    const it = instances[i];
    temp.position.set(it.x, it.y + it.sy * 0.5, it.z);
    temp.rotation.set(0, it.rot, 0);
    temp.scale.set(it.sx, it.sy, it.sz);
    temp.updateMatrix();
    m.copy(temp.matrix);
    inst.setMatrixAt(i, m);
  }

  const update = (_time: number) => { /* rocks are static */ };
  return { inst, update };
}

