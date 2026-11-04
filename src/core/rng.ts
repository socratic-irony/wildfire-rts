export function hash2(x: number, y: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash01(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) / 0xffffffff;
}

export function hash01_3(x: number, y: number, z: number, seed: number): number {
  return hash3(x, y, z, seed) / 0xffffffff;
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash01(xi, yi, seed);
  const b = hash01(xi + 1, yi, seed);
  const c = hash01(xi, yi + 1, seed);
  const d = hash01(xi + 1, yi + 1, seed);
  const top = a + (b - a) * xf;
  const bottom = c + (d - c) * xf;
  return top + (bottom - top) * yf;
}

export function fbm2(x: number, y: number, seed: number, octaves = 4, persistence = 0.5, lacunarity = 2): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return sum / norm;
}

export function ridgeNoise2(x: number, y: number, seed: number): number {
  const n = valueNoise2(x, y, seed);
  return 1 - Math.abs(n * 2 - 1);
}
