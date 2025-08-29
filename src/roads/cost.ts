import { Heightmap } from '../terrain/heightmap';

export type TerrainCost = {
  width: number;
  height: number;
  elev: Float32Array;   // 0..1 normalized elevation per cell (tile centers)
  slope: Float32Array;  // approx |grad| per cell (tan)
  valley: Float32Array; // 0..1 valley score (optional; simple concavity proxy)
};

export function buildTerrainCost(hm: Heightmap): TerrainCost {
  const w = hm.width;
  const h = hm.height;
  const cols = hm.width + 1;
  const rows = hm.height + 1;
  const elev = new Float32Array(w * h);
  const slope = new Float32Array(w * h);
  const valley = new Float32Array(w * h);

  let minH = Infinity, maxH = -Infinity;
  // sample center elevation at grid vertices (x,z) and record bounds
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const y = hm.data[z * cols + x];
      if (y < minH) minH = y;
      if (y > maxH) maxH = y;
    }
  }
  const inv = 1 / Math.max(1e-6, (maxH - minH));
  
  function slopeAt(x: number, z: number) {
    const xi = Math.min(cols - 2, Math.max(1, x));
    const zi = Math.min(rows - 2, Math.max(1, z));
    const hL = hm.data[zi * cols + (xi - 1)];
    const hR = hm.data[zi * cols + (xi + 1)];
    const hD = hm.data[(zi - 1) * cols + xi];
    const hU = hm.data[(zi + 1) * cols + xi];
    const dx = (hR - hL) * 0.5;
    const dz = (hU - hD) * 0.5;
    // tan(slope) approx (rise over run, with run ~ scale)
    const tanSlope = Math.hypot(dx, dz) / Math.max(1e-3, hm.scale);
    // simple concavity proxy (negative Laplacian -> valley). Normalize later.
    const lap = (hL + hR + hU + hD - 4 * hm.data[zi * cols + xi]);
    return { tanSlope, lap };
  }

  let minLap = Infinity, maxLap = -Infinity;
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const gi = z * w + x;
      const y = hm.data[z * cols + x];
      elev[gi] = (y - minH) * inv;
      const { tanSlope, lap } = slopeAt(x, z);
      slope[gi] = tanSlope;
      if (lap < minLap) minLap = lap;
      if (lap > maxLap) maxLap = lap;
      valley[gi] = lap; // temp; normalize below
    }
  }
  // valley score: favor negative laplacian (concavity). Map [minLap..maxLap] -> [0..1], invert sign bias
  const rangeLap = Math.max(1e-6, maxLap - minLap);
  for (let i = 0; i < valley.length; i++) {
    const n = (valley[i] - minLap) / rangeLap; // 0..1 where 0=minLap (most negative)
    valley[i] = 1 - n; // 1 for strong concavity/valley
  }

  return { width: w, height: h, elev, slope, valley };
}

