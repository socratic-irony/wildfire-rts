import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';

describe('heightmap', () => {
  it('generates correct dimensions and sampling', () => {
    const hm = generateHeightmap(16, 8, 1, {
      seed: 1,
      frequency: 2,
      amplitude: 5,
      octaves: 3,
      persistence: 0.5,
    });
    expect(hm.data.length).toBe((16 + 1) * (8 + 1));
    const x = 10, z = 6;
    const idx = z * (16 + 1) + x;
    expect(hm.sample(x, z)).toBeCloseTo(hm.data[idx], 5);
  });
});

