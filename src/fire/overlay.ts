import { AdditiveBlending, Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3 } from 'three';
import { Heightmap } from '../terrain/heightmap';
import { FireGrid, FireState, indexToCoord } from './grid';

export function createFireOverlay(hm: Heightmap) {
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({ color: new Color('#ff5a1f'), transparent: true, opacity: 0.7, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, vertexColors: true });
  const inst = new InstancedMesh(plane, mat, 1);
  (inst as any).count = 0;
  inst.frustumCulled = false;

  const tmp = new Object3D();
  const m = new Matrix4();
  const up = new Vector3();

  const update = (grid: FireGrid) => {
    // Render only Burning and Smoldering tiles to keep instance count low
    const total = grid.bCount + grid.sCount;
    if (total !== (inst as any).count) {
      // Recreate with new capacity if needed
      if (total > inst.count) {
        // Type limitation: InstancedMesh.count is readonly in TS types but runtime allows
        (inst as any).count = total;
        inst.instanceMatrix.needsUpdate = true;
      }
    }
    let idx = 0;
    const half = hm.scale * 0.5;
    const scl = hm.scale * 0.95;
    for (let k = 0; k < grid.bCount; k++) {
      const ci = grid.burning[k];
      const c = indexToCoord(grid, ci);
      const wx = c.x * hm.scale + half;
      const wz = c.z * hm.scale + half;
      const wy = hm.sample(wx, wz) + 0.05;
      const s = 0.75 + grid.tiles[ci].heat * 0.5;
      tmp.position.set(wx, wy, wz);
      tmp.scale.set(scl * s, 1, scl * s);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      m.copy(tmp.matrix);
      inst.setMatrixAt(idx++, m);
      const col = new Color().setHSL(0.05 + 0.05 * grid.tiles[ci].heat, 1.0, 0.5);
      inst.setColorAt(idx - 1, col);
    }
    for (let k = 0; k < grid.sCount; k++) {
      const ci = grid.smoldering[k];
      const c = indexToCoord(grid, ci);
      const wx = c.x * hm.scale + half;
      const wz = c.z * hm.scale + half;
      const wy = hm.sample(wx, wz) + 0.05;
      const s = 0.6 + grid.tiles[ci].heat * 0.3;
      tmp.position.set(wx, wy, wz);
      tmp.scale.set(scl * s, 1, scl * s);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      m.copy(tmp.matrix);
      inst.setMatrixAt(idx++, m);
      const col = new Color().setHSL(0.08, 0.8, 0.35);
      inst.setColorAt(idx - 1, col);
    }
    (inst as any).count = idx;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  };

  return { inst, update };
}
