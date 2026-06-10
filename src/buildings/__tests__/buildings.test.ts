import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid, FireState, ignite } from '../../fire/grid';
import { createRoadMask, rasterizePolyline } from '../../roads/state';
import {
  generateBuildings,
  updateBuildingStates,
  reportStructures,
  computeStructureScore,
} from '../buildings';

function makeWorld(size = 64) {
  const hm = generateHeightmap(size, size, 1, {
    seed: 'flat',
    frequency: 0,
    amplitude: 0,
    octaves: 1,
    persistence: 1,
  });
  const biomes = computeBiomes(hm);
  const grid = buildFireGrid(hm, biomes, { cellSize: 1 });
  const roadMask = createRoadMask(size, size);
  // A straight road across the middle.
  rasterizePolyline(roadMask, [{ x: 8, z: 32 }, { x: 56, z: 32 }], 0.9);
  return { hm, grid, roadMask };
}

describe('generateBuildings', () => {
  it('is deterministic per seed', () => {
    const { hm, grid, roadMask } = makeWorld();
    const a = generateBuildings(hm, grid, roadMask, 'seed-1');
    const b = generateBuildings(hm, grid, roadMask, 'seed-1');
    const c = generateBuildings(hm, grid, roadMask, 'seed-2');
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c));
  });

  it('places clustered houses near the road and cabins far from it', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    const houses = buildings.filter((b) => b.kind !== 'cabin');
    const cabins = buildings.filter((b) => b.kind === 'cabin');
    expect(houses.length).toBeGreaterThan(0);
    expect(cabins.length).toBeGreaterThan(0);
    for (const h of houses) {
      // Near-road buildings sit within 8 tiles of the road row (z=32).
      expect(Math.abs(h.tile.z - 32)).toBeLessThanOrEqual(9);
    }
    for (const c of cabins) {
      expect(Math.abs(c.tile.z - 32)).toBeGreaterThanOrEqual(12);
    }
  });

  it('never places on road tiles and never overlaps', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    const seen = new Set<string>();
    for (const b of buildings) {
      const key = `${b.tile.x},${b.tile.z}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(roadMask.mask[b.tile.z * roadMask.width + b.tile.x]).toBe(0);
    }
  });
});

describe('updateBuildingStates', () => {
  it('intact → burning when the tile ignites, → destroyed when burned through', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    const b = buildings[0];

    ignite(grid, [b.tile], 0.9);
    updateBuildingStates(buildings, grid);
    expect(b.state).toBe('burning');

    grid.tiles[b.tile.z * grid.width + b.tile.x].state = FireState.Burned;
    updateBuildingStates(buildings, grid);
    expect(b.state).toBe('destroyed');

    // Destroyed latches even if the tile is reset.
    grid.tiles[b.tile.z * grid.width + b.tile.x].state = FireState.Unburned;
    updateBuildingStates(buildings, grid);
    expect(b.state).toBe('destroyed');
  });

  it('burning building recovers to intact if the fire is suppressed', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    const b = buildings[0];
    ignite(grid, [b.tile], 0.9);
    updateBuildingStates(buildings, grid);
    expect(b.state).toBe('burning');
    grid.tiles[b.tile.z * grid.width + b.tile.x].state = FireState.Unburned;
    updateBuildingStates(buildings, grid);
    expect(b.state).toBe('intact');
  });
});

describe('scoring', () => {
  it('rewards standing structures and penalizes losses', () => {
    const report = { total: 10, intact: 7, burning: 1, destroyed: 2 };
    expect(computeStructureScore(report)).toBe((7 + 1) * 10 - 2 * 25);
  });

  it('reportStructures counts states', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    buildings[0].state = 'destroyed';
    buildings[1].state = 'burning';
    const r = reportStructures(buildings);
    expect(r.total).toBe(buildings.length);
    expect(r.destroyed).toBe(1);
    expect(r.burning).toBe(1);
    expect(r.intact).toBe(buildings.length - 2);
  });
});
