import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { generateProceduralRoads } from '../procedural';

describe('procedural roads', () => {
  it('creates closed loops within terrain bounds', () => {
    const hm = generateHeightmap(64, 64, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const paths = generateProceduralRoads(hm, { count: 3, seed: 123, kinds: ['oval', 'figure8', 'rectangle'] });
    expect(paths.length).toBe(3);
    for (const path of paths) {
      expect(path.length).toBeGreaterThan(3);
      const first = path[0];
      const last = path[path.length - 1];
      expect(first.x).toBe(last.x);
      expect(first.z).toBe(last.z);
      for (const p of path) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(64);
        expect(p.z).toBeLessThan(64);
      }
    }
  });
});
