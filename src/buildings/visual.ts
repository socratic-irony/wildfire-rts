import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { Building, BuildingKind } from './buildings';

const MAX_BUILDINGS = 128;
const MAX_WINDOWS = MAX_BUILDINGS * 2;

const WALL_COLORS: Record<BuildingKind, number[]> = {
  house: [0xe8e0d0, 0xd9c9a8, 0xc9d4dd],
  barn: [0xa83232, 0x9c4a3a, 0x7e302c],
  cabin: [0x7a5a3a, 0x6b4e30, 0x8c6542],
};
const ROOF_COLORS: Record<BuildingKind, number> = {
  house: 0x8a4f3d,
  barn: 0x5a4632,
  cabin: 0x4f3a26,
};
const DETAIL_COLORS: Record<BuildingKind, number> = {
  house: 0x453a34,
  barn: 0x30251f,
  cabin: 0x33251c,
};
const WINDOW_COLOR = 0x9fc8d1;
const DRIVEWAY_COLOR = 0x8d8171;
const BURNING_TINT = 0xff7733;
const DESTROYED_TINT = 0x221d1a;

type BuildingMesh = InstancedMesh;

function material(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.02,
    vertexColors: true,
  });
}

function createMesh(name: string, geometry: BoxGeometry | ConeGeometry, color: number, count: number): BuildingMesh {
  const mesh = new InstancedMesh(geometry, material(color), count);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Instanced low-poly building renderer. Separate batches preserve the cheap
 * one-draw-per-part approach while allowing houses, barns and cabins to have
 * different silhouettes. Doors, windows, porches, chimneys and driveways are
 * all placed from the same footprint/orientation data as the generator.
 */
export class BuildingsVisual {
  group = new Group();
  private hm: Heightmap;
  private houseWalls: BuildingMesh;
  private barnWalls: BuildingMesh;
  private cabinWalls: BuildingMesh;
  private houseRoofs: BuildingMesh;
  private barnRoofs: BuildingMesh;
  private cabinRoofs: BuildingMesh;
  private doors: BuildingMesh;
  private windows: BuildingMesh;
  private porches: BuildingMesh;
  private chimneys: BuildingMesh;
  private driveways: BuildingMesh;
  private meshes: BuildingMesh[];
  private tmpM = new Matrix4();
  private tmpP = new Vector3();
  private tmpQ = new Quaternion();
  private tmpS = new Vector3();
  private tmpC = new Color();

  constructor(hm: Heightmap) {
    this.hm = hm;
    this.houseWalls = createMesh('houseWalls', new BoxGeometry(1, 1, 1), WALL_COLORS.house[0], MAX_BUILDINGS);
    this.barnWalls = createMesh('barnWalls', new BoxGeometry(1, 1, 1), WALL_COLORS.barn[0], MAX_BUILDINGS);
    this.cabinWalls = createMesh('cabinWalls', new BoxGeometry(1, 1, 1), WALL_COLORS.cabin[0], MAX_BUILDINGS);
    this.houseRoofs = createMesh('houseRoofs', new ConeGeometry(0.5, 1, 4), ROOF_COLORS.house, MAX_BUILDINGS);
    this.barnRoofs = createMesh('barnRoofs', new ConeGeometry(0.5, 1, 3), ROOF_COLORS.barn, MAX_BUILDINGS);
    this.cabinRoofs = createMesh('cabinRoofs', new ConeGeometry(0.5, 1, 4), ROOF_COLORS.cabin, MAX_BUILDINGS);
    this.doors = createMesh('buildingDoors', new BoxGeometry(1, 1, 1), DETAIL_COLORS.house, MAX_BUILDINGS);
    this.windows = createMesh('buildingWindows', new BoxGeometry(1, 1, 1), WINDOW_COLOR, MAX_WINDOWS);
    this.porches = createMesh('buildingPorches', new BoxGeometry(1, 1, 1), DETAIL_COLORS.house, MAX_BUILDINGS);
    this.chimneys = createMesh('buildingChimneys', new BoxGeometry(1, 1, 1), DETAIL_COLORS.house, MAX_BUILDINGS);
    this.driveways = createMesh('buildingDriveways', new BoxGeometry(1, 1, 1), DRIVEWAY_COLOR, MAX_BUILDINGS);
    this.meshes = [
      this.houseWalls,
      this.barnWalls,
      this.cabinWalls,
      this.houseRoofs,
      this.barnRoofs,
      this.cabinRoofs,
      this.doors,
      this.windows,
      this.porches,
      this.chimneys,
      this.driveways,
    ];
    this.group.add(...this.meshes);
    this.group.name = 'buildings';
  }

  private wallMesh(kind: BuildingKind): BuildingMesh {
    if (kind === 'house') return this.houseWalls;
    if (kind === 'barn') return this.barnWalls;
    return this.cabinWalls;
  }

  private roofMesh(kind: BuildingKind): BuildingMesh {
    if (kind === 'house') return this.houseRoofs;
    if (kind === 'barn') return this.barnRoofs;
    return this.cabinRoofs;
  }

  private setColor(mesh: BuildingMesh, index: number, color: number): void {
    mesh.setColorAt(index, this.tmpC.set(color));
  }

  private buildingColor(building: Building, base: number): number {
    if (building.state === 'burning') return BURNING_TINT;
    if (building.state === 'destroyed') return DESTROYED_TINT;
    return base;
  }

  private transform(
    mesh: BuildingMesh,
    index: number,
    building: Building,
    localX: number,
    localY: number,
    localZ: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    y: number,
    yaw = building.orientation,
  ): void {
    const s = this.hm.scale;
    const worldX = (building.tile.x + 0.5) * s;
    const worldZ = (building.tile.z + 0.5) * s;
    this.tmpQ.setFromAxisAngle(this.tmpP.set(0, 1, 0), yaw);
    this.tmpP.set(localX * s, localY, localZ * s).applyQuaternion(this.tmpQ);
    this.tmpP.x += worldX;
    this.tmpP.y += y;
    this.tmpP.z += worldZ;
    this.tmpS.set(scaleX * s, scaleY * s, scaleZ * s);
    this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
    mesh.setMatrixAt(index, this.tmpM);
  }

  private transformWorld(
    mesh: BuildingMesh,
    index: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    yaw: number,
  ): void {
    const s = this.hm.scale;
    this.tmpQ.setFromAxisAngle(this.tmpP.set(0, 1, 0), yaw);
    this.tmpP.set(worldX, worldY, worldZ);
    this.tmpS.set(scaleX * s, scaleY * s, scaleZ * s);
    this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
    mesh.setMatrixAt(index, this.tmpM);
  }

  /** Rebuild all instance transforms and per-instance colors from the building list. */
  update(buildings: ReadonlyArray<Building>): void {
    const counts = new Map<BuildingKind, number>([
      ['house', 0],
      ['barn', 0],
      ['cabin', 0],
    ]);
    let buildingIndex = 0;
    let windowIndex = 0;
    let drivewayIndex = 0;
    for (const building of buildings) {
      if (buildingIndex >= MAX_BUILDINGS || drivewayIndex >= MAX_BUILDINGS) break;
      const kindIndex = Math.min(MAX_BUILDINGS - 1, counts.get(building.kind) ?? 0);
      counts.set(building.kind, kindIndex + 1);
      const s = this.hm.scale;
      const baseY = this.hm.sample((building.tile.x + 0.5) * s, (building.tile.z + 0.5) * s);
      const width = building.footprint.width * 0.82;
      const depth = building.footprint.depth * 0.82;
      const isDestroyed = building.state === 'destroyed';
      const wallHeight = isDestroyed ? 0.24 : building.kind === 'barn' ? 0.68 : building.kind === 'cabin' ? 0.62 : 0.78;
      const roofHeight = building.kind === 'barn' ? 0.72 : building.kind === 'cabin' ? 0.55 : 0.62;
      const wall = this.wallMesh(building.kind);
      const roof = this.roofMesh(building.kind);
      this.transform(wall, kindIndex, building, 0, wallHeight / 2, 0, width, wallHeight, depth, baseY);
      this.setColor(wall, kindIndex, this.buildingColor(building, WALL_COLORS[building.kind][building.variant % WALL_COLORS[building.kind].length]));
      if (isDestroyed) {
        this.transform(roof, kindIndex, building, 0, -1000, 0, 1, 1, 1, 0);
      } else {
        this.transform(roof, kindIndex, building, 0, wallHeight + roofHeight / 2, 0, width * 1.1, roofHeight, depth * 1.1, baseY);
      }
      this.setColor(roof, kindIndex, this.buildingColor(building, ROOF_COLORS[building.kind]));

      if (isDestroyed) continue;
      const frontDepth = depth / 2 + 0.05;
      this.transform(this.doors, buildingIndex, building, 0, wallHeight * 0.42, frontDepth, 0.48, 0.8, 0.08, baseY);
      this.setColor(this.doors, buildingIndex, this.buildingColor(building, DETAIL_COLORS[building.kind]));
      for (const windowX of [-width * 0.27, width * 0.27]) {
        this.transform(this.windows, windowIndex, building, windowX, wallHeight * 0.55, frontDepth + 0.01, 0.34, 0.32, 0.06, baseY);
        this.setColor(this.windows, windowIndex, this.buildingColor(building, WINDOW_COLOR));
        windowIndex++;
      }
      if (building.kind !== 'barn') {
        this.transform(this.porches, buildingIndex, building, 0, 0.08, frontDepth + 0.18, building.kind === 'house' ? 0.9 : 0.72, 0.12, 0.42, baseY);
        this.setColor(this.porches, buildingIndex, this.buildingColor(building, DETAIL_COLORS[building.kind]));
      }
      this.transform(this.chimneys, buildingIndex, building, width * 0.25, wallHeight + roofHeight * 0.45, -depth * 0.15, 0.2, 0.5, 0.2, baseY);
      this.setColor(this.chimneys, buildingIndex, this.buildingColor(building, DETAIL_COLORS[building.kind]));

      if (building.driveway.road) {
        const entrance = building.driveway.entrance;
        const road = building.driveway.road;
        const ex = (entrance.x + 0.5) * s;
        const ez = (entrance.z + 0.5) * s;
        const rx = (road.x + 0.5) * s;
        const rz = (road.z + 0.5) * s;
        const dx = rx - ex;
        const dz = rz - ez;
        const length = Math.hypot(dx, dz);
        if (length > 0.5) {
          const drivewayYaw = Math.atan2(dx, dz);
          const midpointX = (ex + rx) / 2;
          const midpointZ = (ez + rz) / 2;
          const drivewayY = this.hm.sample(midpointX, midpointZ) + 0.025;
          this.transformWorld(this.driveways, drivewayIndex, midpointX, drivewayY, midpointZ, 0.28, 0.04, length / s, drivewayYaw);
          this.setColor(this.driveways, drivewayIndex, DRIVEWAY_COLOR);
          drivewayIndex++;
        }
      }
      buildingIndex++;
    }
    this.houseWalls.count = counts.get('house') ?? 0;
    this.barnWalls.count = counts.get('barn') ?? 0;
    this.cabinWalls.count = counts.get('cabin') ?? 0;
    this.houseRoofs.count = counts.get('house') ?? 0;
    this.barnRoofs.count = counts.get('barn') ?? 0;
    this.cabinRoofs.count = counts.get('cabin') ?? 0;
    this.doors.count = buildingIndex;
    this.windows.count = Math.min(windowIndex, MAX_WINDOWS);
    this.porches.count = buildingIndex;
    this.chimneys.count = buildingIndex;
    this.driveways.count = drivewayIndex;
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    const geometries = new Set<object>();
    const materials = new Set<object>();
    for (const mesh of this.meshes) {
      if (!geometries.has(mesh.geometry)) {
        mesh.geometry.dispose();
        geometries.add(mesh.geometry);
      }
      const meshMaterial = mesh.material as MeshStandardMaterial;
      if (!materials.has(meshMaterial)) {
        meshMaterial.dispose();
        materials.add(meshMaterial);
      }
    }
  }
}
