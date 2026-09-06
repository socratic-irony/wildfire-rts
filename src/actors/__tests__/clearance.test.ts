import { describe, expect, it } from 'vitest';
import { createVegetationClearance } from '../clearance';
import { createRoadMask } from '../../roads/state';
import type { Building } from '../../buildings/buildings';

describe('vegetation clearance', () => {
  it('reserves roads, oriented lots and driveway access without changing road fuel data', () => {
    const roads = createRoadMask(32, 24);
    roads.mask[8 * 32 + 8] = 1;
    const building: Building = {
      id: 1, kind: 'house', tile: { x: 8, z: 18 }, state: 'intact',
      orientation: Math.PI, footprint: { width: 3, depth: 3 }, variant: 0,
      driveway: { entrance: { x: 8, z: 16 }, road: { x: 8, z: 8 } },
    };
    const mask = createVegetationClearance(roads, [building]);
    expect(mask.data[8 * 32 + 11]).toBe(1);
    expect(mask.data[18 * 32 + 10]).toBe(1);
    expect(mask.data[12 * 32 + 8]).toBe(1);
    expect(mask.data[20 * 32 + 25]).toBe(0);
    expect(roads.mask.reduce((sum, cell) => sum + cell, 0)).toBe(1);
    expect(createVegetationClearance(createRoadMask(32, 24), []).data.every(value => value === 0)).toBe(true);
  });
});
