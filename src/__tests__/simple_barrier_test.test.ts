import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, ignite, applyRetardantLine } from '../fire/grid';
import { FireSim } from '../fire/sim';

function createFlatHeightmap(width: number, height: number) {
  return generateHeightmap(width, height, 1, { 
    seed: 'flat', 
    frequency: 0, 
    amplitude: 0, 
    octaves: 1, 
    persistence: 1 
  });
}

describe('Simple Barrier Test', () => {
  it('should show retardant blocking fire in minimal case', () => {
    const hm = createFlatHeightmap(8, 8);
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes, { 
      cellSize: 1,
      spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 },
      thresholds: { extinguishHeat: 0.12, crownHeat: 10.0 } // Disable crown bypass
    });
    
    // Apply strong retardant line at z=4
    for (let x = 0; x < 8; x++) {
      applyRetardantLine(grid, [{ x, z: 4 }], 1, 1.0);
    }

    const barrierTile = grid.tiles[4 * 8 + 4];
    expect(barrierTile.retardant).toBeGreaterThan(0.5);
    expect(barrierTile.lineStrength).toBeGreaterThan(0);
    
    // Ignite south of barrier
    ignite(grid, [{ x: 4, z: 2 }]);
    
    // Run simulation with north wind
    const env = { windDirRad: 0, windSpeed: 1 }; // North wind
    const sim = new FireSim(grid, env);
    
    // Run for limited time
    for (let i = 0; i < 40; i++) sim.step(0.25); // 10 seconds
    
    // Check fire distribution
    let fireSouth = 0, fireNorth = 0;
    for (let z = 0; z < 4; z++) {
      for (let x = 0; x < 8; x++) {
        if (grid.tiles[z * 8 + x].state >= 2) fireSouth++;
      }
    }
    for (let z = 5; z < 8; z++) {
      for (let x = 0; x < 8; x++) {
        if (grid.tiles[z * 8 + x].state >= 2) fireNorth++;
      }
    }
    
    expect(fireSouth).toBeGreaterThan(0); // Should have fire on ignition side
    expect(fireNorth).toBe(0); // Should block fire crossing
  });
});
