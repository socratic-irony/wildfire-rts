import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from './constants';
import { Heightmap, TOWN_CENTER, TOWN_LEVEL } from './heightmap';

describe('Heightmap', () => {
  const map = new Heightmap(12345);

  it('generates a complete, bounded height field', () => {
    expect(map.levels.length).toBe((GRID_SIZE + 1) * (GRID_SIZE + 1));
    for (const level of map.levels) {
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(12);
    }
    expect(Number.isFinite(map.heightAt(0, 0))).toBe(true);
    expect(Number.isFinite(map.heightAt(191.9, 191.9))).toBe(true);
  });

  it('limits every cardinal step to one terrace level', () => {
    for (let z = 0; z <= GRID_SIZE; z += 1) {
      for (let x = 0; x <= GRID_SIZE; x += 1) {
        const level = map.levelAtVertex(x, z);
        if (x < GRID_SIZE) expect(Math.abs(level - map.levelAtVertex(x + 1, z))).toBeLessThanOrEqual(1);
        if (z < GRID_SIZE) expect(Math.abs(level - map.levelAtVertex(x, z + 1))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the town core flat and level', () => {
    expect(map.levelAtVertex(TOWN_CENTER.x, TOWN_CENTER.z)).toBe(TOWN_LEVEL);
    const points = [
      [TOWN_CENTER.x - 5, TOWN_CENTER.z],
      [TOWN_CENTER.x + 5, TOWN_CENTER.z],
      [TOWN_CENTER.x, TOWN_CENTER.z - 4],
      [TOWN_CENTER.x, TOWN_CENTER.z + 4],
      [TOWN_CENTER.x + 3, TOWN_CENTER.z + 3],
    ];
    for (const [x, z] of points) {
      expect(map.levelAtVertex(x as number, z as number)).toBe(TOWN_LEVEL);
    }
  });

  it('carves a lake and flags it for water lookups', () => {
    let waterTiles = 0;
    for (let z = 0; z < GRID_SIZE; z += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (!map.isWater(x, z)) continue;
        waterTiles += 1;
        const [a, b, c, d] = map.cornerHeights(x, z);
        expect(Math.max(a, b, c, d)).toBe(0);
      }
    }
    expect(waterTiles).toBeGreaterThan(20);
  });

  it('interpolates between vertex heights', () => {
    const x = 10;
    const z = 10;
    const h00 = map.vertexHeight(x, z);
    const h10 = map.vertexHeight(x + 1, z);
    const midpoint = map.heightAt((x + 0.5) * map.tileSize, (z + 0.5) * map.tileSize);
    expect(midpoint).toBeCloseTo((h00 + h10 + map.vertexHeight(x, z + 1) + map.vertexHeight(x + 1, z + 1)) / 4, 5);
  });
});
