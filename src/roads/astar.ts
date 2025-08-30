export type GridPoint = { x: number; z: number };

export type CostField = {
  width: number;
  height: number;
  costAt: (x: number, z: number, stepDir: { dx: number; dz: number }, prevDir?: { dx: number; dz: number }) => number;
};

export type AStarOpts = {
  diag?: boolean;       // allow diagonals
  heuristic?: 'euclid' | 'manhattan';
  maxIter?: number;     // safety cap
};

export function aStarPath(field: CostField, start: GridPoint, goal: GridPoint, opts: AStarOpts = {}) {
  const W = field.width, H = field.height;
  const diag = opts.diag ?? true;
  const maxIter = opts.maxIter ?? (W * H * 4);
  const dirs4 = [ [1,0],[-1,0],[0,1],[0,-1] ];
  const dirs8 = [ ...dirs4, [1,1],[1,-1],[-1,1],[-1,-1] ];
  const dirs = diag ? dirs8 : dirs4;

  function h(x: number, z: number) {
    if (opts.heuristic === 'manhattan') return Math.abs(goal.x - x) + Math.abs(goal.z - z);
    const dx = goal.x - x, dz = goal.z - z; return Math.hypot(dx, dz);
  }

  const toKey = (x: number, z: number) => z * W + x;
  const open = new MinHeap((a: number, b: number) => f[a] - f[b]);
  const g = new Float32Array(W * H).fill(Infinity);
  const f = new Float32Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const cameDx = new Int8Array(W * H).fill(0);
  const cameDz = new Int8Array(W * H).fill(0);

  const sKey = toKey(start.x, start.z);
  g[sKey] = 0; f[sKey] = h(start.x, start.z);
  open.push(sKey);

  let iters = 0;
  while (!open.empty() && iters++ < maxIter) {
    const cur = open.pop()!;
    const cx = cur % W; const cz = (cur / W) | 0;
    if (cx === goal.x && cz === goal.z) break;

    const pdx = cameDx[cur] || 0, pdz = cameDz[cur] || 0;
    for (const [dx, dz] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const nk = toKey(nx, nz);
      const step = Math.hypot(dx, dz);
      const c = field.costAt(nx, nz, { dx, dz }, { dx: pdx, dz: pdz });
      if (!isFinite(c)) continue;
      const ng = g[cur] + step * c;
      if (ng < g[nk]) {
        came[nk] = cur; g[nk] = ng; f[nk] = ng + h(nx, nz);
        cameDx[nk] = dx; cameDz[nk] = dz;
        open.pushOrDecrease(nk);
      }
    }
  }

  // Reconstruct
  const path: GridPoint[] = [];
  let k = toKey(goal.x, goal.z);
  if (!isFinite(g[k])) return []; // no path
  while (k !== -1) {
    path.push({ x: k % W, z: (k / W) | 0 });
    k = came[k];
  }
  path.reverse();
  return path;
}

class MinHeap<T extends number> {
  private data: T[] = [];
  private loc = new Map<T, number>();
  constructor(private cmp: (a: T, b: T) => number) {}
  empty() { return this.data.length === 0; }
  push(x: T) { this.data.push(x); this.loc.set(x, this.data.length - 1); this.up(this.data.length - 1); }
  pop(): T | undefined { if (!this.data.length) return undefined; const r = this.data[0]; const x = this.data.pop()!; this.loc.delete(r); if (this.data.length) { this.data[0] = x; this.loc.set(x, 0); this.down(0); } return r; }
  pushOrDecrease(x: T) { const i = this.loc.get(x); if (i == null) this.push(x); else { this.up(i); this.down(i); } }
  private up(i: number) { const a = this.data; const cmp = this.cmp; while (i > 0) { const p = (i - 1) >> 1; if (cmp(a[i], a[p]) >= 0) break; this.swap(i, p); i = p; } }
  private down(i: number) { const a = this.data; const cmp = this.cmp; while (true) { let l = i * 2 + 1, r = l + 1, m = i; if (l < a.length && cmp(a[l], a[m]) < 0) m = l; if (r < a.length && cmp(a[r], a[m]) < 0) m = r; if (m === i) break; this.swap(i, m); i = m; } }
  private swap(i: number, j: number) { const t = this.data[i]; this.data[i] = this.data[j]; this.data[j] = t; this.loc.set(this.data[i], i); this.loc.set(this.data[j], j); }
}
