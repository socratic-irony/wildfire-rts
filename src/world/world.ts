import { Group } from 'three';
import { GRID_SIZE, TILE_SIZE, WORLD_SIZE, tileIndex, tileToWorld } from './constants';
import { Heightmap } from './heightmap';
import { BiomeMap, Terrain, classifyTerrain, terrainName } from './biomes';
import { RoadNetwork, createInitialRoads, planRoadPath } from './roads';
import { RoadVisual } from './roadsVisual';
import { BuildingSystem, HELIPAD_CENTER } from './buildings';
import { VegetationSystem } from './vegetation';
import { HydrantSystem } from './hydrants';
import { TerrainVisual } from './terrainVisual';

export interface WorldTileInfo {
  tx: number;
  tz: number;
  height: number;
  slope: number;
  terrain: string;
  road: boolean;
  building: string | null;
}

export class World {
  readonly group = new Group();
  readonly heightmap: Heightmap;
  readonly biomes: BiomeMap;
  readonly roads: RoadNetwork;
  readonly roadVisual = new RoadVisual();
  readonly buildings: BuildingSystem;
  readonly hydrants: HydrantSystem;
  readonly terrain: TerrainVisual;
  vegetation: VegetationSystem;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.group.name = 'world';
    this.heightmap = new Heightmap(this.seed);
    this.biomes = classifyTerrain(this.heightmap);
    this.roads = createInitialRoads();
    this.roadVisual.rebuild(this.roads, this.heightmap, this.seed);
    this.buildings = new BuildingSystem(this.heightmap, this.biomes, this.roads, this.seed);
    this.terrain = new TerrainVisual(this.heightmap, this.biomes);
    this.hydrants = new HydrantSystem(this.heightmap, this.roads);
    this.vegetation = new VegetationSystem(
      this.heightmap,
      this.biomes,
      this.roads,
      this.buildings,
      this.seed,
    );
    this.group.add(
      this.terrain.group,
      this.roadVisual.group,
      this.buildings.group,
      this.hydrants.group,
      this.vegetation.group,
    );
  }

  get worldCenter(): { x: number; z: number } {
    return { x: WORLD_SIZE / 2, z: WORLD_SIZE / 2 };
  }

  get airbase(): { x: number; z: number; height: number } {
    const pos = tileToWorld(HELIPAD_CENTER.x, HELIPAD_CENTER.z);
    return { x: pos.x, z: pos.z, height: this.heightmap.heightAt(pos.x, pos.z) + 7.5 };
  }

  get stationRoad(): { x: number; z: number; wx: number; wz: number } {
    const front = this.buildings.station;
    const roadX = front.x0 + Math.floor(front.worldW / 2);
    const roadZ = front.z0 - 1;
    const wx = (roadX + 0.5) * TILE_SIZE;
    const wz = (roadZ + 0.5) * TILE_SIZE;
    return { x: roadX, z: roadZ, wx, wz };
  }

  tileInfo(tx: number, tz: number): WorldTileInfo {
    const index = tileIndex(tx, tz);
    const building = this.buildings.buildingAt(tx, tz);
    return {
      tx,
      tz,
      height: this.heightmap.tileHeight(tx, tz),
      slope: this.heightmap.slopeTan(tx, tz),
      terrain: terrainName(this.biomes.types[index] ?? Terrain.Grass),
      road: this.roads.has(tx, tz),
      building: building ? building.kind : null,
    };
  }

  buildRoad(start: { x: number; z: number }, goal: { x: number; z: number }): { x: number; z: number }[] | null {
    const blocked = this.blockedMask();
    const path = planRoadPath(this.heightmap, this.biomes, start, goal, blocked);
    if (!path || path.length < 2) return null;
    this.roads.addPath(path);
    this.roadVisual.rebuild(this.roads, this.heightmap, this.seed);
    this.hydrants.rebuild(this.roads);
    this.rebuildVegetation();
    return path;
  }

  isReservedForRoad(tx: number, tz: number): boolean {
    const index = tileIndex(tx, tz);
    return this.buildings.occupied[index] === 1 && this.roads.mask[index] !== 1;
  }

  findOffroadPath(
    start: { x: number; z: number },
    goal: { x: number; z: number },
  ): { x: number; z: number }[] | null {
    const blocked = this.blockedMask();
    const startIndex = tileIndex(start.x, start.z);
    const goalIndex = tileIndex(goal.x, goal.z);
    blocked[startIndex] = 0;
    blocked[goalIndex] = 0;
    return planRoadPath(this.heightmap, this.biomes, start, goal, blocked);
  }

  private blockedMask(): Uint8Array {
    const blocked = new Uint8Array(GRID_SIZE * GRID_SIZE);
    for (let i = 0; i < blocked.length; i += 1) {
      if (this.buildings.occupied[i] && this.roads.mask[i] !== 1) blocked[i] = 1;
    }
    return blocked;
  }

  rebuildVegetation(): void {
    this.group.remove(this.vegetation.group);
    this.vegetation.dispose();
    this.vegetation = new VegetationSystem(
      this.heightmap,
      this.biomes,
      this.roads,
      this.buildings,
      this.seed,
    );
    this.group.add(this.vegetation.group);
  }

  dispose(): void {
    this.vegetation.dispose();
    this.terrain.dispose();
    this.roadVisual.disposeMeshes();
    this.hydrants.dispose();
  }
}
