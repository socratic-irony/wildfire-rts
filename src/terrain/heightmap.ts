import { createNoise2D } from 'simplex-noise';

export type Heightmap = {
  width: number; // tiles in X
  height: number; // tiles in Z
  scale: number; // world units per tile
  data: Float32Array; // (width+1) * (height+1)
  sample: (x: number, z: number) => number; // bilinear sample in world units
};

export type NoiseConfig = {
  seed?: string | number;
  frequency: number; // cycles per tile (1/period)
  amplitude: number; // world units
  octaves: number;
  persistence: number;
};

function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateHeightmap(
  width: number,
  height: number,
  scale: number,
  cfg: NoiseConfig
): Heightmap {
  const seedStr = String(cfg.seed ?? Math.random());
  const seedFn = xmur3(seedStr);
  const rng = mulberry32(seedFn());
  const noise2D = createNoise2D(rng);
  const cols = width + 1;
  const rows = height + 1;
  const data = new Float32Array(cols * rows);

  const f0 = cfg.frequency;
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      let amp = cfg.amplitude;
      let freq = f0;
      let h = 0;
      for (let o = 0; o < cfg.octaves; o++) {
        const nx = (x / width) * freq;
        const nz = (z / height) * freq;
        h += noise2D(nx, nz) * amp;
        amp *= cfg.persistence;
        freq *= 2;
      }
      data[z * cols + x] = h;
    }
  }

  const sample = (wx: number, wz: number) => {
    const gx = wx / scale;
    const gz = wz / scale;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(width, x0 + 1);
    const z1 = Math.min(height, z0 + 1);
    const tx = Math.min(1, Math.max(0, gx - x0));
    const tz = Math.min(1, Math.max(0, gz - z0));
    const cols2 = cols;
    const i00 = data[z0 * cols2 + x0];
    const i10 = data[z0 * cols2 + x1];
    const i01 = data[z1 * cols2 + x0];
    const i11 = data[z1 * cols2 + x1];
    const a = i00 * (1 - tx) + i10 * tx;
    const b = i01 * (1 - tx) + i11 * tx;
    return a * (1 - tz) + b * tz;
  };

  return { width, height, scale, data, sample };
}
