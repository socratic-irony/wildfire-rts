import { clamp, smoothstep } from '../core/math';
import { fbm2, ridgeNoise2, Rng } from '../core/rng';
import { GRID_SIZE, LEVEL_HEIGHT, TILE_SIZE } from './constants';

export const WATER_LEVEL = 0.7;
const MAX_LEVEL = 12;
const STRIDE = GRID_SIZE + 1;

/**
 * Seed-driven placement of the map's landmarks. Everything that used to be a
 * hard-coded coordinate (town, lake, helipad, station) is derived from here so
 * every seed produces a different map.
 */
export interface MapLayout {
  town: { x: number; z: number; rx: number; rz: number; level: number };
  /** +1 places the station/helipad east of the main crossroads, -1 west. */
  side: 1 | -1;
  lake: { x: number; z: number; r: number };
  /** Number of terrace levels the noise field is spread across. */
  relief: number;
}

export class Heightmap {
  readonly size = GRID_SIZE;
  readonly tileSize = TILE_SIZE;
  readonly levelHeight = LEVEL_HEIGHT;
  readonly levels: Uint8Array;
  waterMask: Uint8Array;
  readonly seed: number;
  readonly layout: MapLayout;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const raw = generateRawField(this.seed);
    this.layout = chooseLayout(raw, this.seed);
    this.levels = quantizeLevels(raw, this.layout, this.seed);
    this.waterMask = generateWaterMask(this.levels, this.layout);
  }

  levelAtVertex(ix: number, iz: number): number {
    const x = clamp(ix, 0, this.size);
    const z = clamp(iz, 0, this.size);
    return this.levels[z * STRIDE + x] ?? 0;
  }

  vertexHeight(ix: number, iz: number): number {
    return this.levelAtVertex(ix, iz) * this.levelHeight;
  }

  /**
   * Height of the rendered terrain surface. Each tile is drawn as two
   * triangles split along the (x1,z0)–(x0,z1) diagonal; sampling the same
   * planes keeps trees, units, hydrants and decals glued to the ground on
   * slopes (bilinear sampling floats/sinks by up to half a level there).
   */
  heightAt(wx: number, wz: number): number {
    const gx = clamp(wx / this.tileSize, 0, this.size);
    const gz = clamp(wz / this.tileSize, 0, this.size);
    const x0 = Math.min(this.size - 1, Math.floor(gx));
    const z0 = Math.min(this.size - 1, Math.floor(gz));
    const fx = gx - x0;
    const fz = gz - z0;
    const h00 = this.vertexHeight(x0, z0);
    const h10 = this.vertexHeight(x0 + 1, z0);
    const h01 = this.vertexHeight(x0, z0 + 1);
    const h11 = this.vertexHeight(x0 + 1, z0 + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  cornerHeights(tx: number, tz: number): [number, number, number, number] {
    return [
      this.vertexHeight(tx, tz),
      this.vertexHeight(tx + 1, tz),
      this.vertexHeight(tx, tz + 1),
      this.vertexHeight(tx + 1, tz + 1),
    ];
  }

  tileHeight(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    return (h00 + h10 + h01 + h11) / 4;
  }

  tileMaxHeight(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    return Math.max(h00, h10, h01, h11);
  }

  tileMinHeight(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    return Math.min(h00, h10, h01, h11);
  }

  slopeTan(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    const dx = (h10 + h11 - h00 - h01) / (2 * this.tileSize);
    const dz = (h01 + h11 - h00 - h10) / (2 * this.tileSize);
    return Math.hypot(dx, dz);
  }

  isWater(tx: number, tz: number): boolean {
    return this.waterMask[tz * this.size + tx] === 1;
  }

  normalAt(wx: number, wz: number): { x: number; y: number; z: number } {
    const e = 0.45;
    const hx = this.heightAt(wx + e, wz) - this.heightAt(wx - e, wz);
    const hz = this.heightAt(wx, wz + e) - this.heightAt(wx, wz - e);
    const nx = -hx;
    const ny = 2 * e;
    const nz = -hz;
    const length = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / length, y: ny / length, z: nz / length };
  }

  isTownVertex(ix: number, iz: number): boolean {
    const { x, z, rx, rz } = this.layout.town;
    return (ix - x) ** 2 / rx ** 2 + (iz - z) ** 2 / rz ** 2 < 1;
  }

  /**
   * Grade the terrain under a road mask so roads climb terraces as clean
   * ramps instead of being twisted across 45° faces:
   *  - straight east–west tiles get level north/south edges (ramp along x),
   *  - straight north–south tiles get level east/west edges (ramp along z),
   *  - bends, junctions and dead ends become flat pads.
   * Only lowers vertices (cuts, never fills), then re-applies the one-level
   * slope limit so the cut blends into the hillside. Pinned vertices
   * (building footprints) are never moved. Returns true if anything changed.
   */
  gradeForRoads(roadMask: Uint8Array, pinned?: Uint8Array): boolean {
    const levels = this.levels;
    let changedAny = false;
    for (let pass = 0; pass < 64; pass += 1) {
      let changed = false;
      for (let tz = 0; tz < GRID_SIZE; tz += 1) {
        for (let tx = 0; tx < GRID_SIZE; tx += 1) {
          if (roadMask[tz * GRID_SIZE + tx] !== 1) continue;
          const north = tz > 0 && roadMask[(tz - 1) * GRID_SIZE + tx] === 1;
          const south = tz < GRID_SIZE - 1 && roadMask[(tz + 1) * GRID_SIZE + tx] === 1;
          const west = tx > 0 && roadMask[tz * GRID_SIZE + tx - 1] === 1;
          const east = tx < GRID_SIZE - 1 && roadMask[tz * GRID_SIZE + tx + 1] === 1;
          const v00 = tz * STRIDE + tx;
          const v10 = v00 + 1;
          const v01 = v00 + STRIDE;
          const v11 = v01 + 1;
          const alongX = (east || west) && !north && !south;
          const alongZ = (north || south) && !east && !west;
          const straightX = alongX && east && west;
          const straightZ = alongZ && north && south;
          if (straightX) {
            changed = levelGroup(levels, [v00, v01], pinned) || changed;
            changed = levelGroup(levels, [v10, v11], pinned) || changed;
          } else if (straightZ) {
            changed = levelGroup(levels, [v00, v10], pinned) || changed;
            changed = levelGroup(levels, [v01, v11], pinned) || changed;
          } else {
            changed = levelGroup(levels, [v00, v10, v01, v11], pinned) || changed;
          }
        }
      }
      changed = enforceSlopeLimit(levels, 48, pinned) || changed;
      if (!changed) break;
      changedAny = true;
    }
    if (changedAny) this.waterMask = generateWaterMask(levels, this.layout);
    return changedAny;
  }
}

function levelGroup(levels: Uint8Array, vertices: number[], pinned?: Uint8Array): boolean {
  let target = 255;
  for (const v of vertices) target = Math.min(target, levels[v] ?? 0);
  let changed = false;
  for (const v of vertices) {
    if ((levels[v] ?? 0) === target) continue;
    if (pinned && pinned[v] === 1) continue;
    levels[v] = target;
    changed = true;
  }
  return changed;
}

/**
 * Rolling fractal hills in [0,1], in the spirit of the original prototype's
 * octave-noise generator, with per-seed relief/frequency/ridge character.
 */
function generateRawField(seed: number): Float32Array {
  const rng = new Rng(seed ^ 0x6a09e667);
  const frequency = rng.range(2.1, 3.6);
  const ridges = rng.range(0.1, 0.42);
  const warp = rng.range(0.15, 0.45);
  const raw = new Float32Array(STRIDE * STRIDE);
  let min = Infinity;
  let max = -Infinity;
  for (let iz = 0; iz < STRIDE; iz += 1) {
    for (let ix = 0; ix < STRIDE; ix += 1) {
      const nx = ix / GRID_SIZE;
      const nz = iz / GRID_SIZE;
      const wx = nx + (fbm2(nx * 3.1, nz * 3.1, seed + 17, 2, 0.5, 2) - 0.5) * warp;
      const wz = nz + (fbm2(nx * 3.1 + 9.2, nz * 3.1 - 4.7, seed + 29, 2, 0.5, 2) - 0.5) * warp;
      const broad = fbm2(wx * frequency, wz * frequency, seed, 4, 0.5, 2.0);
      const detail = fbm2(wx * frequency * 3.2, wz * frequency * 3.2, seed + 911, 3, 0.5, 2.0);
      const ridge = ridgeNoise2(wx * frequency * 0.8 + 5.2, wz * frequency * 0.8 - 1.4, seed + 431);
      const value = broad * (0.8 - ridges * 0.5) + detail * 0.2 + ridge * ridges;
      raw[iz * STRIDE + ix] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const span = Math.max(1e-6, max - min);
  for (let i = 0; i < raw.length; i += 1) raw[i] = ((raw[i] ?? 0) - min) / span;
  return raw;
}

function rawAt(raw: Float32Array, x: number, z: number): number {
  const ix = clamp(Math.round(x), 0, GRID_SIZE);
  const iz = clamp(Math.round(z), 0, GRID_SIZE);
  return raw[iz * STRIDE + ix] ?? 0;
}

function chooseLayout(raw: Float32Array, seed: number): MapLayout {
  const rng = new Rng(seed ^ 0x3c6ef372);
  const relief = Math.round(rng.range(6, 10));
  const rx = Math.round(rng.range(17, 21));
  const rz = Math.round(rng.range(14, 17));

  // Town: the smoothest, mid-elevation patch in the interior band.
  let town = { x: 48, z: 48, score: Infinity };
  for (let z = 30; z <= 66; z += 2) {
    for (let x = 30; x <= 66; x += 2) {
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let dz = -rz; dz <= rz; dz += 3) {
        for (let dx = -rx; dx <= rx; dx += 3) {
          if ((dx / rx) ** 2 + (dz / rz) ** 2 > 1) continue;
          const v = rawAt(raw, x + dx, z + dz);
          sum += v;
          sumSq += v * v;
          n += 1;
        }
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      const centrality = Math.hypot(x - 48, z - 48) / 48;
      const score = variance * 40 + Math.abs(mean - 0.45) * 0.6 + centrality * 0.35 + rng.range(0, 0.12);
      if (score < town.score) town = { x, z, score };
    }
  }
  const townLevel = clamp(Math.round(rawAt(raw, town.x, town.z) * relief), 2, relief - 1);

  // Lake: the lowest smoothed basin away from the town and the map edge.
  const lakeR = rng.range(7.5, 10.5);
  let lake = { x: 20, z: 72, score: Infinity };
  for (let z = 14; z <= GRID_SIZE - 14; z += 2) {
    for (let x = 14; x <= GRID_SIZE - 14; x += 2) {
      const dTown = Math.hypot((x - town.x) / (rx + lakeR + 6), (z - town.z) / (rz + lakeR + 6));
      if (dTown < 1) continue;
      let sum = 0;
      let n = 0;
      for (let dz = -6; dz <= 6; dz += 3) {
        for (let dx = -6; dx <= 6; dx += 3) {
          sum += rawAt(raw, x + dx, z + dz);
          n += 1;
        }
      }
      const score = sum / n + rng.range(0, 0.05);
      if (score < lake.score) lake = { x, z, score };
    }
  }

  return {
    town: { x: town.x, z: town.z, rx, rz, level: townLevel },
    side: rng.next() < 0.5 ? 1 : -1,
    lake: { x: lake.x, z: lake.z, r: lakeR },
    relief,
  };
}

function quantizeLevels(raw: Float32Array, layout: MapLayout, seed: number): Uint8Array {
  const levels = new Uint8Array(STRIDE * STRIDE);
  const pinned = new Uint8Array(STRIDE * STRIDE);
  const { town, lake } = layout;
  const relief = layout.relief;
  for (let iz = 0; iz < STRIDE; iz += 1) {
    for (let ix = 0; ix < STRIDE; ix += 1) {
      const i = iz * STRIDE + ix;
      let value = (raw[i] ?? 0) * relief;
      // Blend toward the town plateau so the surroundings rise gently.
      const townDist = Math.sqrt(((ix - town.x) / town.rx) ** 2 + ((iz - town.z) / town.rz) ** 2);
      const townWeight = 1 - smoothstep(0.95, 1.7, townDist);
      value = value * (1 - townWeight) + town.level * townWeight;
      // Sink the lake basin.
      const lakeDist = Math.hypot(ix - lake.x, iz - lake.z);
      const lakeEdge = lake.r + (fbm2(ix * 0.14, iz * 0.14, seed + 71, 2, 0.5, 2) - 0.5) * 3.2;
      const lakeWeight = 1 - smoothstep(lakeEdge, lakeEdge + 7, lakeDist);
      value *= 1 - lakeWeight * 0.85;
      let level = Math.round(value) + 1;
      if (townDist <= 0.95) {
        level = town.level;
        pinned[i] = 1;
      }
      if (lakeDist < lakeEdge) level = 0;
      levels[i] = clamp(level, 0, MAX_LEVEL);
    }
  }
  raiseFloorAroundPins(levels, pinned);
  enforceSlopeLimit(levels, 96, pinned);
  return levels;
}

/** Make sure nothing next to a pinned plateau sits more than one level below it. */
function raiseFloorAroundPins(levels: Uint8Array, pinned: Uint8Array): void {
  const floor = new Int16Array(levels.length).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < levels.length; i += 1) {
    if (pinned[i] !== 1) continue;
    floor[i] = levels[i] ?? 0;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head] as number;
    const next = (floor[i] ?? 0) - 1;
    if (next <= 0) continue;
    const x = i % STRIDE;
    const neighbors = [x > 0 ? i - 1 : -1, x < STRIDE - 1 ? i + 1 : -1, i - STRIDE, i + STRIDE];
    for (const n of neighbors) {
      if (n < 0 || n >= levels.length) continue;
      if ((floor[n] ?? -1) >= next) continue;
      floor[n] = next;
      queue.push(n);
    }
  }
  for (let i = 0; i < levels.length; i += 1) {
    if ((floor[i] ?? -1) > (levels[i] ?? 0)) levels[i] = floor[i] as number;
  }
}

/** Lower-only Lipschitz pass: every cardinal vertex step ends up ≤ one level. */
function enforceSlopeLimit(levels: Uint8Array, passes: number, pinned?: Uint8Array): boolean {
  let changedAny = false;
  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;
    for (let iz = 0; iz < STRIDE; iz += 1) {
      for (let ix = 0; ix < STRIDE; ix += 1) {
        const i = iz * STRIDE + ix;
        if (pinned && pinned[i] === 1) continue;
        const value = levels[i] ?? 0;
        let minNeighbor = 255;
        if (ix > 0) minNeighbor = Math.min(minNeighbor, levels[i - 1] ?? 0);
        if (ix < STRIDE - 1) minNeighbor = Math.min(minNeighbor, levels[i + 1] ?? 0);
        if (iz > 0) minNeighbor = Math.min(minNeighbor, levels[i - STRIDE] ?? 0);
        if (iz < STRIDE - 1) minNeighbor = Math.min(minNeighbor, levels[i + STRIDE] ?? 0);
        if (value > minNeighbor + 1) {
          levels[i] = minNeighbor + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
    changedAny = true;
  }
  return changedAny;
}

function generateWaterMask(levels: Uint8Array, layout: MapLayout): Uint8Array {
  const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const { lake } = layout;
  for (let tz = 0; tz < GRID_SIZE; tz += 1) {
    for (let tx = 0; tx < GRID_SIZE; tx += 1) {
      const i = tz * STRIDE + tx;
      const maxCorner = Math.max(
        levels[i] ?? 0,
        levels[i + 1] ?? 0,
        levels[i + STRIDE] ?? 0,
        levels[i + STRIDE + 1] ?? 0,
      );
      const dist = Math.hypot(tx + 0.5 - lake.x, tz + 0.5 - lake.z);
      if (maxCorner <= 0 && dist < lake.r + 4) {
        mask[tz * GRID_SIZE + tx] = 1;
      }
    }
  }
  return mask;
}
