import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from './constants';
import { Heightmap } from './heightmap';
import { generateRoadNetwork } from './roads';

const SEEDS = [1, 42, 909, 4242, 12345, 987654321];

function expectSlopeLimited(map: Heightmap): void {
  for (let z = 0; z <= GRID_SIZE; z += 1) {
    for (let x = 0; x <= GRID_SIZE; x += 1) {
      const level = map.levelAtVertex(x, z);
      if (x < GRID_SIZE) expect(Math.abs(level - map.levelAtVertex(x + 1, z))).toBeLessThanOrEqual(1);
      if (z < GRID_SIZE) expect(Math.abs(level - map.levelAtVertex(x, z + 1))).toBeLessThanOrEqual(1);
    }
  }
}

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

  it('limits every cardinal step to one terrace level on every seed', () => {
    for (const seed of SEEDS) expectSlopeLimited(new Heightmap(seed));
  });

  it('places the town somewhere different per seed and keeps its core level', () => {
    const towns = new Set<string>();
    for (const seed of SEEDS) {
      const m = new Heightmap(seed);
      const { town } = m.layout;
      towns.add(`${town.x},${town.z}`);
      expect(town.x - town.rx).toBeGreaterThanOrEqual(4);
      expect(town.x + town.rx).toBeLessThanOrEqual(GRID_SIZE - 4);
      for (const [dx, dz] of [[0, 0], [-5, 0], [5, 0], [0, -4], [0, 4], [3, 3]]) {
        expect(m.levelAtVertex(town.x + dx!, town.z + dz!)).toBe(town.level);
      }
    }
    expect(towns.size).toBeGreaterThan(2);
  });

  it('carves a lake away from town and flags it for water lookups', () => {
    for (const seed of SEEDS) {
      const m = new Heightmap(seed);
      let waterTiles = 0;
      for (let z = 0; z < GRID_SIZE; z += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
          if (!m.isWater(x, z)) continue;
          waterTiles += 1;
          expect(Math.max(...m.cornerHeights(x, z))).toBe(0);
          expect(m.isTownVertex(x, z)).toBe(false);
        }
      }
      expect(waterTiles).toBeGreaterThan(20);
    }
  });

  it('samples the same triangles the terrain mesh renders', () => {
    for (let z = 0; z < GRID_SIZE; z += 7) {
      for (let x = 0; x < GRID_SIZE; x += 5) {
        const [h00, h10, h01, h11] = map.cornerHeights(x, z);
        const s = map.tileSize;
        expect(map.heightAt(x * s, z * s)).toBeCloseTo(h00, 5);
        expect(map.heightAt((x + 1) * s - 1e-6, z * s)).toBeCloseTo(h10, 3);
        expect(map.heightAt(x * s, (z + 1) * s - 1e-6)).toBeCloseTo(h01, 3);
        // Upper-left triangle midpoint lies on the plane through h00, h10, h01.
        expect(map.heightAt((x + 0.25) * s, (z + 0.25) * s)).toBeCloseTo(h00 + (h10 - h00) * 0.25 + (h01 - h00) * 0.25, 5);
        expect(map.heightAt((x + 0.75) * s, (z + 0.75) * s)).toBeCloseTo(h11 + (h01 - h11) * 0.25 + (h10 - h11) * 0.25, 5);
      }
    }
  });

  it('grades road tiles into level pads and straight ramps', () => {
    for (const seed of SEEDS) {
      const m = new Heightmap(seed);
      const roads = generateRoadNetwork(m, seed);
      m.gradeForRoads(roads.mask);
      expectSlopeLimited(m);
      roads.forEach((tx, tz) => {
        const mask = roads.connectionMask(tx, tz);
        const [h00, h10, h01, h11] = m.cornerHeights(tx, tz);
        if (mask === (2 | 8)) {
          expect(h00).toBe(h01);
          expect(h10).toBe(h11);
        } else if (mask === (1 | 4)) {
          expect(h00).toBe(h10);
          expect(h01).toBe(h11);
        } else {
          expect(new Set([h00, h10, h01, h11]).size).toBe(1);
        }
      });
    }
  });
});
