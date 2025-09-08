import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, ignite, applyWaterAoE, FireState } from '../fire/grid';
import { FireSim } from '../fire/sim';

function createFlatHeightmap(width: number, height: number) {
  return generateHeightmap(width, height, 1, {
    seed: 'flat',
    frequency: 0,
    amplitude: 0,
    octaves: 1,
    persistence: 1,
  });
}

describe('Early extinguish behavior', () => {
  it('transitions to smoldering when cool and isolated', () => {
    const hm = createFlatHeightmap(3, 3);
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes, {
      cellSize: 1,
      spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 },
    });

    // Wet everything to prevent neighbor ignition
    applyWaterAoE(grid, { x: 1, z: 1 }, 5, 1);
    ignite(grid, [{ x: 1, z: 1 }]);
    // Knock heat below extinguish threshold
    applyWaterAoE(grid, { x: 1, z: 1 }, 0.5, 1);

    const sim = new FireSim(grid);
    sim.step(0.25);
    const center = grid.tiles[1 * grid.width + 1];
    expect(center.state).toBe(FireState.Smoldering);
  });

});
