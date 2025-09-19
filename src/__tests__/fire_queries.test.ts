import { describe, expect, it } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import {
  buildFireGrid,
  ignite,
  isContained,
  sampleTile,
  FireState,
  coordToIndex,
} from '../fire/grid';

describe('fire grid helper queries', () => {
  const makeGrid = () => {
    const hm = generateHeightmap(8, 8, 1, {
      seed: 'flat',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const biomes = computeBiomes(hm);
    return buildFireGrid(hm, biomes, { spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 } });
  };

  it('returns the same tile instance for sampleTile', () => {
    const grid = makeGrid();
    const target = { x: 2, z: 3 };
    const idx = coordToIndex(grid, target.x, target.z);
    const fromArray = grid.tiles[idx];
    const sampled = sampleTile(grid, target.x, target.z);

    expect(sampled).toBe(fromArray);
    sampled.heat = 0.42;
    expect(grid.tiles[idx].heat).toBeCloseTo(0.42);
  });

  it('detects containment when surrounding line strength is high', () => {
    const grid = makeGrid();
    const center = { x: 4, z: 4 };
    ignite(grid, [center], 0.8);
    const centerIdx = coordToIndex(grid, center.x, center.z);
    grid.tiles[centerIdx].state = FireState.Burning;

    expect(isContained(grid)).toBe(false);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = center.x + dx;
        const nz = center.z + dz;
        const idx = coordToIndex(grid, nx, nz);
        grid.tiles[idx].lineStrength = 1;
      }
    }

    expect(isContained(grid)).toBe(true);
  });
});
