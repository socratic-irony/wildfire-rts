import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, ignite } from '../fire/grid';
import { computePerimeter } from '../fire/perimeter';
import { computeFireStats } from '../fire/stats';

describe('fire perimeter extraction', () => {
  it('produces a single loop for a 2x2 block and correct length', () => {
    const hm = generateHeightmap(6, 6, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const biomes = computeBiomes(hm);
    const grid = buildFireGrid(hm, biomes, { cellSize: 1 });
    // Ignite a 2x2 square centered roughly at (2,2)-(3,3)
    ignite(grid, [
      { x: 2, z: 2 }, { x: 3, z: 2 },
      { x: 2, z: 3 }, { x: 3, z: 3 },
    ], 0.8);

    const polys = computePerimeter(grid);
    // Expect at least one polyline
    expect(polys.length).toBeGreaterThan(0);
    // Find the longest one (outer perimeter)
    let maxLen = 0;
    for (const p of polys) {
      let len = 0; for (let i = 1; i < p.length; i++) { const a = p[i-1], b = p[i]; len += Math.hypot(b.x - a.x, b.z - a.z); }
      if (len > maxLen) maxLen = len;
    }
    // A 2x2 block perimeter = 8 tile-edge units
    expect(Math.round(maxLen)).toBe(8);

    const stats = computeFireStats(grid);
    expect(stats.perimeterTile).toBeGreaterThan(0);
    expect(Math.round(stats.perimeterTile)).toBe(8);
    expect(stats.active).toBe(4);
  });
});

