import { Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, RingGeometry } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { HydrantSystem } from './hydrants';

/**
 * Draws a faint, ground-hugging ring at each active hydrant's coverage
 * radius. Makes the 1.5x-suppression zone legible to the player.
 */
export function createHydrantCoverageRings(hm: Heightmap, maxHydrants = 500) {
  // Unit ring (inner 0.95, outer 1.00) scaled per-instance to the hydrant radius.
  const ring = new RingGeometry(0.95, 1.0, 48);
  ring.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({
    color: new Color(0x4aa0ff),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: DoubleSide,
  });
  const inst = new InstancedMesh(ring, mat, maxHydrants);
  (inst as any).count = 0;
  inst.visible = false;
  inst.frustumCulled = false;
  inst.renderOrder = 6;

  const tmp = new Object3D();
  const m = new Matrix4();

  const update = (system: HydrantSystem) => {
    let idx = 0;
    for (const h of system.hydrants) {
      if (!h.active) continue;
      if (idx >= maxHydrants) break;
      const wx = h.worldPos.x;
      const wz = h.worldPos.z;
      const wy = hm.sample(wx, wz) + 0.08;
      const r = h.coverageRadius * hm.scale;
      tmp.position.set(wx, wy, wz);
      tmp.scale.set(r, 1, r);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      m.copy(tmp.matrix);
      inst.setMatrixAt(idx++, m);
    }
    (inst as any).count = idx;
    inst.instanceMatrix.needsUpdate = true;
  };

  const setVisible = (v: boolean) => { inst.visible = v; };

  return { inst, update, setVisible } as const;
}
