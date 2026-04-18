import type { Heightmap } from '../terrain/heightmap';

export type RoadLoopKind = 'oval' | 'figure8' | 'rectangle';

export type ProceduralRoadOptions = {
  count?: number;
  kinds?: RoadLoopKind[];
  minRadiusTiles?: number;
  maxRadiusTiles?: number;
  paddingTiles?: number;
  samplesPerLoop?: number;
  seed?: number;
  candidatesPerLoop?: number;
};

export type RoadPolyline = Array<{ x: number; z: number }>;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed?: number) {
  if (seed == null) return Math.random;
  return mulberry32(seed);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function dedupeGrid(points: RoadPolyline): RoadPolyline {
  if (!points.length) return [];
  const out: RoadPolyline = [{ x: points[0].x, z: points[0].z }];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (prev.x === cur.x && prev.z === cur.z) continue;
    out.push({ x: cur.x, z: cur.z });
  }
  return out;
}

function closeLoop(points: RoadPolyline): RoadPolyline {
  if (!points.length) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.z === last.z) return points;
  return points.concat({ x: first.x, z: first.z });
}

function buildRectangleLoop(x0: number, z0: number, x1: number, z1: number): RoadPolyline {
  const pts: RoadPolyline = [];
  for (let x = x0; x <= x1; x++) pts.push({ x, z: z0 });
  for (let z = z0 + 1; z <= z1; z++) pts.push({ x: x1, z });
  for (let x = x1 - 1; x >= x0; x--) pts.push({ x, z: z1 });
  for (let z = z1 - 1; z > z0; z--) pts.push({ x: x0, z });
  return closeLoop(pts);
}

function buildOvalLoop(cx: number, cz: number, rx: number, rz: number, samples: number): RoadPolyline {
  const pts: RoadPolyline = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const x = Math.round(cx + rx * Math.cos(t));
    const z = Math.round(cz + rz * Math.sin(t));
    pts.push({ x, z });
  }
  return closeLoop(dedupeGrid(pts));
}

function buildFigureEightLoop(cx: number, cz: number, rx: number, rz: number, samples: number): RoadPolyline {
  const pts: RoadPolyline = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const x = cx + rx * Math.sin(t);
    const z = cz + rz * Math.sin(t) * Math.cos(t);
    pts.push({ x: Math.round(x), z: Math.round(z) });
  }
  return closeLoop(dedupeGrid(pts));
}

function clampToBounds(points: RoadPolyline, width: number, height: number): RoadPolyline {
  return points.map((p) => ({
    x: clamp(p.x, 0, width - 1),
    z: clamp(p.z, 0, height - 1),
  }));
}

function scoreSlope(hm: Heightmap, points: RoadPolyline) {
  if (points.length < 2) return Infinity;
  let score = 0;
  const scale = hm.scale;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ax = (a.x + 0.5) * scale;
    const az = (a.z + 0.5) * scale;
    const bx = (b.x + 0.5) * scale;
    const bz = (b.z + 0.5) * scale;
    const ha = hm.sample(ax, az);
    const hb = hm.sample(bx, bz);
    const dist = Math.max(0.1, Math.hypot(bx - ax, bz - az));
    score += Math.abs(hb - ha) / dist;
  }
  return score / Math.max(1, points.length - 1);
}

function pickBest<T>(items: T[], scoreFn: (v: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const item of items) {
    const score = scoreFn(item);
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export function generateProceduralRoads(hm: Heightmap, options: ProceduralRoadOptions = {}): RoadPolyline[] {
  const {
    count = 2,
    kinds = ['oval', 'figure8', 'rectangle'],
    minRadiusTiles,
    maxRadiusTiles,
    paddingTiles = 6,
    samplesPerLoop,
    seed,
    candidatesPerLoop = 6,
  } = options;
  const rng = makeRng(seed);
  const minDim = Math.min(hm.width, hm.height);
  const minR = Math.max(6, Math.floor(minDim * 0.12), minRadiusTiles ?? 0);
  const maxR = Math.max(minR + 2, Math.floor(minDim * 0.28), maxRadiusTiles ?? 0);
  const pad = Math.max(4, Math.min(paddingTiles, Math.floor(minDim * 0.2)));
  const loops: RoadPolyline[] = [];

  for (let n = 0; n < count; n++) {
    const kind = kinds[Math.floor(rng() * kinds.length)] ?? 'oval';
    const candidates: RoadPolyline[] = [];
    const tries = Math.max(1, candidatesPerLoop);
    for (let t = 0; t < tries; t++) {
      const rx = minR + Math.floor(rng() * (maxR - minR + 1));
      const rz = minR + Math.floor(rng() * (maxR - minR + 1));
      const minX = pad + rx;
      const maxX = hm.width - 1 - pad - rx;
      const minZ = pad + rz;
      const maxZ = hm.height - 1 - pad - rz;
      if (maxX <= minX || maxZ <= minZ) continue;
      const cx = Math.floor(minX + rng() * Math.max(1, maxX - minX));
      const cz = Math.floor(minZ + rng() * Math.max(1, maxZ - minZ));
      const samples = samplesPerLoop ?? Math.max(24, Math.floor(Math.max(rx, rz) * 4));
      let path: RoadPolyline;
      if (kind === 'rectangle') {
        const x0 = clamp(cx - rx, pad, hm.width - 1 - pad);
        const x1 = clamp(cx + rx, pad, hm.width - 1 - pad);
        const z0 = clamp(cz - rz, pad, hm.height - 1 - pad);
        const z1 = clamp(cz + rz, pad, hm.height - 1 - pad);
        if (x1 - x0 < 3 || z1 - z0 < 3) continue;
        path = buildRectangleLoop(x0, z0, x1, z1);
      } else if (kind === 'figure8') {
        path = buildFigureEightLoop(cx, cz, rx, rz, samples);
      } else {
        path = buildOvalLoop(cx, cz, rx, rz, samples);
      }
      path = clampToBounds(path, hm.width, hm.height);
      if (path.length >= 4) candidates.push(path);
    }
    const best = pickBest(candidates, (p) => scoreSlope(hm, p));
    if (best) loops.push(best);
  }
  if (!loops.length) {
    const x0 = pad;
    const z0 = pad;
    const x1 = Math.max(x0 + 3, hm.width - 1 - pad);
    const z1 = Math.max(z0 + 3, hm.height - 1 - pad);
    if (x1 - x0 >= 3 && z1 - z0 >= 3) {
      loops.push(buildRectangleLoop(x0, z0, x1, z1));
    }
  }
  return loops;
}
