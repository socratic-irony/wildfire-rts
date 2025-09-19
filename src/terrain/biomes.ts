import { Heightmap, NoiseConfig, generateHeightmap } from './heightmap';

export type BiomeMask = {
  rock: Uint8Array;
  forest: Uint8Array;
  chaparral: Uint8Array;
};

type BiomeThresholds = {
  rockSlopeDeg: number;        // slope above which becomes rock
  rockHighHeight: number;      // height considered "high"
  rockHighSlopeDeg: number;    // slope above which high areas become rock
  forestMoistureMin: number;   // minimum moisture for forest
  forestSlopeMax: number;      // slope above which forest is disallowed
};

export function computeSlopeMap(hm: Heightmap): Float32Array {
  const cols = hm.width + 1;
  const rows = hm.height + 1;
  const slope = new Float32Array(cols * rows);
  for (let z = 1; z < rows - 1; z++) {
    for (let x = 1; x < cols - 1; x++) {
      const hL = hm.data[z * cols + (x - 1)];
      const hR = hm.data[z * cols + (x + 1)];
      const hD = hm.data[(z - 1) * cols + x];
      const hU = hm.data[(z + 1) * cols + x];
      const nx = (hR - hL) * 0.5;
      const nz = (hU - hD) * 0.5;
      const ny = 2.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const slopeDeg = Math.acos(ny / len) * (180 / Math.PI);
      slope[z * cols + x] = slopeDeg;
    }
  }
  return slope;
}

export function computeBiomes(hm: Heightmap, moistureCfg?: Partial<NoiseConfig>): BiomeMask {
  const cols = hm.width + 1;
  const rows = hm.height + 1;
  const N = cols * rows;
  const rock = new Uint8Array(N);
  const forest = new Uint8Array(N);
  const chaparral = new Uint8Array(N);

  const slope = computeSlopeMap(hm);
  const moist = generateHeightmap(hm.width, hm.height, hm.scale, {
    seed: (moistureCfg?.seed ?? 'moist') as any,
    frequency: moistureCfg?.frequency ?? 1.5,
    amplitude: 1,
    octaves: 3,
    persistence: 0.5,
  });

  // Simple thresholds (tunable)
  for (let i = 0; i < N; i++) {
    const s = slope[i] || 0;
    const h = hm.data[i] || 0;
    const m = moist.data[i] * 0.5 + 0.5; // [-1,1] -> [0,1]
    const high = h > 6;
    const steep = s > 35;
    if (steep || (high && s > 25)) {
      rock[i] = 1;
      continue;
    }
    if (m > 0.55 && s < 22) {
      forest[i] = 1;
    } else {
      chaparral[i] = 1;
    }
  }

  return { rock, forest, chaparral };
}

// Tunable variant with explicit thresholds; preserves original as default.
export function computeBiomesTuned(
  hm: Heightmap,
  thresholds: Partial<BiomeThresholds> = {},
  moistureCfg?: Partial<NoiseConfig>
): BiomeMask {
  const cols = hm.width + 1;
  const rows = hm.height + 1;
  const N = cols * rows;
  const rock = new Uint8Array(N);
  const forest = new Uint8Array(N);
  const chaparral = new Uint8Array(N);

  const slope = computeSlopeMap(hm);
  const moist = generateHeightmap(hm.width, hm.height, hm.scale, {
    seed: (moistureCfg?.seed ?? 'moist') as any,
    frequency: moistureCfg?.frequency ?? 1.5,
    amplitude: 1,
    octaves: 3,
    persistence: 0.5,
  });

  const t: BiomeThresholds = {
    rockSlopeDeg: thresholds.rockSlopeDeg ?? 35,
    rockHighHeight: thresholds.rockHighHeight ?? 6,
    rockHighSlopeDeg: thresholds.rockHighSlopeDeg ?? 25,
    forestMoistureMin: thresholds.forestMoistureMin ?? 0.55,
    forestSlopeMax: thresholds.forestSlopeMax ?? 22,
  };

  for (let i = 0; i < N; i++) {
    const s = slope[i] || 0;
    const h = hm.data[i] || 0;
    const m = moist.data[i] * 0.5 + 0.5; // [-1,1] -> [0,1]
    const high = h > t.rockHighHeight;
    const steep = s > t.rockSlopeDeg;
    if (steep || (high && s > t.rockHighSlopeDeg)) {
      rock[i] = 1;
      continue;
    }
    if (m > t.forestMoistureMin && s < t.forestSlopeMax) {
      forest[i] = 1;
    } else {
      chaparral[i] = 1;
    }
  }

  return { rock, forest, chaparral };
}

export function applyBiomeVertexColors(hm: Heightmap, colors: Float32Array, biomes: BiomeMask) {
  const N = (hm.width + 1) * (hm.height + 1);
  for (let i = 0; i < N; i++) {
    const r = biomes.rock[i] ? 1 : 0;
    const f = biomes.forest[i] ? 1 : 0;
    const c = biomes.chaparral[i] ? 1 : 0;
    // Palette tints
    const rockCol = [0.60, 0.55, 0.60];
    const forestCol = [0.17, 0.43, 0.29];
    const chapCol = [0.76, 0.70, 0.50];
    const sum = r + f + c || 1;
    const R = (r * rockCol[0] + f * forestCol[0] + c * chapCol[0]) / sum;
    const G = (r * rockCol[1] + f * forestCol[1] + c * chapCol[1]) / sum;
    const B = (r * rockCol[2] + f * forestCol[2] + c * chapCol[2]) / sum;
    colors[i * 3 + 0] = R;
    colors[i * 3 + 1] = G;
    colors[i * 3 + 2] = B;
  }
}
