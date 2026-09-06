import { describe, it, expect } from 'vitest';
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
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
import { BuildingsVisual, buildingDrivewayPath } from '../visual';

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

function makeBuilding(kind: 'house' | 'barn' | 'cabin', variant = 0, tile = { x: 20, z: 20 }) {
  return {
    id: variant + 1,
    kind,
    tile,
    footprint: kind === 'barn' ? { width: 5, depth: 3 } : { width: 3, depth: 3 },
    orientation: Math.PI,
    variant,
    driveway: { entrance: { x: tile.x, z: tile.z - 2 }, road: { x: tile.x, z: tile.z - 4 } },
    state: 'intact' as const,
  };
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

  it('keeps grid footprints centered on the rendered rectangular envelopes', () => {
    for (const kind of ['house', 'barn', 'cabin'] as const) {
      const building = makeBuilding(kind);
      const cells = buildingFootprintCells(building);
      const xs = cells.map((cell) => cell.x);
      const zs = cells.map((cell) => cell.z);
      expect(Math.min(...xs) + Math.max(...xs)).toBe(building.tile.x * 2);
      expect(Math.min(...zs) + Math.max(...zs)).toBe(building.tile.z * 2);
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

  it('uses white instanced bases and scales vertical offsets with tile size', () => {
    const hm = generateHeightmap(32, 32, 2, {
      seed: 'flat-scale-2',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const visual = new BuildingsVisual(hm);
    visual.update([makeBuilding('house')]);
    const walls = visual.group.children.find((child) => child.name === 'houseWalls') as InstancedMesh;
    const material = walls.material as unknown as { color: { getHex: () => number } };
    const matrix = new Matrix4();
    walls.getMatrixAt(0, matrix);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(matrix.elements[13]).toBeCloseTo(0.78, 5);
    visual.dispose();
  });

  it('keeps porch instances dense across mixed kinds and rebuilds', () => {
    const { hm } = makeWorld();
    const visual = new BuildingsVisual(hm);
    visual.update([makeBuilding('barn'), makeBuilding('house', 1, { x: 30, z: 20 })]);
    const porch = visual.group.children.find((child) => child.name === 'buildingPorches') as InstancedMesh;
    expect(porch.count).toBe(1);
    visual.update([makeBuilding('house')]);
    expect(porch.count).toBe(1);
    visual.dispose();
  });

  it('uses roof geometries that cover the full wall footprint', () => {
    const { hm } = makeWorld();
    const visual = new BuildingsVisual(hm);
    for (const name of ['houseRoofs', 'houseGableRoofs', 'barnRoofs', 'cabinRoofs']) {
      const mesh = visual.group.children.find((child) => child.name === name) as InstancedMesh;
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox?.min.x).toBeLessThanOrEqual(-0.5);
      expect(mesh.geometry.boundingBox?.max.x).toBeGreaterThanOrEqual(0.5);
      expect(mesh.geometry.boundingBox?.min.z).toBeLessThanOrEqual(-0.5);
      expect(mesh.geometry.boundingBox?.max.z).toBeGreaterThanOrEqual(0.5);
      expectRoofTrianglesFaceOutward(mesh);
    }
    visual.dispose();
  });

  it('seats every transformed roof directly on its wall top', () => {
    const { hm } = makeWorld();
    const visual = new BuildingsVisual(hm);
    visual.update([makeBuilding('house', 0), makeBuilding('house', 1, { x: 30, z: 20 })]);
    const walls = visual.group.children.find((child) => child.name === 'houseWalls') as InstancedMesh;
    const hip = visual.group.children.find((child) => child.name === 'houseRoofs') as InstancedMesh;
    const gable = visual.group.children.find((child) => child.name === 'houseGableRoofs') as InstancedMesh;
    expect(instanceYBounds(hip, 0).min).toBeCloseTo(instanceYBounds(walls, 0).max, 5);
    expect(instanceYBounds(gable, 0).min).toBeCloseTo(instanceYBounds(walls, 1).max, 5);
    visual.dispose();
  });

  it('builds a terrain-hugging driveway from the porch front to the road', () => {
    const { hm } = makeWorld();
    const building = makeBuilding('house');
    const path = buildingDrivewayPath(hm, building);
    expect(path.length).toBeGreaterThan(1);
    const expectedStart = (building.footprint.depth * 0.82) / 2 + 0.05 + 0.18;
    expect(path[0].x).toBeCloseTo(building.tile.x + 0.5, 5);
    expect(path[0].z).toBeCloseTo(building.tile.z + 0.5 - expectedStart, 5);
    expect(path[path.length - 1].x).toBeCloseTo(building.driveway.road!.x + 0.5, 5);
    expect(path[path.length - 1].z).toBeCloseTo(building.driveway.road!.z + 0.5, 5);
    for (let i = 0; i < path.length - 1; i++) {
      expect(Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z)).toBeGreaterThan(0);
      expect(path[i].y).toBeCloseTo(hm.sample(path[i].x, path[i].z) + 0.025, 5);
    }
  });
});

function instanceYBounds(mesh: InstancedMesh, index: number): { min: number; max: number } {
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  mesh.geometry.computeBoundingBox();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, rotation, scale);
  return {
    min: position.y + (mesh.geometry.boundingBox?.min.y ?? 0) * scale.y,
    max: position.y + (mesh.geometry.boundingBox?.max.y ?? 0) * scale.y,
  };
}

function expectRoofTrianglesFaceOutward(mesh: InstancedMesh): void {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  expect(index).not.toBeNull();
  if (!index) return;
  const center = new Vector3(0, 0.3, 0);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const normal = new Vector3();
  const centroid = new Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    edgeA.subVectors(b, a);
    edgeB.subVectors(c, a);
    normal.crossVectors(edgeA, edgeB);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    expect(normal.dot(centroid.clone().sub(center))).toBeGreaterThan(0);
  }
}
