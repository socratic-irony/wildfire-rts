import { describe, it, expect } from 'vitest';
import type { InstancedMesh } from 'three';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid, FireState, ignite } from '../../fire/grid';
import { createRoadMask, rasterizePolyline } from '../../roads/state';
import {
  generateBuildings,
  buildingFootprintCells,
  updateBuildingStates,
  reportStructures,
  computeStructureScore,
} from '../buildings';
import { BuildingsVisual } from '../visual';

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

  it('builds separated road-facing lots with direct driveway access', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    const nearRoad = buildings.filter((b) => b.kind !== 'cabin');
    expect(nearRoad.length).toBeGreaterThan(0);

    const occupied = new Set<string>();
    for (const building of nearRoad) {
      const footprint = buildingFootprintCells(building);
      expect(footprint.length).toBeGreaterThan(1);
      for (const cell of footprint) {
        const key = `${cell.x},${cell.z}`;
        expect(occupied.has(key)).toBe(false);
        occupied.add(key);
        expect(isRoadCell(roadMask, cell.x, cell.z)).toBe(false);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            expect(isRoadCell(roadMask, cell.x + dx, cell.z + dz)).toBe(false);
          }
        }
      }

      const road = building.driveway.road;
      expect(road).not.toBeNull();
      if (!road) continue;
      expect(isRoadCell(roadMask, road.x, road.z)).toBe(true);
      const toRoad = {
        x: road.x - building.tile.x,
        z: road.z - building.tile.z,
      };
      const facing = { x: Math.sin(building.orientation), z: Math.cos(building.orientation) };
      expect(toRoad.x * facing.x + toRoad.z * facing.z).toBeGreaterThan(0);
    }
  });
});

function isRoadCell(roadMask: ReturnType<typeof createRoadMask>, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < roadMask.width && z < roadMask.height && roadMask.mask[z * roadMask.width + x] === 1;
}

describe('updateBuildingStates', () => {
  it('intact → burning when the tile ignites, → destroyed when burned through', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    const b = buildings[0];

    ignite(grid, [b.tile], 0.9);
    updateBuildingStates(buildings, grid);
    expect(b.state).toBe('burning');

    grid.state[b.tile.z * grid.width + b.tile.x] = FireState.Burned;
    updateBuildingStates(buildings, grid);
    expect(b.state).toBe('destroyed');

    // Destroyed latches even if the tile is reset.
    grid.state[b.tile.z * grid.width + b.tile.x] = FireState.Unburned;
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
    grid.state[b.tile.z * grid.width + b.tile.x] = FireState.Unburned;
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

describe('BuildingsVisual', () => {
  it('keeps distinct instanced silhouettes and frontage details', () => {
    const { hm, grid, roadMask } = makeWorld();
    const buildings = generateBuildings(hm, grid, roadMask, 'seed-1');
    const visual = new BuildingsVisual(hm);
    visual.update(buildings);

    const names = visual.group.children.map((child) => child.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'houseWalls',
        'barnWalls',
        'cabinWalls',
        'houseRoofs',
        'barnRoofs',
        'cabinRoofs',
        'buildingDoors',
        'buildingWindows',
        'buildingPorches',
        'buildingChimneys',
        'buildingDriveways',
      ]),
    );
    const children = new Map(visual.group.children.map((child) => [child.name, child]));
    expect((children.get('houseWalls') as InstancedMesh).geometry).not.toBe((children.get('barnWalls') as InstancedMesh).geometry);
    expect((children.get('barnWalls') as InstancedMesh).geometry).not.toBe((children.get('cabinWalls') as InstancedMesh).geometry);
    expect((children.get('buildingDoors') as unknown as InstancedMesh).count).toBeGreaterThan(0);
    expect((children.get('buildingWindows') as unknown as InstancedMesh).count).toBeGreaterThan(0);
    expect((children.get('buildingDriveways') as unknown as InstancedMesh).count).toBeGreaterThan(0);
    visual.dispose();
  });
});
