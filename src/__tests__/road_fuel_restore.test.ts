import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, restoreFuelsFromBiomes } from '../fire/grid';
import { createRoadMask, applyRoadMaskToFireGrid } from '../roads/state';

describe('road mask fuel restoration', () => {
  it('restores road-marked urban tiles back to biome fuels', () => {
    const hm = generateHeightmap(4, 4, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
    const roadMask = createRoadMask(hm.width, hm.height);

    // Mark a single road tile and apply to fire grid (urban fuel)
    roadMask.mask[1 * hm.width + 2] = 1;
    applyRoadMaskToFireGrid(grid as any, roadMask);
    expect(grid.tiles[1 * hm.width + 2].fuel).toBe('urban');

    restoreFuelsFromBiomes(grid, biomes);
    // Flat map defaults to grass/forest/chaparral; anything but urban is acceptable here
    const restoredFuel = grid.tiles[1 * hm.width + 2].fuel;
    expect(restoredFuel === 'urban').toBe(false);
  });
});
