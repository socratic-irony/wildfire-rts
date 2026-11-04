import { clamp, smoothstep } from '../core/math';
import { fbm2 } from '../core/rng';
import { GRID_SIZE } from './constants';
import { Heightmap, LAKE_CENTER, LAKE_RADIUS, TOWN_CENTER, TOWN_RADIUS } from './heightmap';

export enum Terrain {
  Water = 0,
  Rock = 1,
  Forest = 2,
  Brush = 3,
  Grass = 4,
  Urban = 5,
  Road = 6,
}

export const TERRAIN_NAMES: Record<Terrain, string> = {
  [Terrain.Water]: 'Water',
  [Terrain.Rock]: 'Rock',
  [Terrain.Forest]: 'Timber',
  [Terrain.Brush]: 'Chaparral',
  [Terrain.Grass]: 'Grassland',
  [Terrain.Urban]: 'Town',
  [Terrain.Road]: 'Asphalt',
};

export const TERRAIN_COLORS: Record<Terrain, number> = {
  [Terrain.Water]: 0x3f86a8,
  [Terrain.Rock]: 0x8c877c,
  [Terrain.Forest]: 0x4d7a45,
  [Terrain.Brush]: 0x99975f,
  [Terrain.Grass]: 0x7fac5d,
  [Terrain.Urban]: 0xb09a72,
  [Terrain.Road]: 0x4a4a4a,
};

export interface BiomeMap {
  types: Uint8Array;
  moisture: Float32Array;
  slope: Float32Array;
}

export function classifyTerrain(heightmap: Heightmap): BiomeMap {
  const types = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const moisture = new Float32Array(GRID_SIZE * GRID_SIZE);
  const slope = new Float32Array(GRID_SIZE * GRID_SIZE);
  const seed = heightmap.seed;

  for (let tz = 0; tz < GRID_SIZE; tz += 1) {
    for (let tx = 0; tx < GRID_SIZE; tx += 1) {
      const index = tz * GRID_SIZE + tx;
      const tileSlope = heightmap.slopeTan(tx, tz);
      slope[index] = tileSlope;
      if (heightmap.isWater(tx, tz)) {
        types[index] = Terrain.Water;
        moisture[index] = 1;
        continue;
      }

      const edgeNoise = fbm2(tx * 0.11, tz * 0.11, seed + 811, 3, 0.5, 2);
      const localMoisture = fbm2(tx * 0.075, tz * 0.075, seed + 1201, 4, 0.55, 2);
      const lakeDistance = Math.hypot(tx - LAKE_CENTER.x, tz - LAKE_CENTER.z);
      const lakeInfluence = 1 - smoothstep(LAKE_RADIUS, LAKE_RADIUS + 22, lakeDistance);
      const wetness = clamp(localMoisture * 0.78 + lakeInfluence * 0.34, 0, 1);
      moisture[index] = wetness;

      const elevation = heightmap.tileHeight(tx, tz);
      const highRock = elevation > 10 && edgeNoise > 0.52;
      const steepRock = tileSlope > 0.72;
      if (steepRock || highRock) {
        types[index] = Terrain.Rock;
        continue;
      }

      const townDx = (tx - TOWN_CENTER.x) / (TOWN_RADIUS.x * 0.82);
      const townDz = (tz - TOWN_CENTER.z) / (TOWN_RADIUS.z * 0.82);
      if (townDx * townDx + townDz * townDz < 1) {
        types[index] = Terrain.Urban;
        continue;
      }

      if (wetness > 0.6 && tileSlope < 0.6) {
        types[index] = Terrain.Forest;
      } else if (wetness > 0.38 || edgeNoise > 0.64) {
        types[index] = Terrain.Brush;
      } else {
        types[index] = Terrain.Grass;
      }
    }
  }

  return { types, moisture, slope };
}

export function terrainName(type: number): string {
  return TERRAIN_NAMES[type as Terrain] ?? 'Unknown';
}
