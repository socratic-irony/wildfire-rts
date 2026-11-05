import { describe, expect, it } from 'vitest';
import { GRID_SIZE, NEIGHBOR_4, tileIndex } from './constants';
import { Heightmap } from './heightmap';
import { classifyTerrain } from './biomes';
import { generateRoadNetwork, planRoadPath, RoadNetwork } from './roads';

describe('RoadNetwork', () => {
  const seedMap = new Heightmap(12345);
  const roads = generateRoadNetwork(seedMap, 12345);
  const { town } = seedMap.layout;

  it('lays a town grid plus highways that reach the map edge', () => {
    expect(roads.count()).toBeGreaterThan(220);
    expect(roads.has(town.x, town.z)).toBe(true);
    let edgeTiles = 0;
    roads.forEach((tx, tz) => {
      if (Math.min(tx, tz, GRID_SIZE - 1 - tx, GRID_SIZE - 1 - tz) <= 2) edgeTiles += 1;
    });
    expect(edgeTiles).toBeGreaterThan(0);
  });

  it('keeps every generated road tile connected to the town', () => {
    roads.forEach((tx, tz) => {
      expect(roads.findPath({ x: town.x, z: town.z }, { x: tx, z: tz })).not.toBeNull();
    });
  });

  it('finds connected paths across the network', () => {
    const far = { x: town.x + 11, z: town.z + Math.round(town.rz * 0.8) };
    const path = roads.findPath({ x: town.x - town.rx - 1, z: town.z }, far);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(20);
    for (const point of path!) expect(roads.has(point.x, point.z)).toBe(true);
    for (let i = 1; i < path!.length; i += 1) {
      const prev = path![i - 1]!;
      const next = path![i]!;
      const adjacent = NEIGHBOR_4.some(([dx, dz]) => prev.x + dx === next.x && prev.z + dz === next.z);
      expect(adjacent).toBe(true);
    }
  });

  it('returns the nearest road tile within a search radius', () => {
    const nearest = roads.nearest(town.x + 2, town.z + 5, 8);
    expect(nearest).not.toBeNull();
    expect(nearest!.distance).toBeLessThanOrEqual(8);
    expect(roads.has(nearest!.x, nearest!.z)).toBe(true);
  });

  it('returns null when the goal is not on the road network', () => {
    const isolated = new RoadNetwork();
    isolated.set(10, 10, true);
    isolated.set(80, 80, true);
    expect(isolated.findPath({ x: 10, z: 10 }, { x: 80, z: 80 })).toBeNull();
  });
});

describe('planRoadPath', () => {
  const map = new Heightmap(888);
  const biomes = classifyTerrain(map);

  it('plans a land route between two town points', () => {
    const path = planRoadPath(map, biomes, { x: 40, z: 37 }, { x: 54, z: 53 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(10);
    for (const point of path!) {
      expect(biomes.types[tileIndex(point.x, point.z)]).not.toBe(0);
    }
  });

  it('refuses a route whose start or goal is blocked', () => {
    const blocked = new Uint8Array(GRID_SIZE * GRID_SIZE);
    blocked[tileIndex(54, 53)] = 1;
    expect(planRoadPath(map, biomes, { x: 40, z: 37 }, { x: 54, z: 53 }, blocked)).toBeNull();
    const empty = new RoadNetwork();
    expect(empty.findPath({ x: 1, z: 1 }, { x: 2, z: 2 })).toBeNull();
  });

  it('routes around a blocked corridor', () => {
    const blocked = new Uint8Array(GRID_SIZE * GRID_SIZE);
    blocked[tileIndex(47, 40)] = 1;
    const path = planRoadPath(map, biomes, { x: 47, z: 45 }, { x: 47, z: 35 }, blocked);
    expect(path).not.toBeNull();
    expect(path!.some((point) => point.x === 47 && point.z === 40)).toBe(false);
  });

  it('never routes a road through the lake', () => {
    let lake: { x: number; z: number } | null = null;
    for (let z = 0; z < GRID_SIZE && !lake; z += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (map.isWater(x, z)) {
          lake = { x, z };
          break;
        }
      }
    }
    expect(lake).not.toBeNull();
    expect(planRoadPath(map, biomes, { x: 40, z: 37 }, lake!)).toBeNull();
  });
  it('reports road connectivity consistently with path finding, and updates after edits', () => {
    const network = new RoadNetwork();
    network.addLine({ x: 10, z: 10 }, { x: 20, z: 10 });
    network.addLine({ x: 30, z: 30 }, { x: 30, z: 40 });
    expect(network.connected({ x: 10, z: 10 }, { x: 20, z: 10 })).toBe(true);
    expect(network.connected({ x: 10, z: 10 }, { x: 30, z: 35 })).toBe(false);
    expect(network.findPath({ x: 10, z: 10 }, { x: 30, z: 35 })).toBeNull();
    network.addLine({ x: 20, z: 10 }, { x: 30, z: 10 });
    network.addLine({ x: 30, z: 10 }, { x: 30, z: 30 });
    expect(network.connected({ x: 10, z: 10 }, { x: 30, z: 35 })).toBe(true);
    expect(network.findPath({ x: 10, z: 10 }, { x: 30, z: 35 })).not.toBeNull();
  });
});
