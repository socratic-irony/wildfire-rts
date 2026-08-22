import { Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three';
import { Heightmap } from '../terrain/heightmap';
import { FireGrid } from './grid';

export type FirelineOverlayOpts = {
  threshold?: number;
  offsetY?: number;
  /** Base color (tan/dirt). */
  color?: number | string;
  opacity?: number;
};

/**
 * Visualizes bulldozer-cut firelines by drawing a translucent dirt patch
 * on every tile whose `lineStrength` exceeds the threshold.
 *
 * Pattern mirrors `createFireOverlay`: one InstancedMesh, ground-aligned
 * unit planes positioned per tile, `count` set per update.
 */
export function createFirelineOverlay(hm: Heightmap, opts: FirelineOverlayOpts = {}) {
  const threshold = opts.threshold ?? 0.5;
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({
    color: new Color(opts.color ?? 0xb8904a),
    transparent: true,
    opacity: opts.opacity ?? 0.6,
    depthWrite: false,
    side: DoubleSide,
  });
  const capacity = hm.width * hm.height;
  const inst = new InstancedMesh(plane, mat, capacity);
  (inst as any).count = 0;
  inst.frustumCulled = false;
  inst.renderOrder = 5;

  const tmp = new Object3D();
  const m = new Matrix4();
  const offsetY = opts.offsetY ?? 0.04;

  const update = (grid: FireGrid) => {
    if (!inst.visible) {
      (inst as any).count = 0;
      inst.instanceMatrix.needsUpdate = true;
      return;
    }
    let idx = 0;
    const half = hm.scale * 0.5;
    const scl = hm.scale * 0.95;
    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.lineStrength[z * grid.width + x] <= threshold) continue;
        if (idx >= capacity) break;
        const wx = x * hm.scale + half;
        const wz = z * hm.scale + half;
        const wy = hm.sample(wx, wz) + offsetY;
        tmp.position.set(wx, wy, wz);
        tmp.scale.set(scl, 1, scl);
        tmp.rotation.set(0, 0, 0);
        tmp.updateMatrix();
        m.copy(tmp.matrix);
        inst.setMatrixAt(idx++, m);
      }
    }
    (inst as any).count = idx;
    inst.instanceMatrix.needsUpdate = true;
  };

  const setVisible = (v: boolean) => { inst.visible = v; };

  return { inst, update, setVisible } as const;
}
