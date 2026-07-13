import { describe, expect, it } from 'vitest';
import { worldToGridCell } from '../coordinates';

describe('worldToGridCell', () => {
  const unitHeightmap = { width: 10, height: 8, scale: 1 };

  it('clamps negative world coordinates to the first cell', () => {
    expect(worldToGridCell(unitHeightmap, -4, -0.6)).toEqual({ x: 0, z: 0 });
  });

  it('rounds interior world coordinates to the nearest cell', () => {
    expect(worldToGridCell(unitHeightmap, 3.49, 4.5)).toEqual({ x: 3, z: 5 });
  });

  it('clamps the upper edge and coordinates beyond the map', () => {
    expect(worldToGridCell(unitHeightmap, 9.6, 50)).toEqual({ x: 9, z: 7 });
  });

  it('converts world coordinates using a non-unit scale', () => {
    const scaledHeightmap = { width: 10, height: 8, scale: 2 };

    expect(worldToGridCell(scaledHeightmap, 6.9, 9)).toEqual({ x: 3, z: 5 });
  });
});
