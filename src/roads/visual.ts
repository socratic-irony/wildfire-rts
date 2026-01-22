import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector2, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';
import { makeAngularPath } from './path';

const WORLD_UP = new Vector3(0, 1, 0);

type RoadFrame = {
  center: Vector3;
  up: Vector3;
  left: Vector3;
  tangent: Vector3;
  terrainNormal: Vector3;
  rawHeight: number;
};

type ClosestHit = {
  segIndex: number;
  t: number;
  px: number;
  pz: number;
  abx: number;
  abz: number;
  d2: number;
};

export class RoadsVisual {
  public group = new Group();
  private mat = new MeshStandardMaterial({ color: 0x222428, roughness: 0.95, metalness: 0.05, vertexColors: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: true, depthTest: false });
  private shoulderMat = new MeshBasicMaterial({ color: 0x7a6247, transparent: true, opacity: 0.38, depthWrite: false, depthTest: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  private stripeMat = new MeshBasicMaterial({ color: 0xf5f5f5, transparent: false, opacity: 1.0, depthWrite: false, depthTest: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, vertexColors: false });
  private yOffset: number;
  private hm: Heightmap;
  private paths: Vector2[][] = [];
  private frames: RoadFrame[][] = [];
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
  constructor(hm: Heightmap) {
    this.hm = hm;
    this.yOffset = Math.max(0.3, hm.scale * 0.24); // lift roads above terrain to avoid z-fighting on all GPUs
    this.group.renderOrder = 10;
  }

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.paths = [];
    this.frames = [];
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
    const angular = makeAngularPath(points);
    if (angular.length < 2) return;
    const scale = this.hm.scale;
    const width = Math.max(scale * 1.6, scale * 1.1); // visible surface spanning ~2 tiles
    let centers = angular.map(p => snapToTileCenter(new Vector2((p.x + 0.5) * scale, (p.z + 0.5) * scale), scale));
    const initialClosed = centers.length > 2 && centers[0].distanceTo(centers[centers.length - 1]) < scale * 0.4;
    centers = dedupeVec2(centers);
    const spacing = Math.max(scale * 0.6, width * 0.35);
    centers = smoothAndResample(centers, Math.max(spacing, 1e-3), initialClosed);
    // Re-evaluate closure after smoothing/resampling so we don't create long wrap segments
    let closed = initialClosed && centers.length > 2 && centers[0].distanceTo(centers[centers.length - 1]) < Math.max(scale * 0.6, 0.6);
    if (closed && centers[0].distanceToSquared(centers[centers.length - 1]) > 1e-6) {
      // Explicitly stitch to avoid a long diagonal
      centers.push(centers[0].clone());
    } else if (!closed && centers.length > 1 && centers[0].distanceToSquared(centers[centers.length - 1]) < 1e-6) {
      centers.pop();
    }
    if (centers.length < 2) return;
    const mid = centers.map(p => p.clone());
    const pathIndex = this.paths.length;
    this.paths.push(mid);
    this.closedFlags[pathIndex] = closed;
    const frames = computeRoadFrames(mid, width, this.hm, closed);
    if (frames.length < 2) return;
    this.frames[pathIndex] = frames;
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
      const { positions, colors, indices } = buildRibbonStrip(frames, width, this.yOffset, closed);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
      if (colors.length) geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mesh = new Mesh(geo, this.mat);
      mesh.renderOrder = 6;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // Shoulders: faint dusty brown bands outside the road
    {
      const shoulder = Math.max(0.45 * scale, 0.35 * width);
      const { positions, colors, indices } = buildShoulderBands(frames, width, shoulder, this.hm, this.yOffset * 0.8, closed);
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
      const stripeWidth = Math.max(0.14 * scale, 0.08 * width);
      const dash = Math.max(1.6 * scale, width * 0.9);
      const gap = Math.max(1.0 * scale, width * 0.55);
      const stripeYOffset = this.yOffset + Math.max(0.02, 0.04 * scale);
      const geo = buildCenterDashed(frames, stripeWidth, dash, gap, stripeYOffset, closed);
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
    const segIndex = ('segIndex' in res) ? res.segIndex : 0;
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
    let best: { pathIndex: number; hit: ClosestHit } | null = null;
    for (let p = 0; p < this.paths.length; p++) {
      const path = this.paths[p];
      const closed = this.closedFlags[p];
      const segCount = closed ? path.length : path.length - 1;
      if (segCount <= 0) continue;
      const hit = closestPointOnPath(path, closed, wx, wz, 0, segCount - 1);
      if (!hit) continue;
      if (!best || hit.d2 < best.hit.d2) {
        best = { pathIndex: p, hit };
      }
    }
    if (!best) return null as null;
    const { pos, normal, tangent } = this.buildProjection(best.pathIndex, best.hit);
    return { pos, normal, tangent } as const;
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
    const closed = this.closedFlags[pathIndex];
    const segCount = closed ? path.length : path.length - 1;
    if (segCount <= 0) return this.projectToMidline(wx, wz);
    let iStart = 0;
    let iEnd = segCount - 1;
    let coarseIdx = -1;
    let bestD2 = Infinity;
    if (hintSeg != null && segCount > 2) {
      iStart = Math.max(0, Math.min(segCount - 1, hintSeg - window));
      iEnd = Math.max(iStart, Math.min(segCount - 1, hintSeg + window));
    } else if (segCount > 128) {
      const step = Math.max(1, Math.floor(segCount / 64));
      for (let i = 0; i < segCount; i += step) {
        const j = (i + 1) % path.length;
        if (!closed && j === 0) continue;
        const a = path[i];
        const b = path[j];
        const abx = b.x - a.x;
        const abz = b.y - a.y;
        const ab2 = abx * abx + abz * abz || 1e-6;
        const apx = wx - a.x;
        const apz = wz - a.y;
        let t = (apx * abx + apz * abz) / ab2; t = Math.max(0, Math.min(1, t));
        const px = a.x + abx * t;
        const pz = a.y + abz * t;
        const dx = wx - px;
        const dz = wz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; coarseIdx = i; }
      }
      if (coarseIdx >= 0) {
        iStart = Math.max(0, coarseIdx - window);
        iEnd = Math.min(segCount - 1, coarseIdx + window);
      }
    }
    const hit = closestPointOnPath(path, closed, wx, wz, iStart, iEnd);
    if (!hit) return this.projectToMidline(wx, wz);
    const res = this.buildProjection(pathIndex, hit);
    return { pos: res.pos, normal: res.normal, tangent: res.tangent, segIndex: res.segIndex } as const;
  }

  private buildProjection(pathIndex: number, hit: ClosestHit) {
    const frames = this.frames[pathIndex];
    const closed = this.closedFlags[pathIndex];
    if (frames && frames.length) {
      const N = frames.length;
      const nextIndex = closed ? (hit.segIndex + 1) % N : Math.min(N - 1, hit.segIndex + 1);
      const sample = nextIndex >= N
        ? frames[hit.segIndex]
        : interpolateFrame(frames, hit.segIndex, nextIndex, hit.t);
      const center = sample.center.clone();
      const up = sample.up.clone();
      const tangent = sample.tangent.clone();
      const pos = center.clone().addScaledVector(up, this.yOffset);
      return { pos, normal: up, tangent, segIndex: hit.segIndex, t: hit.t } as const;
    }
    const terrainNormal = sampleNormal(this.hm, hit.px, hit.pz)
      .multiplyScalar(0.4)
      .addScaledVector(WORLD_UP, 0.6)
      .normalize();
    const y = this.hm.sample(hit.px, hit.pz);
    const pos = new Vector3(hit.px, y, hit.pz).addScaledVector(terrainNormal, this.yOffset);
    const len = Math.hypot(hit.abx, hit.abz) || 1;
    const tangent = new Vector3(hit.abx / len, 0, hit.abz / len);
    return { pos, normal: terrainNormal, tangent, segIndex: hit.segIndex, t: hit.t } as const;
  }
}

function snapToTileCenter(p: Vector2, scale: number) {
  const gx = Math.round(p.x / scale - 0.5);
  const gz = Math.round(p.y / scale - 0.5);
  return new Vector2((gx + 0.5) * scale, (gz + 0.5) * scale);
}

function dedupeVec2(points: Vector2[]) {
  if (!points.length) return points;
  const out: Vector2[] = [points[0].clone()];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (prev.distanceToSquared(cur) < 1e-6) continue;
    out.push(cur.clone());
  }
  return out;
}

function catmullRom(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return new Vector2(x, y);
}

function resampleUniform(points: Vector2[], spacing: number, closed: boolean) {
  if (points.length < 2) return points.map((p) => p.clone());
  const pts = points.map((p) => p.clone());
  if (closed) pts.push(points[0]);
  const out: Vector2[] = [pts[0].clone()];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    let a = pts[i];
    const b = pts[i + 1];
    let segLen = a.distanceTo(b);
    if (segLen < 1e-6) continue;
    while (carry + segLen >= spacing) {
      const t = (spacing - carry) / segLen;
      const nx = a.x + (b.x - a.x) * t;
      const nz = a.y + (b.y - a.y) * t;
      const next = new Vector2(nx, nz);
      out.push(next);
      // Continue along the remainder of this segment
      segLen -= (spacing - carry);
      a = next;
      carry = 0;
    }
    carry += segLen;
  }
  if (!closed) {
    const last = pts[pts.length - 1];
    if (out[out.length - 1].distanceTo(last) > spacing * 0.35) out.push(last.clone());
  } else {
    // Remove duplicate start for closed loops
    if (out.length > 1 && out[out.length - 1].distanceToSquared(out[0]) < 1e-6) out.pop();
  }
  return dedupeVec2(out);
}

function smoothAndResample(points: Vector2[], spacing: number, closed: boolean) {
  if (points.length < 2) return points.map((p) => p.clone());
  const dense: Vector2[] = [];
  const N = points.length;
  const segCount = closed ? N : N - 1;
  for (let i = 0; i < segCount; i++) {
    const p0 = points[closed ? (i - 1 + N) % N : Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[(i + 1) % N];
    const p3 = points[closed ? (i + 2) % N : Math.min(N - 1, i + 2)];
    const segLen = Math.max(1e-5, p1.distanceTo(p2));
    const samples = Math.max(4, Math.ceil(segLen / spacing) * 3);
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      dense.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  dense.push(points[closed ? 0 : points.length - 1].clone());
  return resampleUniform(dense, spacing, closed);
}

function buildRibbonStrip(frames: RoadFrame[], width: number, yOffset: number, closed = false) {
  const half = width * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const N = frames.length;
  for (let i = 0; i < N; i++) {
    const frame = frames[i];
    const left = frame.center.clone().addScaledVector(frame.left, half).addScaledVector(frame.up, yOffset);
    const mid = frame.center.clone().addScaledVector(frame.up, yOffset);
    const right = frame.center.clone().addScaledVector(frame.left, -half).addScaledVector(frame.up, yOffset);
    positions.push(left.x, left.y, left.z, mid.x, mid.y, mid.z, right.x, right.y, right.z);
  }
  const segCount = closed ? N : Math.max(0, N - 1);
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % N;
    if (!closed && j === 0) continue;
    const iL = i * 3;
    const iM = i * 3 + 1;
    const iR = i * 3 + 2;
    const jL = j * 3;
    const jM = j * 3 + 1;
    const jR = j * 3 + 2;
    indices.push(iL, jL, iM, iM, jL, jM);
    indices.push(iM, jM, iR, iR, jM, jR);
  }
  return { positions, colors, indices };
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
function buildShoulderBands(frames: RoadFrame[], width: number, shoulder: number, hm: Heightmap, yOffset: number, closed = false) {
  const half = width * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const N = frames.length;
  const heightBlend = 0.45;
  const normalBlend = 0.6;
  const outerOffset = yOffset * 0.5;
  for (let i = 0; i < N; i++) {
    const frame = frames[i];
    const innerLeft = frame.center.clone().addScaledVector(frame.left, half).addScaledVector(frame.up, yOffset);
    const innerRight = frame.center.clone().addScaledVector(frame.left, -half).addScaledVector(frame.up, yOffset);
    const outerLeftBase = frame.center.clone().addScaledVector(frame.left, half + shoulder);
    const outerRightBase = frame.center.clone().addScaledVector(frame.left, -half - shoulder);
    const sampleLeft = hm.sample(outerLeftBase.x, outerLeftBase.z);
    const sampleRight = hm.sample(outerRightBase.x, outerRightBase.z);
    outerLeftBase.y = sampleLeft * (1 - heightBlend) + frame.center.y * heightBlend;
    outerRightBase.y = sampleRight * (1 - heightBlend) + frame.center.y * heightBlend;
    const outerLeftNormal = sampleNormal(hm, outerLeftBase.x, outerLeftBase.z)
      .multiplyScalar(1 - normalBlend)
      .addScaledVector(frame.up, normalBlend)
      .normalize();
    const outerRightNormal = sampleNormal(hm, outerRightBase.x, outerRightBase.z)
      .multiplyScalar(1 - normalBlend)
      .addScaledVector(frame.up, normalBlend)
      .normalize();
    const outerLeft = outerLeftBase.clone().addScaledVector(outerLeftNormal, outerOffset);
    const outerRight = outerRightBase.clone().addScaledVector(outerRightNormal, outerOffset);
    positions.push(
      outerLeft.x, outerLeft.y, outerLeft.z,
      innerLeft.x, innerLeft.y, innerLeft.z,
      innerRight.x, innerRight.y, innerRight.z,
      outerRight.x, outerRight.y, outerRight.z
    );
    const outerColor = [0.41, 0.33, 0.25];
    const innerColor = [0.53, 0.44, 0.35];
    colors.push(...outerColor, ...innerColor, ...innerColor, ...outerColor);
  }
  const segCount = closed ? N : Math.max(0, N - 1);
  for (let i = 0; i < segCount; i++) {
    const next = (i + 1) % N;
    if (!closed && next === 0) continue;
    const base = i * 4;
    const nextBase = next * 4;
    indices.push(base + 0, nextBase + 0, base + 1, base + 1, nextBase + 0, nextBase + 1);
    indices.push(base + 2, nextBase + 2, base + 3, base + 3, nextBase + 2, nextBase + 3);
  }
  return { positions, colors, indices };
}

// Build a dashed center stripe along the midline
function buildCenterDashed(frames: RoadFrame[], stripeWidth: number, dashLen: number, gapLen: number, yOffset: number, closed = false) {
  const geo = new BufferGeometry();
  const pos: number[] = [];
  const idx: number[] = [];
  const col: number[] = [];
  const halfW = stripeWidth * 0.5;
  const cycle = dashLen + gapLen;
  let acc = 0;
  const N = frames.length;
  const segCount = closed ? N : Math.max(0, N - 1);
  let vert = 0;
  for (let si = 0; si < segCount; si++) {
    const aIdx = si;
    const bIdx = closed ? (si + 1) % N : si + 1;
    if (!closed && bIdx >= N) continue;
    const segLen = frames[aIdx].center.distanceTo(frames[bIdx].center);
    if (segLen <= 1e-6) continue;
    let progressed = 0;
    while (progressed < segLen - 1e-6) {
      const phaseDist = acc % cycle;
      const inDash = phaseDist < dashLen;
      const remainingInPhase = (inDash ? dashLen - phaseDist : cycle - phaseDist);
      let step = Math.min(segLen - progressed, remainingInPhase);
      if (step <= 1e-6) step = Math.min(1e-4, segLen - progressed);
      if (inDash) {
        const t0 = progressed / segLen;
        const t1 = (progressed + step) / segLen;
        const frame0 = interpolateFrame(frames, aIdx, bIdx, t0);
        const frame1 = interpolateFrame(frames, aIdx, bIdx, t1);
        const left0 = frame0.center.clone().addScaledVector(frame0.left, halfW).addScaledVector(frame0.up, yOffset);
        const right0 = frame0.center.clone().addScaledVector(frame0.left, -halfW).addScaledVector(frame0.up, yOffset);
        const left1 = frame1.center.clone().addScaledVector(frame1.left, halfW).addScaledVector(frame1.up, yOffset);
        const right1 = frame1.center.clone().addScaledVector(frame1.left, -halfW).addScaledVector(frame1.up, yOffset);
        pos.push(
          left0.x, left0.y, left0.z,
          right0.x, right0.y, right0.z,
          left1.x, left1.y, left1.z,
          right1.x, right1.y, right1.z
        );
        idx.push(vert + 0, vert + 2, vert + 1, vert + 1, vert + 2, vert + 3);
        for (let k = 0; k < 4; k++) col.push(0.85, 0.87, 0.9);
        vert += 4;
      }
      progressed += step;
      acc += step;
    }
  }
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function smoothHeights(values: number[], hm: Heightmap, closed: boolean) {
  if (values.length <= 2) return values.slice();
  const base = values.slice();
  const out = values.slice();
  const tmp = new Array(values.length).fill(0);
  const strength = 0.6;
  const iterations = 3;
  const maxDelta = hm.scale * 1.25;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < values.length; i++) {
      const prev = out[closed ? (i - 1 + values.length) % values.length : Math.max(0, i - 1)];
      const next = out[closed ? (i + 1) % values.length : Math.min(values.length - 1, i + 1)];
      const prev2 = out[closed ? (i - 2 + values.length) % values.length : Math.max(0, i - 2)];
      const next2 = out[closed ? (i + 2) % values.length : Math.min(values.length - 1, i + 2)];
      const avg = (out[i] * 2 + prev + next + 0.5 * (prev2 + next2)) / 5;
      let smoothed = out[i] * (1 - strength) + avg * strength;
      const delta = smoothed - base[i];
      if (delta > maxDelta) smoothed = base[i] + maxDelta;
      else if (delta < -maxDelta) smoothed = base[i] - maxDelta;
      tmp[i] = smoothed;
    }
    for (let i = 0; i < values.length; i++) out[i] = tmp[i];
  }
  return out;
}

function computeRoadFrames(path: Vector2[], _width: number, hm: Heightmap, closed: boolean): RoadFrame[] {
  const N = path.length;
  if (N === 0) return [];
  const rawHeights = path.map(p => hm.sample(p.x, p.y));
  const leveled = smoothHeights(rawHeights, hm, closed);
  const centers = path.map((p, i) => new Vector3(p.x, leveled[i], p.y));
  const frames: RoadFrame[] = [];
  const FLATTEN_TILT = 0.7;
  for (let i = 0; i < N; i++) {
    const prevIdx = closed ? (i - 1 + N) % N : Math.max(0, i - 1);
    const nextIdx = closed ? (i + 1) % N : Math.min(N - 1, i + 1);
    const prev = centers[prevIdx];
    const next = centers[nextIdx];
    const tangent = next.clone().sub(prev);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    tangent.normalize();
    const terrainNormal = sampleNormal(hm, path[i].x, path[i].y);
    const up = terrainNormal.clone().multiplyScalar(1 - FLATTEN_TILT).addScaledVector(WORLD_UP, FLATTEN_TILT).normalize();
    let left = new Vector3().crossVectors(up, tangent);
    if (left.lengthSq() < 1e-6) left.set(-tangent.z, 0, tangent.x);
    left.normalize();
    frames.push({
      center: centers[i],
      up,
      left,
      tangent: tangent.clone(),
      terrainNormal,
      rawHeight: rawHeights[i],
    });
  }
  return frames;
}

function interpolateFrame(frames: RoadFrame[], aIdx: number, bIdx: number, t: number) {
  const fa = frames[aIdx];
  const fb = frames[bIdx];
  const center = new Vector3().lerpVectors(fa.center, fb.center, t);
  const up = new Vector3().lerpVectors(fa.up, fb.up, t).normalize();
  const tangent = new Vector3().lerpVectors(fa.tangent, fb.tangent, t);
  if (tangent.lengthSq() < 1e-6) {
    tangent.copy(fb.center).sub(fa.center);
  }
  if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
  tangent.normalize();
  let left = new Vector3().lerpVectors(fa.left, fb.left, t);
  if (left.lengthSq() < 1e-6) left.crossVectors(up, tangent);
  if (left.lengthSq() < 1e-6) left.set(-tangent.z, 0, tangent.x);
  left.normalize();
  return { center, up, left, tangent };
}

function closestPointOnPath(path: Vector2[], closed: boolean, wx: number, wz: number, segStart: number, segEnd: number): ClosestHit | null {
  const N = path.length;
  if (N < 2) return null;
  const segCount = closed ? N : N - 1;
  if (segCount <= 0) return null;
  let best: ClosestHit | null = null;
  const start = Math.max(0, Math.min(segCount - 1, segStart));
  const end = Math.max(start, Math.min(segCount - 1, segEnd));
  for (let i = start; i <= end; i++) {
    const j = (i + 1) % N;
    if (!closed && j === 0) continue;
    const a = path[i];
    const b = path[j];
    const abx = b.x - a.x;
    const abz = b.y - a.y;
    const ab2 = abx * abx + abz * abz || 1e-6;
    const apx = wx - a.x;
    const apz = wz - a.y;
    let t = (apx * abx + apz * abz) / ab2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + abx * t;
    const pz = a.y + abz * t;
    const dx = wx - px;
    const dz = wz - pz;
    const d2 = dx * dx + dz * dz;
    if (!best || d2 < best.d2) best = { segIndex: i, t, px, pz, abx, abz, d2 };
  }
  return best;
}
