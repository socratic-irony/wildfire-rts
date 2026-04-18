import { describe, it, expect } from 'vitest';
import { MidlineIndex } from '../midlineIndex';

function straightPath(x0: number, z0: number, x1: number, z1: number, n = 10) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t });
  }
  return pts;
}

describe('MidlineIndex', () => {
  it('returns null when empty', () => {
    const idx = new MidlineIndex();
    idx.build([], 4);
    expect(idx.nearest(0, 0)).toBeNull();
    expect(idx.size()).toBe(0);
  });

  it('finds the closest segment on a single straight road', () => {
    const idx = new MidlineIndex();
    idx.build([straightPath(0, 0, 100, 0)], 5);

    const r = idx.nearest(50, 3);
    expect(r).not.toBeNull();
    expect(r!.point.z).toBeCloseTo(0, 5);
    expect(r!.point.x).toBeCloseTo(50, 5);
    expect(r!.distance).toBeCloseTo(3, 5);

    // Tangent should point along +x; normal rotated 90° CCW → -z direction.
    expect(r!.tangent.x).toBeCloseTo(1, 5);
    expect(r!.tangent.z).toBeCloseTo(0, 5);
    expect(r!.normal.x).toBeCloseTo(0, 5);
    expect(r!.normal.z).toBeCloseTo(1, 5);
  });

  it('picks the closer of two parallel paths', () => {
    const idx = new MidlineIndex();
    idx.build(
      [straightPath(0, 0, 100, 0), straightPath(0, 20, 100, 20)],
      5,
    );

    const near0 = idx.nearest(50, 1);
    const near1 = idx.nearest(50, 19);
    expect(near0!.pathIdx).toBe(0);
    expect(near1!.pathIdx).toBe(1);
  });

  it('matches brute-force across a random query batch', () => {
    const paths = [
      straightPath(0, 0, 50, 0, 25),
      straightPath(0, 30, 50, 30, 25),
      straightPath(25, 0, 25, 30, 15),
      straightPath(0, 0, 50, 30, 30), // diagonal
    ];

    const idx = new MidlineIndex();
    idx.build(paths, 3);

    // Brute-force reference
    const allSegs: Array<{ pathIdx: number; segIdx: number; ax: number; az: number; bx: number; bz: number }> = [];
    for (let pi = 0; pi < paths.length; pi++) {
      for (let si = 0; si < paths[pi].length - 1; si++) {
        allSegs.push({
          pathIdx: pi, segIdx: si,
          ax: paths[pi][si].x, az: paths[pi][si].z,
          bx: paths[pi][si + 1].x, bz: paths[pi][si + 1].z,
        });
      }
    }

    const dist2 = (q: {x: number; z: number}, s: typeof allSegs[number]) => {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const len2 = dx * dx + dz * dz;
      let t = ((q.x - s.ax) * dx + (q.z - s.az) * dz) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = s.ax + t * dx, pz = s.az + t * dz;
      const ex = q.x - px, ez = q.z - pz;
      return ex * ex + ez * ez;
    };

    let rng = 1234567;
    const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };

    for (let k = 0; k < 50; k++) {
      const q = { x: rand() * 60 - 5, z: rand() * 40 - 5 };
      let bestD2 = Infinity;
      for (const s of allSegs) {
        const d2 = dist2(q, s);
        if (d2 < bestD2) bestD2 = d2;
      }
      const r = idx.nearest(q.x, q.z);
      expect(r).not.toBeNull();
      expect(r!.distance * r!.distance).toBeCloseTo(bestD2, 5);
    }
  });

  it('handles queries outside the grid bounds', () => {
    const idx = new MidlineIndex();
    idx.build([straightPath(0, 0, 10, 0)], 2);

    const r = idx.nearest(-50, 0);
    expect(r).not.toBeNull();
    expect(r!.point.x).toBeCloseTo(0, 5);
  });

  it('returns unit-length tangent and normal', () => {
    const idx = new MidlineIndex();
    idx.build([straightPath(0, 0, 30, 40, 5)], 4); // 3-4-5 triangle direction

    const r = idx.nearest(15, 20)!;
    const tlen = Math.hypot(r.tangent.x, r.tangent.z);
    const nlen = Math.hypot(r.normal.x, r.normal.z);
    expect(tlen).toBeCloseTo(1, 5);
    expect(nlen).toBeCloseTo(1, 5);
    // Normal perpendicular to tangent
    const dot = r.tangent.x * r.normal.x + r.tangent.z * r.normal.z;
    expect(dot).toBeCloseTo(0, 5);
  });
});
