import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, ignite } from '../fire/grid';
import { FireSim } from '../fire/sim';
import { computeFireStats } from '../fire/stats';

function runScenario(seed: string | number) {
  const hm = generateHeightmap(32, 32, 1, { seed, frequency: 0.8, amplitude: 0.0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  const grid = buildFireGrid(hm, biomes, { cellSize: 1, spotting: { enabled: false, baseRate: 0.02, maxDistanceTiles: 16 } });
  // Ignite center
  ignite(grid, [{ x: 16, z: 16 }], 0.7);
  const sim = new FireSim(grid, { windDirRad: 0, windSpeed: 0, humidity: 0.3 });
  // Run ~10 seconds of sim at 60 FPS
  for (let f = 0; f < 600; f++) sim.step(1 / 60);
  return computeFireStats(grid);
}

describe('fire simulation determinism', () => {
  it('produces identical stats on repeated runs with same seed and env', () => {
    const a = runScenario('seed-1');
    const b = runScenario('seed-1');
    expect(a.burning).toBe(b.burning);
    expect(a.smoldering).toBe(b.smoldering);
    expect(a.burnedTiles).toBe(b.burnedTiles);
    expect(Math.round(a.perimeterWorld * 1000)).toBe(Math.round(b.perimeterWorld * 1000));
  });
});

