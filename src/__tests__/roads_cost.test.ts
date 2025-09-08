import { describe, it, expect } from 'vitest';
import { buildTerrainCost } from '../roads/cost';
import type { Heightmap } from '../terrain/heightmap';

function makeHeightmap(width: number, height: number, scale: number, data: Float32Array): Heightmap {
  return {
    width,
    height,
    scale,
    data,
    sample: () => 0, // mock implementation - not used in these tests
  };
}

describe('buildTerrainCost', () => {
  it('normalizes elevation and computes uniform slope for planar gradient', () => {
    const width = 3;
    const height = 3;
    const scale = 1;
    const cols = width + 1, rows = height + 1;
    const data = new Float32Array(cols * rows);
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        data[z * cols + x] = x; // height increases along x
      }
    }
    const hm = makeHeightmap(width, height, scale, data);
    const cost = buildTerrainCost(hm);
    let min = Infinity, max = -Infinity;
    for (const e of cost.elev) { if (e < min) min = e; if (e > max) max = e; }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 5);
    for (const s of cost.slope) {
      expect(s).toBeCloseTo(1, 5);
    }
    for (const v of cost.valley) {
      expect(v).toBeCloseTo(1, 5);
    }
  });

});

