import {
  BufferGeometry,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
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
const MAX_DRIVEWAY_SEGMENTS = MAX_BUILDINGS * 8;

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

function material(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.02,
    vertexColors: true,
    flatShading: true,
  });
}

function createMesh(name: string, geometry: BufferGeometry, count: number): BuildingMesh {
  const mesh = new InstancedMesh(geometry, material(), count);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createRoofGeometry(vertices: number[], indices: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Full rectangular hip roof with a short ridge, in unit local coordinates. */
function createHipRoofGeometry(): BufferGeometry {
  return createRoofGeometry(
    [
      -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
      0, 1, -0.18, 0, 1, 0.18,
    ],
    [0, 5, 4, 0, 3, 5, 1, 4, 5, 1, 5, 2, 0, 4, 1, 3, 2, 5],
  );
}

/** Full rectangular gable roof; the ridge runs from the front to the back. */
function createGableRoofGeometry(): BufferGeometry {
  return createRoofGeometry(
    [
      -0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, -0.5,
      -0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5,
    ],
    [0, 3, 4, 0, 4, 1, 2, 1, 4, 2, 4, 5, 0, 1, 2, 3, 5, 4],
  );
}

export type WorldPoint = { x: number; y: number; z: number };

/** Centerline points from the actual porch/door front to the connected road. */
export function buildingDrivewayPath(hm: Heightmap, building: Building): WorldPoint[] {
  if (!building.driveway.road) return [];
  const s = hm.scale;
  const centerX = (building.tile.x + 0.5) * s;
  const centerZ = (building.tile.z + 0.5) * s;
  const frontOffset = building.footprint.depth * 0.82 / 2 + 0.05 + (building.kind === 'barn' ? 0.05 : 0.18);
  const startX = centerX + Math.sin(building.orientation) * frontOffset * s;
  const startZ = centerZ + Math.cos(building.orientation) * frontOffset * s;
  const roadX = (building.driveway.road.x + 0.5) * s;
  const roadZ = (building.driveway.road.z + 0.5) * s;
  const distance = Math.hypot(roadX - startX, roadZ - startZ);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.75 * s, 0.01)));
  const path: WorldPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = startX + (roadX - startX) * t;
    const z = startZ + (roadZ - startZ) * t;
    path.push({ x, y: hm.sample(x, z) + 0.025, z });
  }
  return path;
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
  private houseGableRoofs: BuildingMesh;
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
  private tmpD = new Vector3();
  private tmpMid = new Vector3();
  private tmpAxis = new Vector3();
  private tmpC = new Color();

  constructor(hm: Heightmap) {
    this.hm = hm;
    this.houseWalls = createMesh('houseWalls', new BoxGeometry(1, 1, 1), MAX_BUILDINGS);
    this.barnWalls = createMesh('barnWalls', new BoxGeometry(1, 1, 1), MAX_BUILDINGS);
    this.cabinWalls = createMesh('cabinWalls', new BoxGeometry(1, 1, 1), MAX_BUILDINGS);
    this.houseRoofs = createMesh('houseRoofs', createHipRoofGeometry(), MAX_BUILDINGS);
    this.houseGableRoofs = createMesh('houseGableRoofs', createGableRoofGeometry(), MAX_BUILDINGS);
    this.barnRoofs = createMesh('barnRoofs', createGableRoofGeometry(), MAX_BUILDINGS);
    this.cabinRoofs = createMesh('cabinRoofs', createGableRoofGeometry(), MAX_BUILDINGS);
    this.doors = createMesh('buildingDoors', new BoxGeometry(1, 1, 1), MAX_BUILDINGS);
    this.windows = createMesh('buildingWindows', new BoxGeometry(1, 1, 1), MAX_WINDOWS);
    this.porches = createMesh('buildingPorches', new BoxGeometry(1, 1, 1), MAX_BUILDINGS);
    this.chimneys = createMesh('buildingChimneys', new BoxGeometry(1, 1, 1), MAX_BUILDINGS);
    this.driveways = createMesh('buildingDriveways', new BoxGeometry(1, 1, 1), MAX_DRIVEWAY_SEGMENTS);
    this.meshes = [
      this.houseWalls,
      this.barnWalls,
      this.cabinWalls,
      this.houseRoofs,
      this.houseGableRoofs,
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

  private roofBatch(building: Building): BuildingMesh {
    return building.kind === 'house' && building.variant % 2 === 1 ? this.houseGableRoofs : this.roofMesh(building.kind);
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
    this.tmpP.set(localX * s, localY * s, localZ * s).applyQuaternion(this.tmpQ);
    this.tmpP.x += worldX;
    this.tmpP.y += y;
    this.tmpP.z += worldZ;
    this.tmpS.set(scaleX * s, scaleY * s, scaleZ * s);
    this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
    mesh.setMatrixAt(index, this.tmpM);
  }

  private transformWorldSegment(mesh: BuildingMesh, index: number, start: WorldPoint, end: WorldPoint): void {
    const s = this.hm.scale;
    this.tmpD.set(end.x - start.x, end.y - start.y, end.z - start.z);
    const length = this.tmpD.length();
    if (length <= 0.0001) return;
    this.tmpQ.setFromUnitVectors(this.tmpAxis.set(0, 0, 1), this.tmpD.normalize());
    this.tmpMid.set(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      (start.z + end.z) / 2,
    );
    this.tmpS.set(0.28 * s, 0.04 * s, length);
    this.tmpM.compose(this.tmpMid, this.tmpQ, this.tmpS);
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
    let porchIndex = 0;
    let drivewayIndex = 0;
    const roofCounts = { houseHip: 0, houseGable: 0, barn: 0, cabin: 0 };
    for (const building of buildings) {
      if (buildingIndex >= MAX_BUILDINGS) break;
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
      const roof = this.roofBatch(building);
      const roofKey = building.kind === 'house'
        ? building.variant % 2 === 1 ? 'houseGable' : 'houseHip'
        : building.kind;
      const roofIndex = roofCounts[roofKey];
      roofCounts[roofKey]++;
      this.transform(wall, kindIndex, building, 0, wallHeight / 2, 0, width, wallHeight, depth, baseY);
      this.setColor(wall, kindIndex, this.buildingColor(building, WALL_COLORS[building.kind][building.variant % WALL_COLORS[building.kind].length]));
      if (isDestroyed) {
        this.transform(roof, roofIndex, building, 0, -1000, 0, 1, 1, 1, 0);
      } else {
        this.transform(roof, roofIndex, building, 0, wallHeight, 0, width * 1.1, roofHeight, depth * 1.1, baseY);
      }
      this.setColor(roof, roofIndex, this.buildingColor(building, ROOF_COLORS[building.kind]));

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
        this.transform(this.porches, porchIndex, building, 0, 0.08, frontDepth + 0.18, building.kind === 'house' ? 0.9 : 0.72, 0.12, 0.42, baseY);
        this.setColor(this.porches, porchIndex, this.buildingColor(building, DETAIL_COLORS[building.kind]));
        porchIndex++;
      }
      this.transform(this.chimneys, buildingIndex, building, width * 0.25, wallHeight + roofHeight * 0.45, -depth * 0.15, 0.2, 0.5, 0.2, baseY);
      this.setColor(this.chimneys, buildingIndex, this.buildingColor(building, DETAIL_COLORS[building.kind]));

      if (building.driveway.road) {
        const path = buildingDrivewayPath(this.hm, building);
        for (let i = 0; i < path.length - 1 && drivewayIndex < MAX_DRIVEWAY_SEGMENTS; i++) {
          this.transformWorldSegment(this.driveways, drivewayIndex, path[i], path[i + 1]);
          this.setColor(this.driveways, drivewayIndex, DRIVEWAY_COLOR);
          drivewayIndex++;
        }
      }
      buildingIndex++;
    }
    this.houseWalls.count = counts.get('house') ?? 0;
    this.barnWalls.count = counts.get('barn') ?? 0;
    this.cabinWalls.count = counts.get('cabin') ?? 0;
    this.houseRoofs.count = roofCounts.houseHip;
    this.houseGableRoofs.count = roofCounts.houseGable;
    this.barnRoofs.count = roofCounts.barn;
    this.cabinRoofs.count = roofCounts.cabin;
    this.doors.count = buildingIndex;
    this.windows.count = Math.min(windowIndex, MAX_WINDOWS);
    this.porches.count = porchIndex;
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
