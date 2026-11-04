import { describe, expect, it } from 'vitest';
import { Heightmap } from './heightmap';
import { generateRoadNetwork } from './roads';
import { HydrantSystem } from './hydrants';
import { tileIndex } from './constants';

describe('HydrantSystem', () => {
  const map = new Heightmap(909);
  const roads = generateRoadNetwork(map, 909);
  const hydrants = new HydrantSystem(map, roads);

  it('places spaced hydrants along the road network', () => {
    expect(hydrants.count).toBeGreaterThan(20);
    for (let i = 0; i < hydrants.hydrants.length; i += 1) {
      const a = hydrants.hydrants[i]!;
      expect(roads.has(a.tileX, a.tileZ)).toBe(true);
      for (let j = i + 1; j < hydrants.hydrants.length; j += 1) {
        const b = hydrants.hydrants[j]!;
        expect(Math.hypot(a.tileX - b.tileX, a.tileZ - b.tileZ)).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('finds nearby active sources and rejects distant ones', () => {
    const source = hydrants.hydrants[0]!;
    expect(hydrants.findNearest(source.x, source.z, 3)).not.toBeNull();
    expect(hydrants.isNear(source.x, source.z, 4.2)).toBe(true);
    expect(hydrants.findNearest(source.x + 1000, source.z + 1000, 5)).toBeNull();
  });

  it('repairs placement when the road network changes', () => {
    const before = hydrants.count;
    for (let x = 10; x < 30; x += 1) roads.set(x, 3, true);
    hydrants.rebuild(roads);
    expect(hydrants.count).toBeGreaterThan(before);
    for (const hydrant of hydrants.hydrants) {
      expect(roads.mask[tileIndex(hydrant.tileX, hydrant.tileZ)]).toBe(1);
    }
  });
});
