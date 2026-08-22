import { Heightmap } from '../terrain/heightmap';
import { BiomeMask } from '../terrain/biomes';
import { DEFAULT_FIRE_PARAMS, FireParams, FuelKey } from './params';
import type { FireHydrant } from './hydrants';

export const enum FireState {
  Unburned = 0,
  Igniting = 1,
  Burning = 2,
  Smoldering = 3,
  Burned = 4,
}

// Canonical fuel ordering for the structure-of-arrays fuel indices.
// Index order matches the FuelKey union declaration order.
export const FUEL_KEYS = ['grass', 'chaparral', 'forest', 'rock', 'water', 'urban'] as const;

const FUEL_INDEX: Record<FuelKey, number> = {
  grass: 0,
  chaparral: 1,
  forest: 2,
  rock: 3,
  water: 4,
  urban: 5,
};

/** Map a FuelKey to its typed-array index. */
export function fuelIndex(key: FuelKey): number {
  return FUEL_INDEX[key];
}

/** Map a tile index to its FuelKey. */
export function fuelKeyOf(grid: FireGrid, i: number): FuelKey {
  return FUEL_KEYS[grid.fuel[i]];
}

export type FireGrid = {
  width: number;
  height: number;
  params: FireParams;
  state: Uint8Array;          // FireState values 0..4
  heat: Float32Array;         // 0..1
  progress: Float32Array;     // 0..1, burn progression
  wetness: Float32Array;      // 0..1
  retardant: Float32Array;    // 0..1
  lineStrength: Float32Array; // 0..1 (tile-based for now)
  fuelMoisture: Float32Array; // 0..1 (ambient fuel moisture)
  lastIgnitedAt: Float32Array;// seconds (promotion timer)
  fuel: Uint8Array;           // index into FUEL_KEYS
  slopeTan: Float32Array;     // |tan(slope)|
  downX: Float32Array;        // downslope direction (unit, xz)
  downZ: Float32Array;
  igniting: Uint32Array; // indices of igniting tiles
  burning: Uint32Array;    // indices of burning tiles (sparse window over capacity)
  smoldering: Uint32Array; // indices of smoldering tiles
  iCount: number;
  bCount: number;
  sCount: number;
  time: number;
  seed: number;
};

/** Plain-object view of one tile (snapshot); see sampleTile. */
export type TileSnapshot = {
  state: FireState;
  heat: number;
  progress: number;
  wetness: number;
  retardant: number;
  lineStrength: number;
  fuelMoisture: number;
  lastIgnitedAt: number;
  fuel: FuelKey;
  slopeTan: number;
  downX: number;
  downZ: number;
};

const UNBURNED_I = FireState.Unburned as number;
const IGNITING_I = FireState.Igniting as number;
const BURNING_I = FireState.Burning as number;
const SMOLDERING_I = FireState.Smoldering as number;
const ROCK_I = FUEL_INDEX.rock;
const WATER_I = FUEL_INDEX.water;
const URBAN_I = FUEL_INDEX.urban;

export function buildFireGrid(hm: Heightmap, biomes: BiomeMask, params: Partial<FireParams> = {}): FireGrid {
  const P: FireParams = { ...DEFAULT_FIRE_PARAMS, ...params, fuels: { ...DEFAULT_FIRE_PARAMS.fuels, ...(params as any)?.fuels } };
  const width = hm.width;
  const height = hm.height;
  const cap = width * height;

  const state = new Uint8Array(cap);
  const heat = new Float32Array(cap);
  const progress = new Float32Array(cap);
  const wetness = new Float32Array(cap);
  const retardant = new Float32Array(cap);
  const lineStrength = new Float32Array(cap);
  const fuelMoisture = new Float32Array(cap);
  const lastIgnitedAt = new Float32Array(cap).fill(-1);
  const fuel = new Uint8Array(cap);
  const slopeTan = new Float32Array(cap);
  const downX = new Float32Array(cap);
  const downZ = new Float32Array(cap);

  const cols = hm.width + 1;
  const rows = hm.height + 1;

  // Precompute slope and downslope dir from heightmap central differences
  function slopeAt(x: number, z: number) {
    const xi = Math.min(cols - 2, Math.max(1, x));
    const zi = Math.min(rows - 2, Math.max(1, z));
    const hL = hm.data[zi * cols + (xi - 1)];
    const hR = hm.data[zi * cols + (xi + 1)];
    const hD = hm.data[(zi - 1) * cols + xi];
    const hU = hm.data[(zi + 1) * cols + xi];
    const dx = (hR - hL) * 0.5; // gradient in +X direction
    const dz = (hU - hD) * 0.5; // gradient in +Z direction
    const tanSlope = Math.hypot(dx, dz) / (1.0 * hm.scale);
    const len = Math.hypot(dx, dz) || 1e-6;
    // Return downslope direction (opposite of gradient)
    return { tanSlope, downX: -dx / len, downZ: -dz / len };
  }

  const chooseFuel = (i: number): FuelKey => {
    // Map biome masks to fuels
    if (biomes.rock[i]) return 'rock';
    if (biomes.forest[i]) return 'forest';
    if (biomes.chaparral[i]) return 'chaparral';
    return 'grass';
  };

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const gi = z * cols + x;
      const i = z * width + x;
      const { tanSlope, downX: dxD, downZ: dzD } = slopeAt(x, z);
      const fk = chooseFuel(gi);
      // Simple default fuel moisture by fuel
      const fmoist = fk === 'forest' ? 0.18 : fk === 'chaparral' ? 0.15 : fk === 'grass' ? 0.12 : 1.0;
      fuel[i] = FUEL_INDEX[fk];
      fuelMoisture[i] = fmoist;
      slopeTan[i] = tanSlope;
      downX[i] = dxD;
      downZ[i] = dzD;
    }
  }

  // Pre-allocate frontier lists (capacity = all tiles)
  const igniting = new Uint32Array(cap);
  const burning = new Uint32Array(cap);
  const smoldering = new Uint32Array(cap);

  return {
    width, height, params: P,
    state, heat, progress, wetness, retardant, lineStrength, fuelMoisture, lastIgnitedAt,
    fuel, slopeTan, downX, downZ,
    igniting, burning, smoldering, iCount: 0, bCount: 0, sCount: 0, time: 0, seed: 12345,
  };
}

export function coordToIndex(grid: FireGrid, x: number, z: number) {
  return z * grid.width + x;
}

export function indexToCoord(grid: FireGrid, idx: number) {
  const x = idx % grid.width;
  const z = (idx / grid.width) | 0;
  return { x, z };
}

export function ignite(grid: FireGrid, cells: Array<{ x: number; z: number }>, intensity = 0.6) {
  for (const { x, z } of cells) {
    if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) continue;
    const i = coordToIndex(grid, x, z);
    if (grid.fuel[i] === ROCK_I || grid.fuel[i] === WATER_I) continue;
    if (grid.state[i] === UNBURNED_I || grid.state[i] === IGNITING_I) {
      // Manual ignition: promote directly to Burning for instant feedback
      grid.state[i] = BURNING_I;
      grid.heat[i] = Math.max(grid.heat[i], intensity);
      grid.progress[i] = 0.01;
      grid.lastIgnitedAt[i] = grid.time;
      grid.burning[grid.bCount++] = i;
    }
  }
}

export type WaterHydrantCoverageSource = {
  readonly hydrants: ReadonlyArray<Pick<FireHydrant, 'active' | 'gridPos' | 'coverageRadius'>>;
};

function applyWaterInRadius(
  grid: FireGrid,
  center: { x: number; z: number },
  radius: number,
  intensity: number,
  hydrantSystem?: WaterHydrantCoverageSource,
) {
  const r2 = radius * radius;

  for (let z = Math.max(0, Math.floor(center.z - radius)); z < Math.min(grid.height, Math.ceil(center.z + radius)); z++) {
    for (let x = Math.max(0, Math.floor(center.x - radius)); x < Math.min(grid.width, Math.ceil(center.x + radius)); x++) {
      const dx = x - center.x; const dz = z - center.z;
      if (dx * dx + dz * dz <= r2) {
        const i = coordToIndex(grid, x, z);

        // Check if this position has hydrant coverage for enhanced effectiveness
        let effectiveIntensity = intensity;
        if (hydrantSystem) {
          let hasHydrantCoverage = false;
          for (const h of hydrantSystem.hydrants) {
            if (!h.active) continue;
            const hdx = h.gridPos.x - x;
            const hdz = h.gridPos.z - z;
            if ((hdx * hdx + hdz * hdz) <= (h.coverageRadius * h.coverageRadius)) {
              hasHydrantCoverage = true;
              break;
            }
          }
          if (hasHydrantCoverage) {
            effectiveIntensity *= 1.5; // 50% more effective with hydrant coverage
          }
        }

        grid.wetness[i] = Math.min(1, grid.wetness[i] + effectiveIntensity);

        // Immediate heat knockdown effect as per spec
        if (grid.state[i] === BURNING_I || grid.state[i] === SMOLDERING_I) {
          const knockdown = 0.8 * effectiveIntensity;
          grid.heat[i] = Math.max(0, grid.heat[i] - knockdown);

          // Check for early extinguish if heat drops below threshold
          if (grid.heat[i] < grid.params.thresholds.extinguishHeat) {
            if (grid.state[i] === BURNING_I) {
              grid.state[i] = SMOLDERING_I;
            }
          }
        }
      }
    }
  }
}

export function applyWaterAoE(grid: FireGrid, center: { x: number; z: number }, radius: number, intensity: number) {
  applyWaterInRadius(grid, center, radius, intensity);
}

// Enhanced water application that considers hydrant coverage for improved effectiveness
export function applyWaterAoEWithHydrants(
  grid: FireGrid,
  center: { x: number; z: number },
  radius: number,
  intensity: number,
  hydrantSystem?: WaterHydrantCoverageSource,
) {
  applyWaterInRadius(grid, center, radius, intensity, hydrantSystem);
}

function stampRetardantDisc(grid: FireGrid, cx: number, cz: number, r: number, strength: number) {
  const r2 = r * r;
  const lineStrengthCap = strength * 0.7;
  for (let z = Math.max(0, Math.floor(cz - r)); z < Math.min(grid.height, Math.ceil(cz + r)); z++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(grid.width, Math.ceil(cx + r)); x++) {
      const dx = x - cx; const dz = z - cz;
      if (dx * dx + dz * dz <= r2) {
        const i = coordToIndex(grid, x, z);
        grid.retardant[i] = Math.max(grid.retardant[i], strength);
        grid.lineStrength[i] = Math.max(grid.lineStrength[i], lineStrengthCap);
      }
    }
  }
}

export function applyRetardantLine(grid: FireGrid, polyline: Array<{ x: number; z: number }>, width: number, strength: number) {
  // Rasterize simple discs along the line, interpolating between points
  for (let k = 0; k < polyline.length; k++) {
    const c = polyline[k];

    // Apply disc at current point
    stampRetardantDisc(grid, c.x, c.z, width, strength);

    // Interpolate to next point if it exists
    if (k + 1 < polyline.length) {
      const next = polyline[k + 1];
      const dx = next.x - c.x;
      const dz = next.z - c.z;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(len)); // At least one step per unit distance

      for (let step = 1; step < steps; step++) {
        const t = step / steps;
        const interpX = c.x + dx * t;
        const interpZ = c.z + dz * t;

        // Apply disc at interpolated point
        stampRetardantDisc(grid, interpX, interpZ, width, strength);
      }
    }
  }
}

// Restore biome-driven fuels for any tiles that were marked as urban (e.g., after clearing roads)
export function restoreFuelsFromBiomes(grid: FireGrid, biomes: BiomeMask) {
  const cols = grid.width + 1;
  const chooseFuel = (gi: number): FuelKey => {
    if (biomes.rock[gi]) return 'rock';
    if (biomes.forest[gi]) return 'forest';
    if (biomes.chaparral[gi]) return 'chaparral';
    return 'grass';
  };
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const i = z * grid.width + x;
      if (grid.fuel[i] !== URBAN_I) continue;
      const gi = z * cols + x;
      grid.fuel[i] = FUEL_INDEX[chooseFuel(gi)];
    }
  }
}

export function writeFirelineEdges(grid: FireGrid, edgePath: Array<{ x: number; z: number }>, strength: number) {
  for (const p of edgePath) {
    const x = Math.round(p.x), z = Math.round(p.z);
    if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) continue;
    const i = coordToIndex(grid, x, z);
    grid.lineStrength[i] = Math.max(grid.lineStrength[i], strength);
  }
}

export function isContained(grid: FireGrid): boolean {
  // Simple heuristic: if any burning tile has at least one unburned neighbor with low lineStrength, not contained
  for (let bi = 0; bi < grid.bCount; bi++) {
    const i = grid.burning[bi];
    const c = indexToCoord(grid, i);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = c.x + dx, nz = c.z + dz;
      if (nx < 0 || nz < 0 || nx >= grid.width || nz >= grid.height) continue;
      const j = coordToIndex(grid, nx, nz);
      if (grid.state[j] === UNBURNED_I && grid.lineStrength[j] < 0.9) return false;
    }
  }
  return true;
}

export function sampleTile(grid: FireGrid, x: number, z: number): TileSnapshot {
  const i = coordToIndex(grid, x, z);
  return {
    state: grid.state[i] as FireState,
    heat: grid.heat[i],
    progress: grid.progress[i],
    wetness: grid.wetness[i],
    retardant: grid.retardant[i],
    lineStrength: grid.lineStrength[i],
    fuelMoisture: grid.fuelMoisture[i],
    lastIgnitedAt: grid.lastIgnitedAt[i],
    fuel: fuelKeyOf(grid, i),
    slopeTan: grid.slopeTan[i],
    downX: grid.downX[i],
    downZ: grid.downZ[i],
  };
}
