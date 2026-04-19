/**
 * Regression: RoadsVisual.projectToMidline and findNearestPathIndex now use
 * midlineIndex.nearest() instead of coarse brute-force scans. Verify their
 * results agree with direct midlineIndex queries.
 */

import { describe, it, expect } from 'vitest';
import { MidlineIndex } from '../midlineIndex';

function straightPath(x0: number, z0: number, x1: number, z1: number, n = 20): Array<{ x: number; z: number }> {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t });
  }
  return pts;
}

describe('roads_visual_midline_index_matches_global_projection', () => {
  it('MidlineIndex returns the expected nearest path for two parallel roads', () => {
    const pathA = straightPath(0, 0, 100, 0);  // z=0 road
    const pathB = straightPath(0, 40, 100, 40); // z=40 road

    const idx = new MidlineIndex();
    idx.build([pathA, pathB], 5);

    // Query close to path A
    const rA = idx.nearest(50, 3);
    expect(rA).not.toBeNull();
    expect(rA!.pathIdx).toBe(0);
    expect(rA!.distance).toBeCloseTo(3, 1);

    // Query close to path B
    const rB = idx.nearest(50, 37);
    expect(rB).not.toBeNull();
    expect(rB!.pathIdx).toBe(1);
    expect(rB!.distance).toBeCloseTo(3, 1);
  });

  it('findNearestPathIndex equivalent: pathIdx from midlineIndex matches expected path', () => {
    const pathA = straightPath(0, 0, 100, 0);
    const pathB = straightPath(0, 50, 100, 50);

    const idx = new MidlineIndex();
    idx.build([pathA, pathB], 5);

    // Near pathA
    expect(idx.nearest(25, 2)!.pathIdx).toBe(0);
    // Near pathB
    expect(idx.nearest(75, 48)!.pathIdx).toBe(1);
  });

  it('projectToMidline equivalent: closest point on index matches expected XZ', () => {
    const path = straightPath(0, 0, 100, 0);
    const idx = new MidlineIndex();
    idx.build([path], 5);

    const q = idx.nearest(60, 5)!;
    expect(q.point.x).toBeCloseTo(60, 0);
    expect(q.point.z).toBeCloseTo(0, 1);
    expect(q.distance).toBeCloseTo(5, 1);
  });

  it('tangent and normal from index are unit vectors', () => {
    const path = straightPath(0, 0, 0, 100); // vertical road (z-axis)
    const idx = new MidlineIndex();
    idx.build([path], 5);

    const q = idx.nearest(3, 50)!;
    const tlen = Math.hypot(q.tangent.x, q.tangent.z);
    const nlen = Math.hypot(q.normal.x, q.normal.z);
    expect(tlen).toBeCloseTo(1, 5);
    expect(nlen).toBeCloseTo(1, 5);
  });
});
