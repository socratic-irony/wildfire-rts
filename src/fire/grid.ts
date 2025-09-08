import { Heightmap } from '../terrain/heightmap';
import { BiomeMask } from '../terrain/biomes';
import { DEFAULT_FIRE_PARAMS, FireParams, FuelKey } from './params';

export const enum FireState {
  Unburned = 0,
  Igniting = 1,
  Burning = 2,
  Smoldering = 3,
  Burned = 4,
}

export type Tile = {
  state: FireState;
  heat: number;          // 0..1
  progress: number;      // 0..1, burn progression
  wetness: number;       // 0..1
  retardant: number;     // 0..1
  lineStrength: number;  // 0..1 (tile-based for now)
  fuelMoisture: number;  // 0..1 (ambient fuel moisture)
  lastIgnitedAt: number; // seconds (promotion timer)
  fuel: FuelKey;
  slopeTan: number;      // |tan(slope)|
  downX: number;         // downslope direction (unit, xz)
  downZ: number;
};

export type Env = {
  windDirRad: number;  // radians, direction wind blows TO (0 = +Z)
  windSpeed: number;   // m/s
  airTempC: number;    // not used yet
  humidity: number;    // 0..1, not used yet
};

export type FireGrid = {
  width: number;
  height: number;
  params: FireParams;
  tiles: Tile[];
  igniting: Uint32Array; // indices of igniting tiles
  burning: Uint32Array;    // indices of burning tiles (sparse window over capacity)
  smoldering: Uint32Array; // indices of smoldering tiles
  iCount: number;
  bCount: number;
  sCount: number;
  time: number;
  seed: number;
};

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function buildFireGrid(hm: Heightmap, biomes: BiomeMask, params: Partial<FireParams> = {}): FireGrid {
  const P: FireParams = { ...DEFAULT_FIRE_PARAMS, ...params, fuels: { ...DEFAULT_FIRE_PARAMS.fuels, ...(params as any)?.fuels } };
  const width = hm.width;
  const height = hm.height;
  const tiles: Tile[] = new Array(width * height);

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
      const { tanSlope, downX, downZ } = slopeAt(x, z);
      const fuel = chooseFuel(gi);
      // Simple default fuel moisture by fuel
      const fmoist = fuel === 'forest' ? 0.18 : fuel === 'chaparral' ? 0.15 : fuel === 'grass' ? 0.12 : 1.0;
      tiles[z * width + x] = {
        state: FireState.Unburned,
        heat: 0,
        progress: 0,
        wetness: 0,
        retardant: 0,
        lineStrength: 0,
        fuelMoisture: fmoist,
        lastIgnitedAt: -1,
        fuel,
        slopeTan: tanSlope,
        downX, downZ,
      };
    }
  }

  // Pre-allocate frontier lists (capacity = all tiles)
  const cap = width * height;
  const igniting = new Uint32Array(cap);
  const burning = new Uint32Array(cap);
  const smoldering = new Uint32Array(cap);

  return { width, height, params: P, tiles, igniting, burning, smoldering, iCount: 0, bCount: 0, sCount: 0, time: 0, seed: 12345 };
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
    const t = grid.tiles[i];
    if (t.fuel === 'rock' || t.fuel === 'water') continue;
    if (t.state === FireState.Unburned || t.state === FireState.Igniting) {
      // Manual ignition: promote directly to Burning for instant feedback
      t.state = FireState.Burning;
      t.heat = Math.max(t.heat, intensity);
      t.progress = 0.01;
      t.lastIgnitedAt = grid.time;
      grid.burning[grid.bCount++] = i;
    }
  }
}

export function applyWaterAoE(grid: FireGrid, center: { x: number; z: number }, radius: number, intensity: number) {
  const r2 = radius * radius;
  for (let z = Math.max(0, Math.floor(center.z - radius)); z < Math.min(grid.height, Math.ceil(center.z + radius)); z++) {
    for (let x = Math.max(0, Math.floor(center.x - radius)); x < Math.min(grid.width, Math.ceil(center.x + radius)); x++) {
      const dx = x - center.x; const dz = z - center.z;
      if (dx * dx + dz * dz <= r2) {
        const i = coordToIndex(grid, x, z);
        const tile = grid.tiles[i];
        tile.wetness = Math.min(1, tile.wetness + intensity);
        
        // Immediate heat knockdown effect as per spec
        if (tile.state === FireState.Burning || tile.state === FireState.Smoldering) {
          const knockdown = 0.8 * intensity; // Increase from 0.4 to 0.8 for stronger suppression
          tile.heat = Math.max(0, tile.heat - knockdown);
          
          // Check for early extinguish if heat drops below threshold
          if (tile.heat < grid.params.thresholds.extinguishHeat) {
            if (tile.state === FireState.Burning) {
              tile.state = FireState.Smoldering;
            }
          }
        }
      }
    }
  }
}

// Enhanced water application that considers hydrant coverage for improved effectiveness
export function applyWaterAoEWithHydrants(
  grid: FireGrid, 
  center: { x: number; z: number }, 
  radius: number, 
  intensity: number, 
  hydrantSystem?: { hydrants: Array<{ active: boolean; gridPos: { x: number; z: number }; coverageRadius: number }> }
) {
  const r2 = radius * radius;
  
  for (let z = Math.max(0, Math.floor(center.z - radius)); z < Math.min(grid.height, Math.ceil(center.z + radius)); z++) {
    for (let x = Math.max(0, Math.floor(center.x - radius)); x < Math.min(grid.width, Math.ceil(center.x + radius)); x++) {
      const dx = x - center.x; const dz = z - center.z;
      if (dx * dx + dz * dz <= r2) {
        const i = coordToIndex(grid, x, z);
        const tile = grid.tiles[i];
        
        // Check if this position has hydrant coverage for enhanced effectiveness
        let effectiveIntensity = intensity;
        if (hydrantSystem) {
          const hasHydrantCoverage = hydrantSystem.hydrants.some(h => {
            if (!h.active) return false;
            const hdx = h.gridPos.x - x;
            const hdz = h.gridPos.z - z;
            return (hdx * hdx + hdz * hdz) <= (h.coverageRadius * h.coverageRadius);
          });
          if (hasHydrantCoverage) {
            effectiveIntensity *= 1.5; // 50% more effective with hydrant coverage
          }
        }
        
        tile.wetness = Math.min(1, tile.wetness + effectiveIntensity);
        
        // Immediate heat knockdown effect as per spec
        if (tile.state === FireState.Burning || tile.state === FireState.Smoldering) {
          const knockdown = 0.8 * effectiveIntensity;
          tile.heat = Math.max(0, tile.heat - knockdown);
          
          // Check for early extinguish if heat drops below threshold
          if (tile.heat < grid.params.thresholds.extinguishHeat) {
            if (tile.state === FireState.Burning) {
              tile.state = FireState.Smoldering;
            }
          }
        }
      }
    }
  }
}

export function applyRetardantLine(grid: FireGrid, polyline: Array<{ x: number; z: number }>, width: number, strength: number) {
  // Rasterize simple discs along the line, interpolating between points
  for (let k = 0; k < polyline.length; k++) {
    const c = polyline[k];
    
    // Apply disc at current point
    const r = width;
    const r2 = r * r;
    for (let z = Math.max(0, Math.floor(c.z - r)); z < Math.min(grid.height, Math.ceil(c.z + r)); z++) {
      for (let x = Math.max(0, Math.floor(c.x - r)); x < Math.min(grid.width, Math.ceil(c.x + r)); x++) {
        const dx = x - c.x; const dz = z - c.z;
        if (dx * dx + dz * dz <= r2) {
          const i = coordToIndex(grid, x, z);
          grid.tiles[i].retardant = Math.max(grid.tiles[i].retardant, strength);
          grid.tiles[i].lineStrength = Math.max(grid.tiles[i].lineStrength, strength * 0.7);
        }
      }
    }
    
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
        for (let z = Math.max(0, Math.floor(interpZ - r)); z < Math.min(grid.height, Math.ceil(interpZ + r)); z++) {
          for (let x = Math.max(0, Math.floor(interpX - r)); x < Math.min(grid.width, Math.ceil(interpX + r)); x++) {
            const dx = x - interpX; const dz = z - interpZ;
            if (dx * dx + dz * dz <= r2) {
              const i = coordToIndex(grid, x, z);
              grid.tiles[i].retardant = Math.max(grid.tiles[i].retardant, strength);
              grid.tiles[i].lineStrength = Math.max(grid.tiles[i].lineStrength, strength * 0.7);
            }
          }
        }
      }
    }
  }
}

export function writeFirelineEdges(grid: FireGrid, edgePath: Array<{ x: number; z: number }>, strength: number) {
  for (const p of edgePath) {
    const x = Math.round(p.x), z = Math.round(p.z);
    if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) continue;
    const i = coordToIndex(grid, x, z);
    grid.tiles[i].lineStrength = Math.max(grid.tiles[i].lineStrength, strength);
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
      const t = grid.tiles[j];
      if (t.state === FireState.Unburned && t.lineStrength < 0.9) return false;
    }
  }
  return true;
}

export function sampleTile(grid: FireGrid, x: number, z: number) {
  return grid.tiles[coordToIndex(grid, x, z)];
}
