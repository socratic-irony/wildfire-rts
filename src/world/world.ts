import { Group } from 'three';
import { GRID_SIZE, TILE_SIZE, WORLD_SIZE, tileIndex, tileToWorld } from './constants';
import { Heightmap } from './heightmap';
import { BiomeMap, Terrain, classifyTerrain, terrainName } from './biomes';
import { RoadNetwork, generateRoadNetwork, planRoadPath } from './roads';
import { RoadVisual } from './roadsVisual';
import { BuildingSystem, helipadCenter } from './buildings';
import { VegetationSystem } from './vegetation';
import { HydrantSystem } from './hydrants';
import { TerrainVisual } from './terrainVisual';
import { sectorNameFor } from './sectors';

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
    this.roads = generateRoadNetwork(this.heightmap, this.seed);
    this.heightmap.gradeForRoads(this.roads.mask);
    this.biomes = classifyTerrain(this.heightmap);
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
    const pad = helipadCenter(this.heightmap);
    const pos = tileToWorld(pad.x, pad.z);
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

  /** Human-readable sector name for a tile, relative to this map's town. */
  sectorName(tx: number, tz: number): string {
    return sectorNameFor(tx, tz, this.heightmap.layout.town);
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

  /**
   * Plan and lay a player road. Tiles flagged in `avoid` (e.g. active fire)
   * are treated as impassable. The terrain under the new road is graded into
   * clean ramps; building footprints are pinned so structures never move.
   * Returns the laid path, or null if no route exists.
   */
  buildRoad(
    start: { x: number; z: number },
    goal: { x: number; z: number },
    avoid?: Uint8Array,
  ): { x: number; z: number }[] | null {
    const blocked = this.blockedMask();
    if (avoid) for (let i = 0; i < blocked.length; i += 1) if (avoid[i] === 1) blocked[i] = 1;
    const path = planRoadPath(this.heightmap, this.biomes, start, goal, blocked);
    if (!path || path.length < 2) return null;
    this.roads.addPath(path);
    if (this.heightmap.gradeForRoads(this.roads.mask, this.pinnedVertices())) {
      for (let tz = 0; tz < GRID_SIZE; tz += 1) {
        for (let tx = 0; tx < GRID_SIZE; tx += 1) {
          this.biomes.slope[tileIndex(tx, tz)] = this.heightmap.slopeTan(tx, tz);
        }
      }
      this.terrain.rebuild();
      this.terrainRevision += 1;
    }
    this.roadVisual.rebuild(this.roads, this.heightmap, this.seed);
    this.hydrants.rebuild(this.roads);
    this.buildings.rebuildPoles();
    this.rebuildVegetation();
    return path;
  }

  /** Bumped whenever the terrain mesh is regraded; listeners re-read slopes. */
  terrainRevision = 0;

  /** Vertices under structures and the helipad, which grading must not move. */
  private pinnedVertices(): Uint8Array {
    const stride = GRID_SIZE + 1;
    const pinned = new Uint8Array(stride * stride);
    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        if (!this.buildings.occupied[index] || this.roads.mask[index] === 1) continue;
        const v = tz * stride + tx;
        pinned[v] = 1;
        pinned[v + 1] = 1;
        pinned[v + stride] = 1;
        pinned[v + stride + 1] = 1;
      }
    }
    return pinned;
  }

  isReservedForRoad(tx: number, tz: number): boolean {
    const index = tileIndex(tx, tz);
    return this.buildings.occupied[index] === 1 && this.roads.mask[index] !== 1;
  }

  findOffroadPath(
    start: { x: number; z: number },
    goal: { x: number; z: number },
    avoid?: Uint8Array,
  ): { x: number; z: number }[] | null {
    const blocked = this.blockedMask();
    if (avoid) for (let i = 0; i < blocked.length; i += 1) if (avoid[i] === 1) blocked[i] = 1;
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
