import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector2, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';

export class RoadsVisual {
  public group = new Group();
  private mat = new MeshStandardMaterial({ color: 0x666666, roughness: 0.95, metalness: 0.0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  private shoulderMat = new MeshBasicMaterial({ color: 0x6e563e, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private stripeMat = new MeshBasicMaterial({ color: 0xcfd3d6, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, vertexColors: true });
  private yOffset = 0.05;
  private hm: Heightmap;
  constructor(hm: Heightmap) { this.hm = hm; }

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
  }

  // Public API remains compatible; scale/y ignored (derived from heightmap)
  addPath(points: Array<{ x: number; z: number }>, _scale?: number, _y?: number) {
    if (!points || points.length < 2) return;
    const scale = this.hm.scale;
    const centers = points.map(p => new Vector2((p.x + 0.5) * scale, (p.z + 0.5) * scale));
    const simplified = simplifyRDP(centers, scale * 0.2);
    const smooth = catmullRomAdaptiveResample(simplified, { maxSegLen: scale * 0.35, sagEps: scale * 0.04 });
    const width = 0.5 * scale; // approx half tile width
    // Main road surface
    {
      const { positions, colors, indices } = buildRibbonStrip(smooth, width, this.hm, this.yOffset);
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
      const { positions, colors, indices } = buildShoulderBands(smooth, width, shoulder, this.hm, this.yOffset * 0.8);
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
      const geo = buildCenterDashed(smooth, stripeWidth, dash, gap, this.hm, this.yOffset + 0.02);
      const mesh = new Mesh(geo, this.stripeMat);
      mesh.renderOrder = 8;
      this.group.add(mesh);
    }
  }
}

function buildRibbonStrip(path: Vector2[], width: number, hm: Heightmap, yOffset: number) {
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

  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const pPrev = path[Math.max(0, i - 1)];
    const pNext = path[Math.min(path.length - 1, i + 1)];
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
  for (let i = 0; i < path.length - 1; i++) {
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
  return { positions, colors, indices };
}

// Ramer–Douglas–Peucker simplification on 2D points
function simplifyRDP(pts: Vector2[], eps: number): Vector2[] {
  if (pts.length <= 2) return pts.slice();
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

// Catmull-Rom resampling for smoother curves
// Catmull-Rom adaptive resampling using midpoint sag error and max segment length
function catmullRomAdaptiveResample(pts: Vector2[], opts: { maxSegLen: number; sagEps: number }): Vector2[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vector2[] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];

  const spline = (p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: number) => {
    const t2 = t * t, t3 = t2 * t;
    const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    const z = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    return new Vector2(x, z);
  };

  const subdivide = (p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2) => {
    const a = p1.clone();
    const b = p2.clone();
    const stack: Array<{ t0: number; t1: number; A: Vector2; B: Vector2 }> = [{ t0: 0, t1: 1, A: a, B: b }];
    const segs: Vector2[] = [];
    while (stack.length) {
      const { t0, t1, A, B } = stack.pop()!;
      const midT = (t0 + t1) * 0.5;
      const M = spline(p0, p1, p2, p3, midT);
      // linear midpoint between A and B
      const Lx = (A.x + B.x) * 0.5;
      const Lz = (A.y + B.y) * 0.5; // careful: Vector2.y is our z coordinate
      const sag = Math.hypot(M.x - Lx, M.y - Lz);
      const segLen = Math.hypot(B.x - A.x, B.y - A.y);
      if (sag > opts.sagEps || segLen > opts.maxSegLen) {
        // split
        const leftMid = spline(p0, p1, p2, p3, (t0 + midT) * 0.5);
        const rightMid = spline(p0, p1, p2, p3, (midT + t1) * 0.5);
        stack.push({ t0: midT, t1, A: M, B });
        stack.push({ t0, t1: midT, A, B: M });
      } else {
        segs.push(B);
      }
    }
    return segs;
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    if (i === 0) out.push(p1.clone());
    const seg = subdivide(p0, p1, p2, p3);
    for (const s of seg) out.push(s);
  }
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
function buildShoulderBands(path: Vector2[], width: number, shoulder: number, hm: Heightmap, yOffset: number) {
  const half = width * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const OL: Vector3[] = [], L: Vector3[] = [], R: Vector3[] = [], OR: Vector3[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const pPrev = path[Math.max(0, i - 1)];
    const pNext = path[Math.min(path.length - 1, i + 1)];
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
  for (let i = 0; i < path.length - 1; i++) {
    const base = i * 4;
    const next = (i + 1) * 4;
    // left shoulder quad (OL-L)
    indices.push(base + 0, next + 0, base + 1, base + 1, next + 0, next + 1);
    // right shoulder quad (R-OR)
    indices.push(base + 2, next + 2, base + 3, base + 3, next + 2, next + 3);
  }
  return { positions, colors, indices };
}

// Build a dashed center stripe along the midline
function buildCenterDashed(path: Vector2[], stripeWidth: number, dashLen: number, gapLen: number, hm: Heightmap, yOffset: number) {
  const geo = new BufferGeometry();
  const pos: number[] = [];
  const idx: number[] = [];
  const col: number[] = [];
  const halfW = stripeWidth * 0.5;
  const cycle = dashLen + gapLen;
  let acc = 0; // accumulated distance along path in world units
  let last = path[0];
  let vert = 0;
  for (let i = 1; i < path.length; i++) {
    const cur = path[i];
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
