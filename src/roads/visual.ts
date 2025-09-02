import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector2, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';

export class RoadsVisual {
  public group = new Group();
  private mat = new MeshStandardMaterial({ color: 0x666666, roughness: 0.95, metalness: 0.0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  private shoulderMat = new MeshBasicMaterial({ color: 0x6e563e, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private stripeMat = new MeshBasicMaterial({ color: 0xcfd3d6, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, vertexColors: true });
  private yOffset = 0.05;
  private hm: Heightmap;
  private paths: Vector2[][] = [];
  private cumS: number[][] = [];
  private closedFlags: boolean[] = [];

  // Spatial index for segments (uniform grid)
  private gridCellSize = 0; // set on first path add
  private gridW = 0; private gridH = 0;
  private grid: number[][] = []; // cell -> segment indices
  private segs: Array<{ path: number; i: number; a: Vector2; b: Vector2; len: number }>=[];

  // Intersections cache
  private intersections: Array<{ id: number; pos: Vector2; a:{path:number;s:number;seg:number;t:number}; b:{path:number;s:number;seg:number;t:number} }> = [];
  private perPathIntersections: Array<Array<{ id:number; s:number; pos: Vector2; otherPath:number; otherS:number }>> = [];
  constructor(hm: Heightmap) { this.hm = hm; }

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.paths = [];
    this.cumS = [];
    this.closedFlags = [];
    this.grid = [];
    this.segs = [];
    this.intersections = [];
    this.perPathIntersections = [];
  }

  // Expose smoothed midlines as world XZ arrays for controllers
  getMidlinesXZ(): Array<Array<{ x: number; z: number }>> {
    return this.paths.map(path => path.map(p => ({ x: p.x, z: p.y })));
  }

  // Public API remains compatible; scale/y ignored (derived from heightmap)
  addPath(points: Array<{ x: number; z: number }>, _scale?: number, _y?: number) {
    if (!points || points.length < 2) return;
    const scale = this.hm.scale;
    let centers = points.map(p => new Vector2((p.x + 0.5) * scale, (p.z + 0.5) * scale));
    // Detect closed loop if first and last are near; remove duplicate last if repeated
    const closed = centers.length > 2 && Math.hypot(centers[0].x - centers[centers.length - 1].x, centers[0].y - centers[centers.length - 1].y) < scale * 1.0;
    if (closed) {
      // remove duplicate endpoint to avoid zero-length seam
      if (Math.hypot(centers[0].x - centers[centers.length - 1].x, centers[0].y - centers[centers.length - 1].y) < 1e-3) {
        centers = centers.slice(0, centers.length - 1);
      }
    }
    const simplified = simplifyRDP(centers, scale * 0.2, closed);
    const smooth = catmullRomAdaptiveResample(simplified, { maxSegLen: scale * 0.25, sagEps: closed ? scale * 0.01 : scale * 0.02, closed });
    const width = 0.5 * scale; // approx half tile width
    // Store smoothed midline for projection queries
    const mid = smooth.map(p => p.clone());
    const pathIndex = this.paths.length;
    this.paths.push(mid);
    this.closedFlags[pathIndex] = closed;
    // Build cumulative s for this path
    const cum: number[] = []; let accS = 0;
    const M = mid.length; const segCount = closed ? M : (M - 1);
    for (let i = 0; i < segCount; i++) {
      cum.push(accS);
      const a = mid[i]; const b = mid[(i + 1) % M];
      accS += Math.hypot(b.x - a.x, b.y - a.y);
    }
    cum.push(accS);
    this.cumS[pathIndex] = cum;
    // Accumulate segments for spatial index
    for (let i = 0; i < segCount; i++) {
      const a = mid[i]; const b = mid[(i + 1) % M];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
      this.segs.push({ path: pathIndex, i, a, b, len });
    }
    this.perPathIntersections[pathIndex] = [];
    // Main road surface
    {
      const { positions, colors, indices } = buildRibbonStrip(smooth, width, this.hm, this.yOffset, closed);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new Mesh(geo, this.mat);
      mesh.renderOrder = 6;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // Shoulders: faint dusty brown bands outside the road
    {
      const shoulder = Math.max(0.25 * scale, 0.3 * width);
      const { positions, colors, indices } = buildShoulderBands(smooth, width, shoulder, this.hm, this.yOffset * 0.8, closed);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      const mesh = new Mesh(geo, this.shoulderMat);
      mesh.renderOrder = 7;
      this.group.add(mesh);
    }
    // Center stripe: dashed gray line along midline
    {
      const stripeWidth = 0.12 * scale;
      const dash = 1.2 * scale;
      const gap = 0.8 * scale;
      const geo = buildCenterDashed(smooth, stripeWidth, dash, gap, this.hm, this.yOffset + 0.02, closed);
      const mesh = new Mesh(geo, this.stripeMat);
      mesh.renderOrder = 8;
      this.group.add(mesh);
    }
  }

  // Build or rebuild the spatial index and compute segment intersections
  buildIntersections() {
    // Init grid
    const scale = this.hm.scale;
    this.gridCellSize = this.gridCellSize || (scale * 2);
    this.grid = [];
    const W = Math.ceil(this.hm.width * scale / this.gridCellSize);
    const H = Math.ceil(this.hm.height * scale / this.gridCellSize);
    this.gridW = W; this.gridH = H;
    for (let i = 0; i < W * H; i++) this.grid[i] = [];
    const cellOf = (x: number, z: number) => {
      const cx = Math.max(0, Math.min(W - 1, Math.floor(x / this.gridCellSize)));
      const cz = Math.max(0, Math.min(H - 1, Math.floor(z / this.gridCellSize)));
      return cz * W + cx;
    };
    // Insert segments into grid cells
    for (let si = 0; si < this.segs.length; si++) {
      const s = this.segs[si];
      const minx = Math.min(s.a.x, s.b.x), maxx = Math.max(s.a.x, s.b.x);
      const minz = Math.min(s.a.y, s.b.y), maxz = Math.max(s.a.y, s.b.y);
      const c0x = Math.max(0, Math.floor(minx / this.gridCellSize));
      const c1x = Math.min(W - 1, Math.floor(maxx / this.gridCellSize));
      const c0z = Math.max(0, Math.floor(minz / this.gridCellSize));
      const c1z = Math.min(H - 1, Math.floor(maxz / this.gridCellSize));
      for (let cz = c0z; cz <= c1z; cz++) {
        for (let cx = c0x; cx <= c1x; cx++) this.grid[cz * W + cx].push(si);
      }
    }
    // Find intersections
    const seen = new Set<string>();
    this.intersections = [];
    this.perPathIntersections = this.perPathIntersections.map(() => []);
    const segsAtCell = (x: number, z: number) => this.grid[z * W + x];
    const addInt = (pos: Vector2, A: typeof this.segs[number], tA: number, B: typeof this.segs[number], tB: number) => {
      const sA = this.cumS[A.path][A.i] + tA * A.len;
      const sB = this.cumS[B.path][B.i] + tB * B.len;
      const id = this.intersections.length;
      this.intersections.push({ id, pos: new Vector2(pos.x, pos.y), a: { path: A.path, s: sA, seg: A.i, t: tA }, b: { path: B.path, s: sB, seg: B.i, t: tB } });
      this.perPathIntersections[A.path].push({ id, s: sA, pos: new Vector2(pos.x, pos.y), otherPath: B.path, otherS: sB });
      this.perPathIntersections[B.path].push({ id, s: sB, pos: new Vector2(pos.x, pos.y), otherPath: A.path, otherS: sA });
    };
    const segSeg = (a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2) => {
      const ax = a2.x - a1.x, az = a2.y - a1.y;
      const bx = b2.x - b1.x, bz = b2.y - b1.y;
      const den = ax * bz - az * bx;
      if (Math.abs(den) < 1e-6) return null;
      const dx = b1.x - a1.x, dz = b1.y - a1.y;
      const ua = (dx * bz - dz * bx) / den; // along A
      const ub = (dx * az - dz * ax) / den; // along B
      if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
      return { ua, ub, x: a1.x + ua * ax, y: a1.y + ua * az };
    };
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        const list = segsAtCell(cx, cz);
        for (let i = 0; i < list.length; i++) {
          const ai = list[i]; const A = this.segs[ai];
          for (let j = i + 1; j < list.length; j++) {
            const bi = list[j]; const B = this.segs[bi];
            // Skip adjacent segments on same path
            if (A.path === B.path) {
              const same = Math.abs(A.i - B.i) <= 1 || (this.closedFlags[A.path] && ((A.i === 0 && B.i === this.cumS[A.path].length - 2) || (B.i === 0 && A.i === this.cumS[A.path].length - 2)));
              if (same) continue;
            }
            const key = ai < bi ? `${ai}-${bi}` : `${bi}-${ai}`;
            if (seen.has(key)) continue; seen.add(key);
            const res = segSeg(A.a, A.b, B.a, B.b);
            if (res) addInt(new Vector2(res.x, res.y), A, res.ua, B, res.ub);
          }
        }
      }
    }
    // sort per path by s
    for (let p = 0; p < this.perPathIntersections.length; p++) this.perPathIntersections[p].sort((a,b)=>a.s-b.s);
  }

  getNextIntersection(pathIndex: number, s: number, lookahead = 6): { id:number; s:number; dist:number; pos:{x:number;z:number} } | null {
    const list = this.perPathIntersections[pathIndex] || [];
    if (!list.length) return null;
    const L = this.cumS[pathIndex][this.cumS[pathIndex].length - 1] || 0;
    // find first with s'>=s
    let best: any = null;
    for (const it of list) {
      let ds = it.s - s;
      if (this.closedFlags[pathIndex]) {
        if (ds < 0) ds += L;
      } else if (ds < 0) continue;
      if (ds <= lookahead && (best == null || ds < best.dist)) best = { id: it.id, s: it.s, dist: ds, pos: { x: it.pos.x, z: it.pos.y } };
    }
    return best;
  }

  // Expose all intersections for a path (sorted by s)
  getIntersectionsForPath(pathIndex: number) {
    const list = this.perPathIntersections[pathIndex] || [];
    return list.map(it => ({ id: it.id, s: it.s, pos: { x: it.pos.x, z: it.pos.y }, otherPath: it.otherPath, otherS: it.otherS }));
  }

  getPathLength(pathIndex: number) {
    const p = this.paths[pathIndex];
    if (!p) return 0;
    // length in world meters
    const cum = this.cumS[pathIndex];
    return cum && cum.length ? cum[cum.length - 1] : 0;
  }

  isPathClosed(pathIndex: number) { return !!this.closedFlags[pathIndex]; }

  // Enhanced projection: return s along path
  projectToMidlineOnPathWithS(pathIndex: number, wx: number, wz: number, hintSeg?: number, window = 96) {
    const res = this.projectToMidlineOnPath(pathIndex, wx, wz, hintSeg, window);
    if (!res) return null;
    const path = this.paths[pathIndex];
    const segIndex = res.segIndex ?? 0;
    const a = path[segIndex]; const b = path[(segIndex + 1) % path.length];
    const abx = b.x - a.x, abz = b.y - a.y;
    const apx = res.pos.x - a.x, apz = res.pos.z - a.y;
    const ab2 = abx * abx + abz * abz || 1e-6;
    const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
    const len = Math.hypot(abx, abz) || 1e-6;
    const s = this.cumS[pathIndex][segIndex] + t * len;
    return { ...res, s } as const;
  }

  // Project a world XZ point to the nearest point on any road midline and return pos/normal/tangent
  projectToMidline(wx: number, wz: number) {
    if (this.paths.length === 0) return null as null;
    let best: { px: number; pz: number; abx: number; abz: number } | null = null;
    let bestD2 = Infinity;
    for (const path of this.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const apx = wx - a.x, apz = wz - a.y; // Vector2: y holds z
        const abx = b.x - a.x, abz = b.y - a.y;
        const ab2 = abx * abx + abz * abz || 1e-6;
        let t = (apx * abx + apz * abz) / ab2; t = Math.max(0, Math.min(1, t));
        const px = a.x + abx * t;
        const pz = a.y + abz * t;
        const dx = wx - px, dz = wz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = { px, pz, abx, abz }; }
      }
    }
    if (!best) return null as null;
    const n = sampleNormal(this.hm, best.px, best.pz);
    const y = this.hm.sample(best.px, best.pz);
    const pos = new Vector3(best.px, y, best.pz).addScaledVector(n, this.yOffset);
    const len = Math.hypot(best.abx, best.abz) || 1;
    const tangent = new Vector3(best.abx / len, 0, best.abz / len);
    return { pos, normal: n, tangent } as const;
  }

  // Find nearest path index using a coarse scan
  findNearestPathIndex(wx: number, wz: number) {
    if (this.paths.length === 0) return -1;
    let bestIdx = -1, bestD2 = Infinity;
    for (let p = 0; p < this.paths.length; p++) {
      const path = this.paths[p];
      // sample every Nth point for speed
      const step = Math.max(1, Math.floor(path.length / 64));
      for (let i = 0; i < path.length; i += step) {
        const x = path[i].x, z = path[i].y;
        const dx = wx - x, dz = wz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestIdx = p; }
      }
    }
    return bestIdx;
  }

  // Project to a specific path index (optionally with a segment hint to limit search)
  projectToMidlineOnPath(pathIndex: number, wx: number, wz: number, hintSeg?: number, window = 96) {
    if (pathIndex < 0 || pathIndex >= this.paths.length) return this.projectToMidline(wx, wz);
    const path = this.paths[pathIndex];
    let best: { px: number; pz: number; abx: number; abz: number; i: number } | null = null;
    let bestD2 = Infinity;
    let iStart = 0, iEnd = path.length - 2;
    if (hintSeg != null && path.length > 2) {
      iStart = Math.max(0, Math.min(path.length - 2, hintSeg - window));
      iEnd = Math.max(iStart, Math.min(path.length - 2, hintSeg + window));
    } else if (path.length > 128) {
      // coarse pass to find a neighborhood quickly
      const step = Math.max(1, Math.floor((path.length - 1) / 64));
      let coarseIdx = 0;
      for (let i = 0; i < path.length - 1; i += step) {
        const a = path[i]; const b = path[i + 1];
        const apx = wx - a.x, apz = wz - a.y; const abx = b.x - a.x, abz = b.y - a.y;
        const ab2 = abx * abx + abz * abz || 1e-6;
        let t = (apx * abx + apz * abz) / ab2; t = Math.max(0, Math.min(1, t));
        const px = a.x + abx * t; const pz = a.y + abz * t;
        const dx = wx - px, dz = wz - pz; const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = { px, pz, abx, abz, i }; coarseIdx = i; }
      }
      iStart = Math.max(0, coarseIdx - window);
      iEnd = Math.min(path.length - 2, coarseIdx + window);
      best = null; bestD2 = Infinity;
    }
    for (let i = iStart; i <= iEnd; i++) {
      const a = path[i];
      const b = path[i + 1];
      const apx = wx - a.x, apz = wz - a.y;
      const abx = b.x - a.x, abz = b.y - a.y;
      const ab2 = abx * abx + abz * abz || 1e-6;
      let t = (apx * abx + apz * abz) / ab2; t = Math.max(0, Math.min(1, t));
      const px = a.x + abx * t;
      const pz = a.y + abz * t;
      const dx = wx - px, dz = wz - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = { px, pz, abx, abz, i }; }
    }
    if (!best) return null as null;
    const n = sampleNormal(this.hm, best.px, best.pz);
    const y = this.hm.sample(best.px, best.pz);
    const pos = new Vector3(best.px, y, best.pz).addScaledVector(n, this.yOffset);
    const len = Math.hypot(best.abx, best.abz) || 1;
    const tangent = new Vector3(best.abx / len, 0, best.abz / len);
    return { pos, normal: n, tangent, segIndex: best.i } as const;
  }
}

function buildRibbonStrip(path: Vector2[], width: number, hm: Heightmap, yOffset: number, closed = false) {
  const half = width * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const lefts: Vector3[] = [];
  const mids: Vector3[] = [];
  const rights: Vector3[] = [];
  const nls: Vector3[] = [];
  const nms: Vector3[] = [];
  const nrs: Vector3[] = [];

  const N = path.length;
  for (let i = 0; i < N; i++) {
    const p = path[i];
    const pPrev = closed ? path[(i - 1 + N) % N] : path[Math.max(0, i - 1)];
    const pNext = closed ? path[(i + 1) % N] : path[Math.min(N - 1, i + 1)];
    const tx = pNext.x - pPrev.x;
    const tz = pNext.y - pPrev.y;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len; // left normal (xz plane)
    const nz = tx / len;
    // left/center/right world positions
    const lx = p.x + nx * half;
    const lz = p.y + nz * half;
    const cx = p.x;
    const cz = p.y;
    const rx = p.x - nx * half;
    const rz = p.y - nz * half;
    const ly0 = hm.sample(lx, lz);
    const cy0 = hm.sample(cx, cz);
    const ry0 = hm.sample(rx, rz);
    const nl = sampleNormal(hm, lx, lz);
    const nm = sampleNormal(hm, cx, cz);
    const nr = sampleNormal(hm, rx, rz);
    lefts.push(new Vector3(lx, ly0, lz).addScaledVector(nl, yOffset));
    mids.push(new Vector3(cx, cy0, cz).addScaledVector(nm, yOffset));
    rights.push(new Vector3(rx, ry0, rz).addScaledVector(nr, yOffset));
    nls.push(nl); nms.push(nm); nrs.push(nr);
  }

  // build vertices/colors (L, M, R per sample)
  for (let i = 0; i < path.length; i++) {
    const L = lefts[i], M = mids[i], R = rights[i];
    positions.push(L.x, L.y, L.z, M.x, M.y, M.z, R.x, R.y, R.z);
    // slightly lighter edges and a darker center strip
    const edge = [0.76, 0.76, 0.76];
    const mid = [0.64, 0.64, 0.64];
    colors.push(...edge, ...mid, ...edge);
  }
  // indices: stitch between (L,M,R) at i and i+1 -> four triangles (two quads)
  for (let i = 0; i < N - 1; i++) {
    const iL = i * 3;
    const iM = i * 3 + 1;
    const iR = i * 3 + 2;
    const jL = (i + 1) * 3;
    const jM = (i + 1) * 3 + 1;
    const jR = (i + 1) * 3 + 2;
    // left quad
    indices.push(iL, jL, iM, iM, jL, jM);
    // right quad
    indices.push(iM, jM, iR, iR, jM, jR);
  }
  // stitch last to first if closed
  if (closed && N > 1) {
    const i = N - 1;
    const iL = i * 3, iM = i * 3 + 1, iR = i * 3 + 2;
    const jL = 0, jM = 1, jR = 2;
    indices.push(iL, jL, iM, iM, jL, jM);
    indices.push(iM, jM, iR, iR, jM, jR);
  }
  return { positions, colors, indices };
}

// Ramer–Douglas–Peucker simplification on 2D points
function simplifyRDP(pts: Vector2[], eps: number, closed = false): Vector2[] {
  if (pts.length <= 2) return pts.slice();
  if (!closed) {
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    function distPointSeg(p: Vector2, a: Vector2, b: Vector2) {
      const abx = b.x - a.x, abz = b.y - a.y;
      const apx = p.x - a.x, apz = p.y - a.y;
      const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / (abx * abx + abz * abz || 1)));
      const cx = a.x + t * abx, cz = a.y + t * abz;
      return Math.hypot(p.x - cx, p.y - cz);
    }
    function recurse(i0: number, i1: number) {
      let maxD = -1, idx = -1;
      for (let i = i0 + 1; i < i1; i++) {
        const d = distPointSeg(pts[i], pts[i0], pts[i1]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx !== -1) {
        keep[idx] = true;
        recurse(i0, idx);
        recurse(idx, i1);
      }
    }
    recurse(0, pts.length - 1);
    const out: Vector2[] = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }
  // Closed: approximate by rotating, simplifying open, then rotating back
  const N = pts.length;
  const mid = Math.floor(N / 2);
  const rotated = pts.slice(mid).concat(pts.slice(0, mid));
  const open = simplifyRDP(rotated, eps, false);
  // Rotate back to original order (find rotated[0])
  const idx0 = open.findIndex(p => p.x === rotated[0].x && p.y === rotated[0].y);
  const back = idx0 >= 0 ? open.slice(idx0).concat(open.slice(0, idx0)) : open;
  // Remove potential duplicate last==first
  const out: Vector2[] = [];
  for (let i = 0; i < back.length; i++) {
    const a = back[i], b = back[(i + 1) % back.length];
    out.push(a);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) i++;
  }
  return out;
}

// Catmull-Rom resampling for smoother curves
// Catmull-Rom adaptive resampling using midpoint sag error and max segment length
function catmullRomAdaptiveResample(pts: Vector2[], opts: { maxSegLen: number; sagEps: number; closed?: boolean }): Vector2[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vector2[] = [];
  const closed = !!opts.closed;
  const P = (i: number) => closed ? pts[(i % pts.length + pts.length) % pts.length] : pts[Math.max(0, Math.min(pts.length - 1, i))];

  // Centripetal Catmull–Rom point evaluation (alpha=0.5)
  const centripetalCR = (p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t01: number) => {
    const alpha = 0.5;
    const td = (a: Vector2, b: Vector2) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha) || 1e-6;
    const t0 = 0;
    const t1 = t0 + td(p0, p1);
    const t2 = t1 + td(p1, p2);
    const t3 = t2 + td(p2, p3);
    const u = t1 + t01 * (t2 - t1); // map [0,1] -> [t1,t2]
    const lerp = (A: Vector2, B: Vector2, ta: number, tb: number) => {
      const denom = (tb - ta) || 1e-6;
      const w = (u - ta) / denom;
      return new Vector2(
        A.x + (B.x - A.x) * w,
        A.y + (B.y - A.y) * w,
      );
    };
    const A1 = lerp(p0, p1, t0, t1);
    const A2 = lerp(p1, p2, t1, t2);
    const A3 = lerp(p2, p3, t2, t3);
    const B1 = lerp(A1, A2, t0, t2);
    const B2 = lerp(A2, A3, t1, t3);
    const C = lerp(B1, B2, t1, t2);
    return C;
  };

  const subdivide = (p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2) => {
    const a = p1.clone();
    const b = p2.clone();
    const stack: Array<{ t0: number; t1: number; A: Vector2; B: Vector2 }> = [{ t0: 0, t1: 1, A: a, B: b }];
    const segs: Vector2[] = [];
    while (stack.length) {
      const { t0, t1, A, B } = stack.pop()!;
      const midT = (t0 + t1) * 0.5;
      const M = centripetalCR(p0, p1, p2, p3, midT);
      // linear midpoint between A and B
      const Lx = (A.x + B.x) * 0.5;
      const Lz = (A.y + B.y) * 0.5; // careful: Vector2.y is our z coordinate
      const sag = Math.hypot(M.x - Lx, M.y - Lz);
      const segLen = Math.hypot(B.x - A.x, B.y - A.y);
      if (sag > opts.sagEps || segLen > opts.maxSegLen) {
        // split
        stack.push({ t0: midT, t1, A: M, B });
        stack.push({ t0, t1: midT, A, B: M });
      } else {
        segs.push(B);
      }
    }
    return segs;
  };

  const last = closed ? pts.length : (pts.length - 1);
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    if (i === 0) out.push(p1.clone());
    const seg = subdivide(p0, p1, p2, p3);
    for (const s of seg) out.push(s);
  }
  if (closed) out.pop();
  return out;
}

function sampleNormal(hm: Heightmap, wx: number, wz: number) {
  const eps = hm.scale * 0.35; // finite difference step in world units
  const hL = hm.sample(wx - eps, wz);
  const hR = hm.sample(wx + eps, wz);
  const hD = hm.sample(wx, wz - eps);
  const hU = hm.sample(wx, wz + eps);
  const Hx = (hR - hL) / (2 * eps);
  const Hz = (hU - hD) / (2 * eps);
  const n = new Vector3(-Hx, 1, -Hz);
  n.normalize();
  return n;
}

// Build faint shoulder bands outside the road surface
function buildShoulderBands(path: Vector2[], width: number, shoulder: number, hm: Heightmap, yOffset: number, closed = false) {
  const half = width * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const OL: Vector3[] = [], L: Vector3[] = [], R: Vector3[] = [], OR: Vector3[] = [];
  const N = path.length;
  for (let i = 0; i < N; i++) {
    const p = path[i];
    const pPrev = closed ? path[(i - 1 + N) % N] : path[Math.max(0, i - 1)];
    const pNext = closed ? path[(i + 1) % N] : path[Math.min(N - 1, i + 1)];
    const tx = pNext.x - pPrev.x;
    const tz = pNext.y - pPrev.y;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len, nz = tx / len;
    const lx = p.x + nx * half;
    const lz = p.y + nz * half;
    const rx = p.x - nx * half;
    const rz = p.y - nz * half;
    const olx = p.x + nx * (half + shoulder);
    const olz = p.y + nz * (half + shoulder);
    const orx = p.x - nx * (half + shoulder);
    const orz = p.y - nz * (half + shoulder);
    const nl = sampleNormal(hm, lx, lz);
    const nr = sampleNormal(hm, rx, rz);
    const nol = sampleNormal(hm, olx, olz);
    const nor = sampleNormal(hm, orx, orz);
    L.push(new Vector3(lx, hm.sample(lx, lz), lz).addScaledVector(nl, yOffset));
    R.push(new Vector3(rx, hm.sample(rx, rz), rz).addScaledVector(nr, yOffset));
    OL.push(new Vector3(olx, hm.sample(olx, olz), olz).addScaledVector(nol, yOffset));
    OR.push(new Vector3(orx, hm.sample(orx, orz), orz).addScaledVector(nor, yOffset));
  }
  for (let i = 0; i < path.length; i++) {
    const a = OL[i], b = L[i], c = R[i], d = OR[i];
    // vertices order: OL, L, R, OR
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    // color gradient: outer darker brown, inner slightly lighter
    const outer = [0.41, 0.33, 0.25];
    const inner = [0.53, 0.44, 0.35];
    colors.push(...outer, ...inner, ...inner, ...outer);
  }
  for (let i = 0; i < N - 1; i++) {
    const base = i * 4;
    const next = (i + 1) * 4;
    // left shoulder quad (OL-L)
    indices.push(base + 0, next + 0, base + 1, base + 1, next + 0, next + 1);
    // right shoulder quad (R-OR)
    indices.push(base + 2, next + 2, base + 3, base + 3, next + 2, next + 3);
  }
  if (closed && N > 1) {
    const base = (N - 1) * 4;
    const next = 0;
    indices.push(base + 0, next + 0, base + 1, base + 1, next + 0, next + 1);
    indices.push(base + 2, next + 2, base + 3, base + 3, next + 2, next + 3);
  }
  return { positions, colors, indices };
}

// Build a dashed center stripe along the midline
function buildCenterDashed(path: Vector2[], stripeWidth: number, dashLen: number, gapLen: number, hm: Heightmap, yOffset: number, closed = false) {
  const geo = new BufferGeometry();
  const pos: number[] = [];
  const idx: number[] = [];
  const col: number[] = [];
  const halfW = stripeWidth * 0.5;
  const cycle = dashLen + gapLen;
  let acc = 0; // accumulated distance along path in world units
  let last = path[0];
  let vert = 0;
  const N = path.length;
  const segCount = closed ? N : (N - 1);
  for (let si = 0; si < segCount; si++) {
    const aIdx = si;
    const bIdx = (si + 1) % N;
    const cur = path[bIdx];
    const segLen = Math.hypot(cur.x - last.x, cur.y - last.y);
    if (segLen <= 1e-6) { last = cur; continue; }
    let progressed = 0;
    while (progressed < segLen - 1e-6) {
      const phaseDist = acc % cycle;
      const inDash = phaseDist < dashLen;
      const remainingInPhase = (inDash ? dashLen - phaseDist : cycle - phaseDist);
      let step = Math.min(segLen - progressed, remainingInPhase);
      if (step <= 1e-6) { // guard against numerical lock
        const eps = Math.min(1e-4, segLen - progressed);
        step = eps;
      }
      if (inDash) {
        const t0 = progressed / segLen;
        const t1 = (progressed + step) / segLen;
        const ax = last.x + (cur.x - last.x) * t0;
        const az = last.y + (cur.y - last.y) * t0;
        const bx = last.x + (cur.x - last.x) * t1;
        const bz = last.y + (cur.y - last.y) * t1;
        const tx = bx - ax, tz = bz - az; const tlen = Math.hypot(tx, tz) || 1;
        const nx = -tz / tlen, nz = tx / tlen;
        const lax = ax + nx * halfW, laz = az + nz * halfW;
        const lbx = bx + nx * halfW, lbz = bz + nz * halfW;
        const rax = ax - nx * halfW, raz = az - nz * halfW;
        const rbx = bx - nx * halfW, rbz = bz - nz * halfW;
        const nlA = sampleNormal(hm, lax, laz);
        const nlB = sampleNormal(hm, lbx, lbz);
        const nrA = sampleNormal(hm, rax, raz);
        const nrB = sampleNormal(hm, rbx, rbz);
        const lAy = hm.sample(lax, laz);
        const lBy = hm.sample(lbx, lbz);
        const rAy = hm.sample(rax, raz);
        const rBy = hm.sample(rbx, rbz);
        const LA = new Vector3(lax, lAy, laz).addScaledVector(nlA, yOffset);
        const LB = new Vector3(lbx, lBy, lbz).addScaledVector(nlB, yOffset);
        const RA = new Vector3(rax, rAy, raz).addScaledVector(nrA, yOffset);
        const RB = new Vector3(rbx, rBy, rbz).addScaledVector(nrB, yOffset);
        pos.push(LA.x, LA.y, LA.z, RA.x, RA.y, RA.z, LB.x, LB.y, LB.z, RB.x, RB.y, RB.z);
        idx.push(vert + 0, vert + 2, vert + 1, vert + 1, vert + 2, vert + 3);
        for (let k = 0; k < 4; k++) col.push(0.85, 0.87, 0.90);
        vert += 4;
      }
      progressed += step;
      acc += step;
    }
    last = cur;
  }
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}
