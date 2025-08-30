import { AdditiveBlending, Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3 } from 'three';
import { Heightmap } from '../terrain/heightmap';
import { FireGrid, FireState, coordToIndex, indexToCoord } from './grid';

// Renders thin red edge quads around the perimeter of Burning ∪ Smoldering tiles
export function createFirePerimeter(hm: Heightmap, opts?: { offsetY?: number; widthScale?: number; renderOrder?: number; segments?: number }) {
  const SEG = Math.max(2, Math.floor(opts?.segments ?? 8));
  const segLen = hm.scale / SEG;           // segment edge length
  const lineWidth = (opts?.widthScale ?? 0.05) * hm.scale; // thin line
  const quad = new PlaneGeometry(segLen, lineWidth);
  // Orient plane horizontally (X axis along length, Z across width)
  quad.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({ color: new Color('#ff2a2a'), transparent: true, opacity: 0.9, depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, blending: AdditiveBlending, side: DoubleSide });
  const cap = hm.width * hm.height * 2 * SEG; // account for segmentation
  const inst = new InstancedMesh(quad, mat, cap);
  (inst as any).count = 0;
  inst.frustumCulled = false;
  if (opts?.renderOrder !== undefined) inst.renderOrder = opts.renderOrder;

  const tmp = new Object3D();
  const m = new Matrix4();
  const half = hm.scale * 0.5;
  let yOffset = opts?.offsetY ?? 0.0;

  function isActive(grid: FireGrid, x: number, z: number) {
    if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) return false;
    const t = grid.tiles[coordToIndex(grid, x, z)];
    return t.state === FireState.Burning || t.state === FireState.Smoldering;
  }

  const update = (grid: FireGrid) => {
    let idx = 0;
    const addEdge = (cx: number, cz: number, dir: 0 | 1) => {
      const eps = Math.max(0.25 * hm.scale, lineWidth * 2);
      if (dir === 0) {
        // Horizontal edge at integer z, spanning x in [cx-0.5, cx+0.5]
        const zc = cz * hm.scale + half;
        const xStart = (cx - 0.5) * hm.scale + half;
        for (let s = 0; s < SEG; s++) {
          const x0 = xStart + s * segLen;
          const x1 = x0 + segLen;
          const y0 = hm.sample(x0, zc) + yOffset;
          const y1 = hm.sample(x1, zc) + yOffset;
          const xc = (x0 + x1) * 0.5;
          const z2 = zc + eps;
          const y2 = hm.sample(xc, z2) + yOffset;
          const p0 = new Vector3(x0, y0, zc);
          const p1 = new Vector3(x1, y1, zc);
          const p2 = new Vector3(xc, y2, z2);
          const tangent = p1.clone().sub(p0);
          const len = Math.max(1e-5, tangent.length());
          tangent.multiplyScalar(1 / len);
          const center = p0.clone().add(p1).multiplyScalar(0.5);
          const wVec = p2.clone().sub(center);
          let normal = tangent.clone().cross(wVec).normalize();
          if (!isFinite(normal.x + normal.y + normal.z)) normal.set(0, 1, 0);
          const zAxis = normal.clone().cross(tangent).normalize();
          const rot = new Matrix4().makeBasis(tangent, normal, zAxis);
          tmp.position.copy(center);
          tmp.setRotationFromMatrix(rot);
          tmp.updateMatrix();
          m.copy(tmp.matrix);
          inst.setMatrixAt(idx++, m);
        }
      } else {
        // Vertical edge at integer x, spanning z in [cz-0.5, cz+0.5]
        const xc = cx * hm.scale + half;
        const zStart = (cz - 0.5) * hm.scale + half;
        for (let s = 0; s < SEG; s++) {
          const z0 = zStart + s * segLen;
          const z1 = z0 + segLen;
          const y0 = hm.sample(xc, z0) + yOffset;
          const y1 = hm.sample(xc, z1) + yOffset;
          const zc2 = (z0 + z1) * 0.5;
          const x2 = xc + eps;
          const y2 = hm.sample(x2, zc2) + yOffset;
          const p0 = new Vector3(xc, y0, z0);
          const p1 = new Vector3(xc, y1, z1);
          const p2 = new Vector3(x2, y2, zc2);
          const tangent = p1.clone().sub(p0);
          const len = Math.max(1e-5, tangent.length());
          tangent.multiplyScalar(1 / len);
          const center = p0.clone().add(p1).multiplyScalar(0.5);
          const wVec = p2.clone().sub(center);
          let normal = tangent.clone().cross(wVec).normalize();
          if (!isFinite(normal.x + normal.y + normal.z)) normal.set(0, 1, 0);
          const zAxis = normal.clone().cross(tangent).normalize();
          const rot = new Matrix4().makeBasis(tangent, normal, zAxis);
          tmp.position.copy(center);
          tmp.setRotationFromMatrix(rot);
          tmp.updateMatrix();
          m.copy(tmp.matrix);
          inst.setMatrixAt(idx++, m);
        }
      }
    };

    // Scan active tiles and add edge quads only where neighbor is not active
    for (let k = 0; k < grid.bCount; k++) {
      const i = grid.burning[k];
      const c = indexToCoord(grid, i);
      // Top edge (z-)
      if (!isActive(grid, c.x, c.z - 1)) addEdge(c.x, c.z - 0.5, 0);
      // Bottom edge (z+)
      if (!isActive(grid, c.x, c.z + 1)) addEdge(c.x, c.z + 0.5, 0);
      // Left edge (x-)
      if (!isActive(grid, c.x - 1, c.z)) addEdge(c.x - 0.5, c.z, 1);
      // Right edge (x+)
      if (!isActive(grid, c.x + 1, c.z)) addEdge(c.x + 0.5, c.z, 1);
    }
    for (let k = 0; k < grid.sCount; k++) {
      const i = grid.smoldering[k];
      const c = indexToCoord(grid, i);
      if (!isActive(grid, c.x, c.z - 1)) addEdge(c.x, c.z - 0.5, 0);
      if (!isActive(grid, c.x, c.z + 1)) addEdge(c.x, c.z + 0.5, 0);
      if (!isActive(grid, c.x - 1, c.z)) addEdge(c.x - 0.5, c.z, 1);
      if (!isActive(grid, c.x + 1, c.z)) addEdge(c.x + 0.5, c.z, 1);
    }

    (inst as any).count = idx;
    inst.instanceMatrix.needsUpdate = true;
  };

  const setOffsetY = (y: number) => { yOffset = y; };
  return { inst, update, setOffsetY } as const;
}
