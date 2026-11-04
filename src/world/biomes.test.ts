import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from './constants';
import { Heightmap } from './heightmap';
import { classifyTerrain, Terrain } from './biomes';

describe('terrain classification', () => {
  const map = new Heightmap(4242);
  const biomes = classifyTerrain(map);

  it('classifies every tile into a known terrain', () => {
    expect(biomes.types.length).toBe(GRID_SIZE * GRID_SIZE);
    for (const type of biomes.types) {
      expect(type).toBeGreaterThanOrEqual(Terrain.Water);
      expect(type).toBeLessThanOrEqual(Terrain.Road);
    }
  });

  it('maps lake tiles to water and gives the map varied fuel', () => {
    for (let z = 0; z < GRID_SIZE; z += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (map.isWater(x, z)) {
          expect(biomes.types[z * GRID_SIZE + x]).toBe(Terrain.Water);
        }
      }
    }
    const seen = new Set(biomes.types);
    expect(seen.has(Terrain.Grass)).toBe(true);
    expect(seen.has(Terrain.Forest) || seen.has(Terrain.Brush)).toBe(true);
    expect(seen.has(Terrain.Rock)).toBe(true);
  });

  it('keeps moisture and slope in physical ranges', () => {
    for (let i = 0; i < biomes.moisture.length; i += 1) {
      expect(biomes.moisture[i]).toBeGreaterThanOrEqual(0);
      expect(biomes.moisture[i]).toBeLessThanOrEqual(1);
      expect(biomes.slope[i]).toBeGreaterThanOrEqual(0);
    }
  });
});
