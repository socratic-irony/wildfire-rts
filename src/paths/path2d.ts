export type V2 = { x: number; z: number };

export const v2 = {
  sub: (a: V2, b: V2): V2 => ({ x: a.x - b.x, z: a.z - b.z }),
  add: (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z }),
  dot: (a: V2, b: V2) => a.x * b.x + a.z * b.z,
  len: (a: V2) => Math.hypot(a.x, a.z),
  mul: (a: V2, s: number): V2 => ({ x: a.x * s, z: a.z * s }),
  norm: (a: V2): V2 => { const L = Math.hypot(a.x, a.z) || 1; return { x: a.x / L, z: a.z / L }; }
};

export class Path2D {
  pts: V2[];
  segLens: number[] = [];
  cum: number[] = [];
  length = 0;
  closed = false;

  constructor(pts: V2[], opts?: { closed?: boolean }) {
    if (!pts || pts.length < 2) throw new Error('Path2D needs ≥2 points');
    this.pts = pts;
    this.closed = !!opts?.closed;
    this.build();
  }

  private build() {
    this.segLens.length = 0; this.cum.length = 0; this.length = 0;
    const n = this.pts.length;
    const segCount = this.closed ? n : (n - 1);
    for (let i = 0; i < segCount; i++) {
      const a = this.pts[i];
      const b = this.pts[(i + 1) % n];
      const L = v2.len(v2.sub(b, a));
      const s = Math.max(L, 1e-6);
      this.segLens.push(s);
      this.cum.push(this.length);
      this.length += s;
    }
    this.cum.push(this.length);
  }

  sample(s: number) {
    if (this.closed) {
      // wrap into [0, length)
      s = ((s % this.length) + this.length) % this.length;
    } else {
      s = Math.max(0, Math.min(this.length, s));
    }
    let lo = 0, hi = this.cum.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const segMax = this.closed ? this.pts.length - 1 : this.pts.length - 2;
    const i = Math.min(segMax, lo);
    const segS = s - this.cum[i];
    const u = segS / this.segLens[i];
    const a = this.pts[i], b = this.pts[(i + 1) % this.pts.length];
    const p = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u } as const;
    const t = v2.norm(v2.sub(b, a));
    return { p, t, i, u } as const;
  }

  project(q: V2) {
    let bestS = 0, bestD2 = Infinity, bestI = 0, bestU = 0;
    let acc = 0;
    const n = this.pts.length;
    const segCount = this.closed ? n : (n - 1);
    for (let i = 0; i < segCount; i++) {
      const a = this.pts[i], b = this.pts[(i + 1) % n];
      const ab = v2.sub(b, a); const abL2 = Math.max(1e-6, v2.dot(ab, ab));
      const aq = v2.sub(q, a);
      let u = Math.max(0, Math.min(1, v2.dot(aq, ab) / abL2));
      const px = a.x + ab.x * u, pz = a.z + ab.z * u;
      const dx = q.x - px, dz = q.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestS = acc + Math.sqrt(Math.max(1e-9, v2.dot({ x: ab.x * u, z: ab.z * u }, { x: ab.x * u, z: ab.z * u }))); bestI = i; bestU = u; }
      acc += Math.sqrt(abL2);
    }
    return { s: bestS, dist: Math.sqrt(bestD2), i: bestI, u: bestU } as const;
  }

  curvature(s: number, ds = 2) {
    const A = this.sample(Math.max(0, s - ds)).p;
    const B = this.sample(s).p;
    const C = this.sample(Math.min(this.length, s + ds)).p;
    const v1 = v2.norm(v2.sub(B, A));
    const v2n = v2.norm(v2.sub(C, B));
    const dot = Math.max(-1, Math.min(1, v1.x * v2n.x + v1.z * v2n.z));
    const ang = Math.acos(dot);
    return ang / (2 * ds);
  }
}
