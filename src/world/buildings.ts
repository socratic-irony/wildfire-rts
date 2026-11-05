import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
} from 'three';
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { ModelBuilder } from '../core/modelBuilder';
import { buildModel, MODEL_BODY } from '../core/modelMaterials';
import { BuildingKind, buildBuildingModel, LOT_FRONTAGE } from './buildingModels';
import { GRID_SIZE, TILE_SIZE, tileIndex, tileToWorld } from './constants';
import { Heightmap } from './heightmap';
import { BiomeMap, Terrain } from './biomes';
import { RoadNetwork } from './roads';

export type { BuildingKind } from './buildingModels';
export type FrontDirection = 'north' | 'south' | 'east' | 'west';
export type BuildingState = 'intact' | 'burning' | 'destroyed';

export interface Building {
  id: number;
  kind: BuildingKind;
  x0: number;
  z0: number;
  worldW: number;
  worldD: number;
  facadeW: number;
  depth: number;
  rotation: number;
  front: FrontDirection;
  centerX: number;
  centerZ: number;
  tiles: number[];
  state: BuildingState;
  damage: number;
  visual: BuildingVisual | null;
}

interface LotCandidate {
  kind: BuildingKind;
  x0: number;
  z0: number;
  worldW: number;
  worldD: number;
  facadeW: number;
  depth: number;
  rotation: number;
  front: FrontDirection;
  score: number;
}

const BUILDING_TARGET = 19;

/** Unique or rare kinds: at most this many per map. */
const KIND_LIMIT: Partial<Record<BuildingKind, number>> = {
  chapel: 1,
  school: 1,
  gas: 1,
  motel: 1,
  store: 3,
  trailer: 3,
  shop: 3,
  aframe: 3,
  barn: 3,
};

/** Score bonus so a town reliably gets its landmarks. */
const KIND_BONUS: Partial<Record<BuildingKind, number>> = {
  house: 4,
  twostory: 4,
  store: 6,
  chapel: 5,
  school: 6,
  gas: 5,
  motel: 4,
};

/**
 * Building mix by distance from the town centre (in tiles): main street in
 * the middle, highway businesses and farms on the edge, cabins in the woods.
 */
function pickKind(distanceToTown: number, roll: number): BuildingKind {
  if (distanceToTown < 12) {
    if (roll < 0.07) return 'chapel';
    if (roll < 0.13) return 'school';
    if (roll < 0.4) return 'store';
    if (roll < 0.58) return 'twostory';
    if (roll < 0.74) return 'ranch';
    return 'house';
  }
  if (distanceToTown <= 21) {
    if (roll < 0.07) return 'motel';
    if (roll < 0.13) return 'gas';
    if (roll < 0.26) return 'barn';
    if (roll < 0.36) return 'trailer';
    if (roll < 0.45) return 'shop';
    if (roll < 0.6) return 'twostory';
    if (roll < 0.76) return 'ranch';
    return 'house';
  }
  if (roll < 0.34) return 'cabin';
  if (roll < 0.5) return 'aframe';
  if (roll < 0.62) return 'trailer';
  if (roll < 0.72) return 'shop';
  if (roll < 0.86) return 'barn';
  return 'house';
}

export const HELIPAD_SIZE = 3;

/** Helipad centre tile for a seeded layout: beside the main street, station side. */
export function helipadCenter(heightmap: Heightmap): { x: number; z: number } {
  const { town, side } = heightmap.layout;
  return { x: town.x + side * 9, z: town.z + 2 };
}

function stationFootprint(heightmap: Heightmap): { x0: number; z0: number; w: number; d: number } {
  const { town, side } = heightmap.layout;
  return { x0: side > 0 ? town.x + 3 : town.x - 5, z0: town.z + 1, w: 3, d: 2 };
}

export class BuildingSystem {
  readonly buildings: Building[] = [];
  readonly structureAt = new Int16Array(GRID_SIZE * GRID_SIZE).fill(-1);
  readonly occupied = new Uint8Array(GRID_SIZE * GRID_SIZE);
  readonly group = new Group();
  private nextId = 1;
  onDestroyed: ((building: Building) => void) | null = null;

  constructor(
    private readonly heightmap: Heightmap,
    readonly biomes: BiomeMap,
    readonly roads: RoadNetwork,
    private readonly seed: number,
  ) {
    this.group.name = 'buildings';
    this.reserveHelipad();
    this.placeStation();
    this.placeLots();
    this.createVisuals();
  }

  get intactCount(): number {
    return this.buildings.reduce((n, b) => n + (b.state === 'destroyed' ? 0 : 1), 0);
  }

  get destroyedCount(): number {
    return this.buildings.reduce((n, b) => n + (b.state === 'destroyed' ? 1 : 0), 0);
  }

  get burningCount(): number {
    return this.buildings.reduce((n, b) => n + (b.state === 'burning' ? 1 : 0), 0);
  }

  get station(): Building {
    return this.buildings[0] as Building;
  }

  get score(): number {
    return this.intactCount * 10 - this.destroyedCount * 25;
  }

  isOccupied(tx: number, tz: number): boolean {
    return this.occupied[tileIndex(tx, tz)] === 1;
  }

  buildingAt(tx: number, tz: number): Building | null {
    const id = this.structureAt[tileIndex(tx, tz)] ?? -1;
    return id >= 0 ? (this.buildings[id] ?? null) : null;
  }

  update(dt: number, getFireState: (index: number) => number, getHeat: (index: number) => number): void {
    for (const building of this.buildings) {
      let active = 0;
      let heat = 0;
      for (const index of building.tiles) {
        const state = getFireState(index);
        if (state === 1 || state === 2) {
          active += 1;
          heat += getHeat(index);
        }
      }
      if (active > 0) {
        building.state = 'burning';
        building.damage = clamp(building.damage + dt * (2.4 + active * 1.15), 0, 100);
      } else if (building.state === 'burning') {
        building.state = 'intact';
      }
      if (building.state !== 'destroyed' && active === 0) {
        building.damage = Math.max(0, building.damage - dt * 0.55);
      }
      if (building.damage >= 100 && building.state !== 'destroyed') {
        building.state = 'destroyed';
        building.damage = 100;
        this.onDestroyed?.(building);
      }
      building.visual?.update(building.state, building.damage, heat);
    }
  }

  private reserveHelipad(): void {
    const center = helipadCenter(this.heightmap);
    for (let dz = 0; dz < HELIPAD_SIZE; dz += 1) {
      for (let dx = 0; dx < HELIPAD_SIZE; dx += 1) {
        for (let ringZ = -1; ringZ <= 1; ringZ += 1) {
          for (let ringX = -1; ringX <= 1; ringX += 1) {
            const tx = center.x + dx + ringX - 1;
            const tz = center.z + dz + ringZ - 1;
            if (tx >= 0 && tz >= 0 && tx < GRID_SIZE && tz < GRID_SIZE) {
              this.occupied[tileIndex(tx, tz)] = 1;
            }
          }
        }
      }
    }
  }

  private placeStation(): void {
    const { x0, z0, w, d } = stationFootprint(this.heightmap);
    const footprint: number[] = [];
    for (let z = z0; z < z0 + d; z += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        footprint.push(tileIndex(x, z));
        this.occupied[tileIndex(x, z)] = 1;
      }
    }
    this.addBuilding({
      kind: 'station',
      x0,
      z0,
      worldW: w,
      worldD: d,
      facadeW: w,
      depth: d,
      rotation: Math.PI,
      front: 'north',
      footprint,
    });
  }

  private placeLots(): void {
    const rng = new Rng(this.seed ^ 0x91e10da5);
    const candidates: LotCandidate[] = [];
    this.roads.forEach((tx, tz) => {
      const southRoad = this.roads.has(tx, tz + 1);
      const northRoad = this.roads.has(tx, tz - 1);
      const eastRoad = this.roads.has(tx + 1, tz);
      const westRoad = this.roads.has(tx - 1, tz);
      if (!southRoad) this.addCandidate(candidates, rng, tx, tz, 'south');
      if (!northRoad) this.addCandidate(candidates, rng, tx, tz, 'north');
      if (!eastRoad) this.addCandidate(candidates, rng, tx, tz, 'east');
      if (!westRoad) this.addCandidate(candidates, rng, tx, tz, 'west');
    });

    candidates.sort((a, b) => b.score - a.score);
    const chosen: LotCandidate[] = [];
    for (const candidate of candidates) {
      if (this.buildings.length >= BUILDING_TARGET) break;
      if (!this.fits(candidate)) continue;
      const limit = KIND_LIMIT[candidate.kind];
      if (limit !== undefined && chosen.filter((c) => c.kind === candidate.kind).length >= limit) continue;
      let tooClose = false;
      for (const other of chosen) {
        if (Math.abs(other.x0 + other.worldW / 2 - (candidate.x0 + candidate.worldW / 2)) < 4.2) {
          const dz = Math.abs(other.z0 + other.worldD / 2 - (candidate.z0 + candidate.worldD / 2));
          if (dz < 4.2) {
            tooClose = true;
            break;
          }
        }
      }
      if (tooClose) continue;
      chosen.push(candidate);
      this.commitCandidate(candidate);
    }
  }

  private addCandidate(
    list: LotCandidate[],
    rng: Rng,
    roadX: number,
    roadZ: number,
    side: FrontDirection,
  ): void {
    const town = this.heightmap.layout.town;
    const distanceToTown = Math.hypot(roadX - town.x, roadZ - town.z);
    const kind = pickKind(distanceToTown, rng.next());
    const facadeW = LOT_FRONTAGE[kind];
    const depth = 2;
    let x0: number;
    let z0: number;
    let worldW: number;
    let worldD: number;
    let rotation: number;
    switch (side) {
      case 'north':
        x0 = roadX - Math.floor(facadeW / 2);
        z0 = roadZ + 1;
        worldW = facadeW;
        worldD = depth;
        rotation = Math.PI;
        break;
      case 'south':
        x0 = roadX - Math.floor(facadeW / 2);
        z0 = roadZ - depth;
        worldW = facadeW;
        worldD = depth;
        rotation = 0;
        break;
      case 'east':
        x0 = roadX + 1;
        z0 = roadZ - Math.floor(facadeW / 2);
        worldW = depth;
        worldD = facadeW;
        rotation = -Math.PI / 2;
        break;
      case 'west':
        x0 = roadX - depth;
        z0 = roadZ - Math.floor(facadeW / 2);
        worldW = depth;
        worldD = facadeW;
        rotation = Math.PI / 2;
        break;
    }
    const terrainType = this.biomes.types[tileIndex(roadX, roadZ)] ?? Terrain.Grass;
    let score = rng.range(0, 12) + (KIND_BONUS[kind] ?? 0);
    if (kind === 'cabin' || kind === 'aframe') {
      score += terrainType === Terrain.Forest ? 10 : -6;
      score += distanceToTown > 13 ? 5 : -4;
    } else {
      score += distanceToTown < 25 ? 7 : -2;
    }
    if (side === 'north' || side === 'west') score += 1.5;
    list.push({ kind, x0, z0, worldW, worldD, facadeW, depth, rotation, front: side, score });
  }

  private fits(candidate: LotCandidate): boolean {
    const { x0, z0, worldW, worldD } = candidate;
    if (x0 < 1 || z0 < 1 || x0 + worldW >= GRID_SIZE - 1 || z0 + worldD >= GRID_SIZE - 1) return false;
    for (let z = z0; z < z0 + worldD; z += 1) {
      for (let x = x0; x < x0 + worldW; x += 1) {
        const index = tileIndex(x, z);
        if (this.occupied[index]) return false;
        if (this.roads.has(x, z)) return false;
        const type = this.biomes.types[index] ?? Terrain.Grass;
        if (type === Terrain.Water || type === Terrain.Rock || type === Terrain.Road) return false;
        if (this.heightmap.tileMaxHeight(x, z) - this.heightmap.tileMinHeight(x, z) > 0.01) return false;
      }
    }
    for (let z = z0 - 1; z <= z0 + worldD; z += 1) {
      for (let x = x0 - 1; x <= x0 + worldW; x += 1) {
        if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
        const index = tileIndex(x, z);
        if (this.occupied[index] && (x < x0 || x >= x0 + worldW || z < z0 || z >= z0 + worldD)) {
          return false;
        }
      }
    }
    return true;
  }

  private commitCandidate(candidate: LotCandidate): void {
    const footprint: number[] = [];
    for (let z = candidate.z0; z < candidate.z0 + candidate.worldD; z += 1) {
      for (let x = candidate.x0; x < candidate.x0 + candidate.worldW; x += 1) {
        const index = tileIndex(x, z);
        footprint.push(index);
        this.biomes.types[index] = Terrain.Urban;
      }
    }
    for (let z = candidate.z0 - 1; z <= candidate.z0 + candidate.worldD; z += 1) {
      for (let x = candidate.x0 - 1; x <= candidate.x0 + candidate.worldW; x += 1) {
        if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
        this.occupied[tileIndex(x, z)] = 1;
      }
    }
    this.addBuilding({
      kind: candidate.kind,
      x0: candidate.x0,
      z0: candidate.z0,
      worldW: candidate.worldW,
      worldD: candidate.worldD,
      facadeW: candidate.facadeW,
      depth: candidate.depth,
      rotation: candidate.rotation,
      front: candidate.front,
      footprint,
    });
  }

  private addBuilding(data: {
    kind: BuildingKind;
    x0: number;
    z0: number;
    worldW: number;
    worldD: number;
    facadeW: number;
    depth: number;
    rotation: number;
    front: FrontDirection;
    footprint: number[];
  }): void {
    const id = this.nextId;
    this.nextId += 1;
    const world = tileToWorld(data.x0 + data.worldW / 2 - 0.5, data.z0 + data.worldD / 2 - 0.5);
    const building: Building = {
      id,
      kind: data.kind,
      x0: data.x0,
      z0: data.z0,
      worldW: data.worldW,
      worldD: data.worldD,
      facadeW: data.facadeW,
      depth: data.depth,
      rotation: data.rotation,
      front: data.front,
      centerX: world.x,
      centerZ: world.z,
      tiles: data.footprint,
      state: 'intact',
      damage: 0,
      visual: null,
    };
    for (const index of data.footprint) this.structureAt[index] = this.buildings.length;
    this.buildings.push(building);
  }

  private createVisuals(): void {
    for (const building of this.buildings) {
      const visual = new BuildingVisual(
        building.kind,
        building.facadeW * TILE_SIZE,
        building.depth * TILE_SIZE,
        this.seed + building.id * 97,
      );
      visual.group.name = `building-${building.id}`;
      visual.group.position.set(building.centerX, this.heightmap.tileHeight(building.x0, building.z0), building.centerZ);
      visual.group.rotation.y = building.rotation;
      building.visual = visual;
      this.group.add(building.visual.group);
    }
    this.group.add(createHelipad(this.heightmap));
    const lookout = createLookout(this.heightmap, this.roads, this.occupied);
    if (lookout) this.group.add(lookout);
    this.group.add(this.poles);
    this.rebuildPoles();
  }

  /** Power poles follow the road network, so they are rebuilt with it. */
  private readonly poles = new Group();

  rebuildPoles(): void {
    for (const child of [...this.poles.children]) {
      this.poles.remove(child);
      disposeTree(child);
    }
    this.poles.add(createPowerPoles(this.heightmap, this.roads, this.occupied));
  }
}

function standard(color: number, roughness = 0.88): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
}

const signCache = new Map<string, MeshStandardMaterial>();

function signMaterial(text: string, background: string): MeshStandardMaterial {
  const key = `${text}|${background}`;
  let material = signCache.get(key);
  if (!material) {
    material = new MeshStandardMaterial({ map: makeSignTexture(text, background), roughness: 0.8 });
    signCache.set(key, material);
  }
  return material;
}

function disposeTree(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const material = mesh.material as Material | Material[];
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material.dispose();
  });
}

/**
 * A building's meshes: the intact model (one merged body mesh plus glass,
 * glow and any painted signs) and its rubble. The body material is the only
 * per-building material; it darkens and glows as the structure burns.
 */
export class BuildingVisual {
  readonly group = new Group();
  private readonly intact: Group;
  private readonly destroyed: Group;
  private readonly bodyMaterial: MeshStandardMaterial;
  private glow = 0;
  private lastBurn = -1;

  constructor(kind: BuildingKind, width: number, depth: number, seed: number) {
    const model = buildBuildingModel(kind, width, depth, seed);
    this.bodyMaterial = MODEL_BODY.clone();
    this.intact = buildModel(model.intact, { body: this.bodyMaterial });
    for (const sign of model.signs) {
      const mesh = new Mesh(new PlaneGeometry(sign.w, sign.h), signMaterial(sign.text, sign.background));
      mesh.position.set(sign.x, sign.y, sign.z);
      mesh.rotation.y = sign.rotation;
      mesh.name = 'sign';
      this.intact.add(mesh);
    }
    this.destroyed = buildModel(model.rubble);
    this.destroyed.visible = false;
    this.group.add(this.intact, this.destroyed);
  }

  update(state: BuildingState, damage: number, heat: number): void {
    this.destroyed.visible = state === 'destroyed';
    this.intact.visible = state !== 'destroyed';
    const burn = clamp(damage / 100, 0, 1);
    const glowTarget = state === 'burning' ? 0.18 + Math.min(0.5, heat * 0.4) : 0;
    this.glow += (glowTarget - this.glow) * 0.12;
    if (Math.abs(burn - this.lastBurn) > 0.002) {
      this.lastBurn = burn;
      this.bodyMaterial.color.setScalar(1 - burn * 0.65);
    }
    this.bodyMaterial.emissive.setRGB(this.glow, this.glow * 0.3, this.glow * 0.05);
  }
}

/** Standalone building model for the model lab (lot-centred, street toward +z). */
export function createBuildingPreview(kind: BuildingKind, seed: number, destroyed = false): Group {
  const visual = new BuildingVisual(kind, LOT_FRONTAGE[kind] * TILE_SIZE, 2 * TILE_SIZE, seed);
  visual.update(destroyed ? 'destroyed' : 'intact', destroyed ? 100 : 0, 0);
  return visual.group;
}

function makeSignTexture(text: string, background = '#7c2f27'): Texture {
  if (typeof document === 'undefined') return new Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#f0e6cc';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    ctx.fillStyle = '#f7efdc';
    ctx.font = `bold ${text.length > 10 ? 46 : 58}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createHelipad(heightmap: Heightmap): Group {
  const group = new Group();
  group.name = 'helipad';
  const padTile = helipadCenter(heightmap);
  const center = tileToWorld(padTile.x, padTile.z);
  const y = heightmap.tileHeight(padTile.x, padTile.z);
  const pad = new Mesh(
    new CircleGeometry(HELIPAD_SIZE * TILE_SIZE * 0.5, 32),
    new MeshStandardMaterial({ color: 0x5b5e5a, roughness: 0.95, metalness: 0.02 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(center.x, y + 0.06, center.z);
  pad.receiveShadow = true;
  group.add(pad);

  const ring = new Mesh(
    new CircleGeometry(HELIPAD_SIZE * TILE_SIZE * 0.38, 32),
    new MeshBasicMaterial({ color: 0xe4d7b2 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(center.x, y + 0.075, center.z);
  group.add(ring);
  const inner = new Mesh(
    new CircleGeometry(HELIPAD_SIZE * TILE_SIZE * 0.34, 32),
    new MeshStandardMaterial({ color: 0x5b5e5a, roughness: 0.95 }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(center.x, y + 0.08, center.z);
  group.add(inner);
  const hMat = new MeshBasicMaterial({ color: 0xe4d7b2 });
  const barLeft = new Mesh(new PlaneGeometry(0.28, 1.7), hMat);
  barLeft.rotation.x = -Math.PI / 2;
  barLeft.position.set(center.x - 0.55, y + 0.09, center.z);
  group.add(barLeft);
  const barRight = barLeft.clone();
  barRight.position.x = center.x + 0.55;
  group.add(barRight);
  const cross = new Mesh(new PlaneGeometry(0.85, 0.28), hMat);
  cross.rotation.x = -Math.PI / 2;
  cross.position.set(center.x, y + 0.09, center.z);
  group.add(cross);

  // Water tower serving the helipad, on the station side, clear of the pad.
  const side = heightmap.layout.side;
  const tower = new ModelBuilder();
  const steel = 0x6f7d78;
  tower.push(center.x - side * 4.4, y, center.z - 3.4);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    tower.box(0.09, 3.3, 0.09, steel, sx * 0.5, 1.6, sz * 0.5, { x: sz * 0.08, z: -sx * 0.08 });
  }
  for (const yy of [1.1, 2.2]) {
    for (const [w, d, ox, oz] of [[0.95, 0.04, 0, 0.42], [0.95, 0.04, 0, -0.42], [0.04, 0.95, 0.42, 0], [0.04, 0.95, -0.42, 0]] as const) {
      tower.box(w * (1 - yy / 14), 0.04, d * (1 - yy / 14), steel, ox * (1 - yy / 14), yy, oz * (1 - yy / 14));
    }
  }
  tower.cylinder(0.82, 1.35, 0x8c9a93, 0, 3.8, 0, undefined, 14);
  tower.cylinder(0.84, 0.08, steel, 0, 3.4, 0, undefined, 14);
  tower.cylinder(0.84, 0.06, steel, 0, 4.2, 0, undefined, 14);
  tower.cone(0.9, 0.55, steel, 0, 4.75, 0, undefined, 14);
  tower.cylinder(0.6, 0.12, 0x5d6a64, 0, 3.08, 0, undefined, 12);
  tower.box(0.04, 3.0, 0.04, 0x4a524e, 0.86, 2.0, 0);
  tower.pop();
  group.add(buildModel(tower));
  return group;
}

/** Wooden power poles along the rural (out-of-town) stretches of road. */
function createPowerPoles(heightmap: Heightmap, roads: RoadNetwork, occupied: Uint8Array): Group {
  const group = new Group();
  group.name = 'power-poles';
  const spots: Array<{ x: number; y: number; z: number; alongX: boolean }> = [];
  roads.forEach((tx, tz) => {
    if (heightmap.isTownVertex(tx, tz)) return;
    if ((tx * 7 + tz * 13) % 5 !== 0) return;
    const mask = roads.connectionMask(tx, tz);
    const alongX = mask === (2 | 8);
    const alongZ = mask === (1 | 4);
    if (!alongX && !alongZ) return;
    // Stand just off the shoulder on the +perpendicular side.
    const nx = alongX ? tx : tx + 1;
    const nz = alongX ? tz + 1 : tz;
    if (nx >= GRID_SIZE || nz >= GRID_SIZE || roads.has(nx, nz) || occupied[tileIndex(nx, nz)]) return;
    if (heightmap.isWater(nx, nz)) return;
    const center = tileToWorld(tx, tz);
    const x = center.x + (alongX ? 0 : TILE_SIZE * 0.72);
    const z = center.z + (alongX ? TILE_SIZE * 0.72 : 0);
    spots.push({ x, y: heightmap.heightAt(x, z), z, alongX });
  });
  if (spots.length === 0) return group;
  const poleGeometry = new CylinderGeometry(0.07, 0.1, 4.6, 6);
  poleGeometry.translate(0, 2.3, 0);
  const armGeometry = new BoxGeometry(1.3, 0.1, 0.1);
  armGeometry.translate(0, 4.25, 0);
  const capGeometry = new CylinderGeometry(0.05, 0.05, 0.16, 6);
  const poles = new InstancedMesh(poleGeometry, standard(0x6a4b33, 0.95), spots.length);
  const arms = new InstancedMesh(armGeometry, standard(0x5a3f2b, 0.95), spots.length);
  const caps = new InstancedMesh(capGeometry, standard(0x8fb3b0, 0.4), spots.length * 3);
  const dummy = new Object3D();
  spots.forEach((spot, i) => {
    dummy.position.set(spot.x, spot.y, spot.z);
    dummy.rotation.set(0, spot.alongX ? Math.PI / 2 : 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    arms.setMatrixAt(i, dummy.matrix);
    for (let k = 0; k < 3; k += 1) {
      const offset = (k - 1) * 0.55;
      dummy.position.set(
        spot.x + (spot.alongX ? 0 : offset),
        spot.y + 4.38,
        spot.z + (spot.alongX ? offset : 0),
      );
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      caps.setMatrixAt(i * 3 + k, dummy.matrix);
    }
  });
  for (const mesh of [poles, arms, caps]) {
    mesh.castShadow = mesh !== caps;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

const darkTimber = 0x5e4430;

/** A fire lookout tower beside the highest stretch of road outside town. */
function createLookout(heightmap: Heightmap, roads: RoadNetwork, occupied: Uint8Array): Group | null {
  const { town } = heightmap.layout;
  let best: { x: number; z: number } | null = null;
  let bestHeight = -Infinity;
  roads.forEach((tx, tz) => {
    if (Math.hypot((tx - town.x) / town.rx, (tz - town.z) / town.rz) < 1.5) return;
    const h = heightmap.tileHeight(tx, tz);
    if (h > bestHeight) {
      bestHeight = h;
      best = { x: tx, z: tz };
    }
  });
  if (!best) return null;
  const road: { x: number; z: number } = best;
  let site: { x: number; z: number } | null = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
    const x = road.x + dx;
    const z = road.z + dz;
    if (x < 1 || z < 1 || x >= GRID_SIZE - 1 || z >= GRID_SIZE - 1) continue;
    if (roads.has(x, z) || occupied[tileIndex(x, z)] || heightmap.isWater(x, z)) continue;
    if (heightmap.slopeTan(x, z) > 0.75) continue;
    site = { x, z };
    break;
  }
  if (!site) return null;
  occupied[tileIndex(site.x, site.z)] = 1;
  const center = tileToWorld(site.x, site.z);
  const b = new ModelBuilder();
  const timber = 0x7a5a3c;
  const legHeight = 6.2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    b.box(0.14, legHeight + 0.3, 0.14, timber, sx * 0.62, legHeight / 2, sz * 0.62, { x: sz * 0.07, z: -sx * 0.07 });
  }
  for (const y of [1.6, 3.3, 5.0]) {
    const k = 1 - y / 30;
    for (const [w, d, ox, oz] of [[1.3, 0.06, 0, 0.6], [1.3, 0.06, 0, -0.6], [0.06, 1.3, 0.6, 0], [0.06, 1.3, -0.6, 0]] as const) {
      b.box(w * k, 0.07, d * k, timber, ox * k, y, oz * k);
    }
    // Cross bracing between levels.
    for (const sz of [-1, 1]) b.box(1.3 * k, 0.05, 0.05, darkTimber, 0, y + 0.85, sz * 0.6 * k, { z: 0.9 });
  }
  // Switchback stair up one side.
  for (let i = 0; i < 6; i += 1) b.box(0.42, 0.05, 0.2, timber, 0.95, 0.6 + i * 1.0, -0.4 + (i % 2) * 0.8, { x: (i % 2 ? 1 : -1) * 0.6 });
  b.box(2.2, 0.12, 2.2, timber, 0, legHeight, 0);
  b.box(1.5, 1.15, 1.5, 0xd9cfb4, 0, legHeight + 0.64, 0);
  b.cone(1.3, 0.75, 0x5b3b2e, 0, legHeight + 1.58, 0, { y: Math.PI / 4 }, 4);
  for (const [w, d, ox, oz] of [[2.2, 0.05, 0, 1.08], [2.2, 0.05, 0, -1.08], [0.05, 2.2, 1.08, 0], [0.05, 2.2, -1.08, 0]] as const) {
    b.box(w, 0.05, d, timber, ox, legHeight + 0.5, oz);
  }
  b.cylinder(0.02, 1.1, 0x3a3a3a, 0.3, legHeight + 2.3, 0.3, undefined, 4);
  b.use('glass');
  b.box(1.54, 0.5, 1.54, 0x34505e, 0, legHeight + 0.82, 0);
  b.use('body');
  const group = buildModel(b);
  group.name = 'fire-lookout';
  group.position.set(center.x, heightmap.tileMinHeight(site.x, site.z), center.z);
  return group;
}
