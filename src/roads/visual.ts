import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector2, Vector3 } from 'three';
import type { Heightmap } from '../terrain/heightmap';

export class RoadsVisual {
  public group = new Group();
  private mat = new MeshStandardMaterial({ color: 0x666666, roughness: 0.95, metalness: 0.0, vertexColors: true });
  private yOffset = 0.02;
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
    const smooth = catmullRomResample(simplified, 8);
    const width = 0.5 * scale; // approx half tile width
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
}

function buildRibbonStrip(path: Vector2[], width: number, hm: Heightmap, yOffset: number) {
  const half = width * 0.5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const lefts: Vector3[] = [];
  const rights: Vector3[] = [];

  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const pPrev = path[Math.max(0, i - 1)];
    const pNext = path[Math.min(path.length - 1, i + 1)];
    const tx = pNext.x - pPrev.x;
    const tz = pNext.y - pPrev.y;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len; // left normal (xz plane)
    const nz = tx / len;
    // left/right world positions
    const lx = p.x + nx * half;
    const lz = p.y + nz * half;
    const rx = p.x - nx * half;
    const rz = p.y - nz * half;
    const ly = hm.sample(lx, lz) + yOffset;
    const ry = hm.sample(rx, rz) + yOffset;
    lefts.push(new Vector3(lx, ly, lz));
    rights.push(new Vector3(rx, ry, rz));
  }

  // build vertices/colors
  for (let i = 0; i < path.length; i++) {
    const L = lefts[i], R = rights[i];
    positions.push(L.x, L.y, L.z, R.x, R.y, R.z);
    // color gradient: edges slightly lighter, center darker -> we can't set center directly, so set edges lighter and let shading handle middle
    const edgeL = [0.72, 0.72, 0.72];
    const edgeR = [0.72, 0.72, 0.72];
    colors.push(...edgeL, ...edgeR);
  }
  // indices
  for (let i = 0; i < path.length - 1; i++) {
    const i0 = i * 2;
    const i1 = i * 2 + 1;
    const i2 = (i + 1) * 2;
    const i3 = (i + 1) * 2 + 1;
    indices.push(i0, i2, i1, i1, i2, i3);
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
function catmullRomResample(pts: Vector2[], samplesPerSeg = 8): Vector2[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vector2[] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push(new Vector2(x, z));
    }
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}
