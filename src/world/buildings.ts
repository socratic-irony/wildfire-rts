import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { hash2, Rng } from '../core/rng';
import { clamp } from '../core/math';
import { GRID_SIZE, TILE_SIZE, tileIndex, tileToWorld } from './constants';
import { Heightmap } from './heightmap';
import { BiomeMap, Terrain } from './biomes';
import { RoadNetwork } from './roads';

export type BuildingKind = 'house' | 'twostory' | 'ranch' | 'barn' | 'cabin' | 'store' | 'chapel' | 'station';
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

const FRONT_YARD: Record<BuildingKind, number> = {
  house: 1,
  twostory: 1.05,
  ranch: 1,
  barn: 0,
  cabin: 0.95,
  store: 1.1,
  chapel: 0.6,
  station: 0,
};

const WALL_HEIGHT: Record<BuildingKind, number> = {
  house: 2.35,
  twostory: 3.4,
  ranch: 2.1,
  barn: 3.15,
  cabin: 2.35,
  store: 2.7,
  chapel: 2.9,
  station: 3.3,
};
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
      if (candidate.kind === 'chapel' && chosen.some((c) => c.kind === 'chapel')) continue;
      if (candidate.kind === 'store' && chosen.filter((c) => c.kind === 'store').length >= 3) continue;
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
    const roll = rng.next();
    let kind: BuildingKind = 'house';
    if (distanceToTown > 21 && roll < 0.52) kind = 'cabin';
    else if (distanceToTown < 12 && roll < 0.45) kind = roll < 0.08 ? 'chapel' : 'store';
    else if (distanceToTown > 12 && roll < 0.2) kind = 'barn';
    else if (roll < 0.36) kind = 'twostory';
    else if (roll < 0.52) kind = 'ranch';
    const facadeW = kind === 'barn' || kind === 'ranch' ? 3 : 2;
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
    let score = rng.range(0, 12) + (kind === 'house' || kind === 'twostory' ? 4 : 0);
    if (kind === 'store') score += 6;
    if (kind === 'chapel') score += 5;
    if (kind === 'cabin') {
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
      building.visual = new BuildingVisual(building, this.heightmap, this.seed + building.id * 97);
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

// Shared detail materials. Only wall/roof/trim are per-building (they char as
// the building burns); everything here is static and safe to share.
const WINDOW = new MeshStandardMaterial({
  color: 0x364a57,
  emissive: 0x283b44,
  emissiveIntensity: 0.25,
  roughness: 0.32,
  metalness: 0.05,
});
const DOOR = standard(0x6b4a33, 0.8);
const BRICK = standard(0x8e4b3a, 0.95);
const STONE = standard(0x8a857b, 0.95);
const CONCRETE = standard(0xa8a49a, 0.95);
const WOOD = standard(0x8a6844, 0.9);
const LOG = standard(0x6e4c30, 0.92);
const PICKET = standard(0xece6d6, 0.85);
const GARAGE = standard(0xd8d2c2, 0.8);
const MAILBOX = standard(0x4e5b63, 0.6);
const GOLD = standard(0xc9a548, 0.5);
const BELFRY = standard(0x2d2a28, 0.9);
const SILO = standard(0xb7bcbc, 0.55);
const SILO_CAP = standard(0x8a9192, 0.5);
const HAY = standard(0xd2b064, 0.95);
const AWNINGS = [standard(0x9c3b31), standard(0x2f6a5c), standard(0x3d5a8a), standard(0xb88a2e)];
const SIGN_COLORS = ['#7c2f27', '#2f4a3a', '#2d3f5c', '#5c3a22'];
const PICKET_GEOMETRY = new BoxGeometry(0.06, 0.6, 0.06);
const LOG_GEOMETRY = new CylinderGeometry(0.07, 0.07, 1, 5);
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

class BuildingVisual {
  readonly group = new Group();
  private readonly intact = new Group();
  private readonly destroyed = new Group();
  private readonly wallMaterial: MeshStandardMaterial;
  private readonly roofMaterial: MeshStandardMaterial;
  private readonly trimMaterial: MeshStandardMaterial;
  private readonly wallBase: Color;
  private readonly roofBase: Color;
  private readonly baseHeight: number;
  private glow = 0;

  constructor(
    private readonly building: Building,
    heightmap: Heightmap,
    seed: number,
  ) {
    this.baseHeight = heightmap.tileHeight(building.x0, building.z0);
    this.group.name = `building-${building.id}`;
    this.group.position.set(building.centerX, this.baseHeight, building.centerZ);
    this.group.rotation.y = building.rotation;

    const palette = paletteFor(building.kind, seed);
    this.wallBase = new Color(palette.wall);
    this.roofBase = new Color(palette.roof);
    this.wallMaterial = standard(palette.wall);
    this.roofMaterial = standard(palette.roof, 0.9);
    this.trimMaterial = standard(palette.trim, 0.8);

    const width = building.facadeW * TILE_SIZE;
    // Lots sit flush against the road tile, so houses step back a metre to
    // keep porches, boardwalks and mailboxes inside their own lot.
    const frontYard = FRONT_YARD[building.kind];
    const depth = building.depth * TILE_SIZE - frontYard;
    this.intact.position.z = -frontYard / 2;
    this.destroyed.position.z = -frontYard / 2;
    const wallHeight = WALL_HEIGHT[building.kind];
    const rng = new Rng(seed ^ 0x2545f491);
    switch (building.kind) {
      case 'station':
        this.buildStation(width, depth, wallHeight);
        break;
      case 'barn':
        this.buildBarn(width, depth, wallHeight, rng);
        break;
      case 'cabin':
        this.buildCabin(width, depth, wallHeight, rng);
        break;
      case 'twostory':
        this.buildTwoStory(width, depth, wallHeight, rng);
        break;
      case 'ranch':
        this.buildRanch(width, depth, wallHeight, rng);
        break;
      case 'store':
        this.buildStore(width, depth, wallHeight, rng);
        break;
      case 'chapel':
        this.buildChapel(width, depth, wallHeight);
        break;
      default:
        this.buildHouse(width, depth, wallHeight, rng);
    }
    this.buildRubble(width, depth, wallHeight);
    this.destroyed.visible = false;
    this.group.add(this.intact, this.destroyed);
  }

  update(state: BuildingState, damage: number, heat: number): void {
    this.destroyed.visible = state === 'destroyed';
    this.intact.visible = state !== 'destroyed';
    const burn = clamp(damage / 100, 0, 1);
    const glowTarget = state === 'burning' ? 0.18 + Math.min(0.5, heat * 0.4) : 0;
    this.glow += (glowTarget - this.glow) * 0.12;
    this.wallMaterial.color.copy(this.wallBase).multiplyScalar(1 - burn * 0.62);
    this.roofMaterial.color.copy(this.roofBase).multiplyScalar(1 - burn * 0.68);
    this.wallMaterial.emissive.setRGB(this.glow, this.glow * 0.34, this.glow * 0.06);
    this.roofMaterial.emissive.setRGB(this.glow * 0.8, this.glow * 0.22, 0);
  }

  private buildHouse(width: number, depth: number, wallHeight: number, rng: Rng): void {
    const body = new Mesh(new BoxGeometry(width, wallHeight, depth), this.wallMaterial);
    body.position.y = wallHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.intact.add(body);

    const roof = new Mesh(gableRoofGeometry(width + 0.55, depth + 0.55, 1.5), this.roofMaterial);
    roof.position.y = wallHeight;
    roof.castShadow = true;
    this.intact.add(roof);

    const frontZ = depth / 2 + 0.012;
    const door = new Mesh(new BoxGeometry(0.72, 1.25, 0.08), this.trimMaterial);
    door.position.set(0, 0.63, frontZ);
    this.intact.add(door);
    for (const side of [-1, 1]) {
      const window = new Mesh(new BoxGeometry(0.62, 0.58, 0.08), WINDOW);
      window.position.set(side * (width * 0.29), 1.45, frontZ);
      this.intact.add(window);
      const sideWindow = new Mesh(new BoxGeometry(0.08, 0.55, 0.62), WINDOW);
      sideWindow.position.set(side * (width / 2 + 0.01), 1.4, 0.1);
      this.intact.add(sideWindow);
    }
    const chimney = new Mesh(new BoxGeometry(0.36, 1.0, 0.36), BRICK);
    chimney.position.set(width * 0.3, wallHeight + 0.9, -depth * 0.2);
    chimney.castShadow = true;
    this.intact.add(chimney);
    this.addFoundation(width, depth);
    if (rng.next() < 0.6) this.addPorch(width, depth, 0.9, rng);
    if (rng.next() < 0.55) this.addFence(width, depth, rng);
    this.addMailbox(width, depth);
  }

  /** Two-storey farmhouse: tall body, steep gable, front dormer and porch. */
  private buildTwoStory(width: number, depth: number, wallHeight: number, rng: Rng): void {
    this.addBody(width, depth, wallHeight);
    const roof = new Mesh(gableRoofGeometry(width + 0.45, depth + 0.45, 1.7), this.roofMaterial);
    roof.position.y = wallHeight;
    roof.castShadow = true;
    this.intact.add(roof);
    const frontZ = depth / 2 + 0.012;
    const band = new Mesh(new BoxGeometry(width + 0.04, 0.12, depth + 0.04), this.trimMaterial);
    band.position.y = wallHeight * 0.5;
    this.intact.add(band);
    for (const side of [-1, 1]) {
      this.addWindow(side * width * 0.27, 1.0, frontZ, 0.5, 0.62, 'z');
      this.addWindow(side * width * 0.27, 2.55, frontZ, 0.5, 0.62, 'z');
      this.addWindow(side * (width / 2 + 0.01), 2.5, 0, 0.55, 0.6, 'x');
    }
    this.addDoor(0, frontZ, 0.66, 1.25);
    const dormer = new Mesh(new BoxGeometry(0.8, 0.7, 0.7), this.wallMaterial);
    dormer.position.set(0, wallHeight + 0.55, depth * 0.34);
    this.intact.add(dormer);
    const dormerRoof = new Mesh(gableRoofGeometry(0.95, 0.85, 0.42), this.roofMaterial);
    dormerRoof.position.set(0, wallHeight + 0.9, depth * 0.34);
    this.intact.add(dormerRoof);
    this.addWindow(0, wallHeight + 0.55, depth * 0.34 + 0.36, 0.38, 0.4, 'z');
    const chimney = new Mesh(new BoxGeometry(0.34, 1.3, 0.34), BRICK);
    chimney.position.set(-width * 0.32, wallHeight + 1.15, -depth * 0.15);
    chimney.castShadow = true;
    this.intact.add(chimney);
    this.addFoundation(width, depth);
    this.addPorch(width, depth, 1.0, rng);
    if (rng.next() < 0.5) this.addFence(width, depth, rng);
    this.addMailbox(width, depth);
  }

  /** Low ranch house: wide hip roof, attached garage door, picture window. */
  private buildRanch(width: number, depth: number, wallHeight: number, rng: Rng): void {
    this.addBody(width, depth, wallHeight);
    const roof = new Mesh(hipRoofGeometry(width + 0.6, depth + 0.6, 1.0), this.roofMaterial);
    roof.position.y = wallHeight;
    roof.castShadow = true;
    this.intact.add(roof);
    const frontZ = depth / 2 + 0.012;
    const garage = new Mesh(new BoxGeometry(width * 0.32, 1.55, 0.08), GARAGE);
    garage.position.set(width * 0.3, 0.78, frontZ);
    this.intact.add(garage);
    for (let i = 0; i < 3; i += 1) {
      const groove = new Mesh(new BoxGeometry(width * 0.3, 0.04, 0.1), this.trimMaterial);
      groove.position.set(width * 0.3, 0.4 + i * 0.4, frontZ + 0.01);
      this.intact.add(groove);
    }
    const driveway = new Mesh(new BoxGeometry(width * 0.34, 0.04, 1.0), CONCRETE);
    driveway.position.set(width * 0.3, 0.02, depth / 2 + 0.5);
    driveway.receiveShadow = true;
    this.intact.add(driveway);
    this.addWindow(-width * 0.22, 1.2, frontZ, 1.2, 0.7, 'z');
    this.addDoor(0, frontZ, 0.62, 1.2);
    this.addWindow(-(width / 2 + 0.01), 1.25, 0, 0.6, 0.55, 'x');
    this.addFoundation(width, depth);
    if (rng.next() < 0.65) this.addFence(width, depth, rng);
    this.addMailbox(width, depth);
  }

  /** Western false-front store with an awning, boardwalk and painted sign. */
  private buildStore(width: number, depth: number, wallHeight: number, rng: Rng): void {
    this.addBody(width, depth, wallHeight);
    const roof = new Mesh(new BoxGeometry(width + 0.1, 0.18, depth + 0.1), this.roofMaterial);
    roof.position.y = wallHeight + 0.09;
    this.intact.add(roof);
    const frontZ = depth / 2 + 0.012;
    const parapet = new Mesh(new BoxGeometry(width + 0.2, 1.15, 0.16), this.wallMaterial);
    parapet.position.set(0, wallHeight + 0.5, frontZ - 0.06);
    parapet.castShadow = true;
    this.intact.add(parapet);
    const cap = new Mesh(new BoxGeometry(width + 0.34, 0.1, 0.26), this.trimMaterial);
    cap.position.set(0, wallHeight + 1.1, frontZ - 0.06);
    this.intact.add(cap);
    const names = ['GENERAL STORE', 'CAFE', 'HARDWARE', 'FEED & SUPPLY', 'POST OFFICE', 'DINER'];
    const sign = new Mesh(new PlaneGeometry(width * 0.86, 0.46), signMaterial(rng.pick(names), rng.pick(SIGN_COLORS)));
    sign.position.set(0, wallHeight + 0.55, frontZ + 0.03);
    this.intact.add(sign);
    const awning = new Mesh(new BoxGeometry(width + 0.1, 0.08, 1.0), rng.pick(AWNINGS));
    awning.position.set(0, 2.05, frontZ + 0.48);
    awning.rotation.x = 0.18;
    awning.castShadow = true;
    this.intact.add(awning);
    const boardwalk = new Mesh(new BoxGeometry(width + 0.1, 0.12, 1.05), WOOD);
    boardwalk.position.set(0, 0.06, frontZ + 0.5);
    boardwalk.receiveShadow = true;
    this.intact.add(boardwalk);
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.09, 2.0, 0.09), this.trimMaterial);
      post.position.set(side * (width / 2 - 0.05), 1.0, frontZ + 0.95);
      this.intact.add(post);
      this.addWindow(side * width * 0.26, 1.15, frontZ, 0.62, 0.95, 'z');
    }
    this.addDoor(0, frontZ, 0.6, 1.45);
    const barrel = new Mesh(new CylinderGeometry(0.17, 0.17, 0.42, 8), WOOD);
    barrel.position.set(width * 0.42, 0.33, frontZ + 0.75);
    this.intact.add(barrel);
  }

  /** Small white chapel with a steeple and tall side windows. */
  private buildChapel(width: number, depth: number, wallHeight: number): void {
    this.addBody(width, depth, wallHeight);
    const roof = new Mesh(gableRoofGeometry(width + 0.45, depth + 0.45, 1.6), this.roofMaterial);
    roof.position.y = wallHeight;
    roof.castShadow = true;
    this.intact.add(roof);
    const frontZ = depth / 2 + 0.012;
    const tower = new Mesh(new BoxGeometry(0.9, 1.3, 0.9), this.wallMaterial);
    tower.position.set(0, wallHeight + 0.95, depth * 0.3);
    tower.castShadow = true;
    this.intact.add(tower);
    const belfry = new Mesh(new BoxGeometry(0.6, 0.4, 0.92), BELFRY);
    belfry.position.set(0, wallHeight + 1.25, depth * 0.3);
    this.intact.add(belfry);
    const spire = new Mesh(new ConeGeometry(0.66, 1.9, 4), this.roofMaterial);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(0, wallHeight + 2.55, depth * 0.3);
    spire.castShadow = true;
    this.intact.add(spire);
    const crossV = new Mesh(new BoxGeometry(0.06, 0.42, 0.06), GOLD);
    crossV.position.set(0, wallHeight + 3.7, depth * 0.3);
    const crossH = new Mesh(new BoxGeometry(0.26, 0.06, 0.06), GOLD);
    crossH.position.set(0, wallHeight + 3.78, depth * 0.3);
    this.intact.add(crossV, crossH);
    this.addDoor(0, frontZ, 0.7, 1.55);
    for (const side of [-1, 1]) {
      for (const z of [-0.45, 0.45]) this.addWindow(side * (width / 2 + 0.01), 1.45, z * depth * 0.5, 0.35, 0.9, 'x');
    }
    this.addFoundation(width, depth);
  }

  // ---- shared details -------------------------------------------------

  private addBody(width: number, depth: number, wallHeight: number): void {
    const body = new Mesh(new BoxGeometry(width, wallHeight, depth), this.wallMaterial);
    body.position.y = wallHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.intact.add(body);
  }

  private addFoundation(width: number, depth: number): void {
    const footing = new Mesh(new BoxGeometry(width + 0.08, 0.22, depth + 0.08), CONCRETE);
    footing.position.y = 0.09;
    footing.receiveShadow = true;
    this.intact.add(footing);
  }

  /** A framed, mullioned window on the +z face ('z') or an x face ('x'). */
  private addWindow(x: number, y: number, z: number, w: number, h: number, face: 'x' | 'z'): void {
    const frame = new Mesh(
      face === 'z' ? new BoxGeometry(w + 0.12, h + 0.12, 0.06) : new BoxGeometry(0.06, h + 0.12, w + 0.12),
      this.trimMaterial,
    );
    frame.position.set(x, y, z);
    const glass = new Mesh(face === 'z' ? new BoxGeometry(w, h, 0.08) : new BoxGeometry(0.08, h, w), WINDOW);
    glass.position.set(x, y, z);
    const mullion = new Mesh(face === 'z' ? new BoxGeometry(0.04, h, 0.1) : new BoxGeometry(0.1, h, 0.04), this.trimMaterial);
    mullion.position.set(x, y, z);
    this.intact.add(frame, glass, mullion);
  }

  private addDoor(x: number, z: number, w: number, h: number): void {
    const frame = new Mesh(new BoxGeometry(w + 0.14, h + 0.08, 0.06), this.trimMaterial);
    frame.position.set(x, h / 2 + 0.2, z);
    const door = new Mesh(new BoxGeometry(w, h, 0.08), DOOR);
    door.position.set(x, h / 2 + 0.2, z);
    const knob = new Mesh(new BoxGeometry(0.06, 0.06, 0.12), GOLD);
    knob.position.set(x + w * 0.32, h * 0.5 + 0.2, z + 0.02);
    this.intact.add(frame, door, knob);
  }

  private addPorch(width: number, depth: number, porchDepth: number, rng: Rng): void {
    const frontZ = depth / 2;
    const deck = new Mesh(new BoxGeometry(width * 0.9, 0.16, porchDepth), WOOD);
    deck.position.set(0, 0.16, frontZ + porchDepth / 2);
    deck.receiveShadow = true;
    this.intact.add(deck);
    const roof = new Mesh(new BoxGeometry(width * 0.94, 0.08, porchDepth + 0.15), this.roofMaterial);
    roof.position.set(0, 1.95, frontZ + porchDepth / 2);
    roof.rotation.x = 0.14;
    roof.castShadow = true;
    this.intact.add(roof);
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.08, 1.8, 0.08), this.trimMaterial);
      post.position.set(side * width * 0.42, 1.05, frontZ + porchDepth - 0.06);
      this.intact.add(post);
    }
    const rail = new Mesh(new BoxGeometry(width * 0.86, 0.06, 0.05), this.trimMaterial);
    rail.position.set(0, 0.62, frontZ + porchDepth - 0.06);
    this.intact.add(rail);
    if (rng.next() < 0.5) {
      const chair = new Mesh(new BoxGeometry(0.3, 0.4, 0.3), WOOD);
      chair.position.set(width * 0.24, 0.44, frontZ + porchDepth * 0.5);
      this.intact.add(chair);
    }
  }

  /** Picket or rail fence round the back yard, inside the lot's clearance ring. */
  private addFence(width: number, depth: number, rng: Rng): void {
    const material = rng.next() < 0.6 ? PICKET : WOOD;
    const hw = width / 2 + 0.7;
    const back = -depth / 2 - 0.75;
    const front = depth / 2 - 0.2;
    const runs: Array<[number, number, number, number]> = [
      [-hw, back, hw, back],
      [-hw, back, -hw, front],
      [hw, back, hw, front],
    ];
    for (const [ax, az, bx, bz] of runs) {
      const length = Math.hypot(bx - ax, bz - az);
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const rail = new Mesh(alongX ? new BoxGeometry(length, 0.06, 0.05) : new BoxGeometry(0.05, 0.06, length), material);
      rail.position.set((ax + bx) / 2, 0.42, (az + bz) / 2);
      this.intact.add(rail);
      const posts = Math.max(2, Math.round(length / 0.45));
      for (let i = 0; i <= posts; i += 1) {
        const t = i / posts;
        const picket = new Mesh(PICKET_GEOMETRY, material);
        picket.position.set(ax + (bx - ax) * t, 0.3, az + (bz - az) * t);
        this.intact.add(picket);
      }
    }
  }

  private addMailbox(width: number, depth: number): void {
    const post = new Mesh(new BoxGeometry(0.06, 0.8, 0.06), WOOD);
    post.position.set(width / 2 + 0.25, 0.4, depth / 2 + 0.75);
    const box = new Mesh(new BoxGeometry(0.16, 0.16, 0.32), MAILBOX);
    box.position.set(width / 2 + 0.25, 0.86, depth / 2 + 0.75);
    this.intact.add(post, box);
  }


  private buildBarn(width: number, depth: number, wallHeight: number, rng: Rng): void {
    const body = new Mesh(new BoxGeometry(width, wallHeight, depth), this.wallMaterial);
    body.position.y = wallHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.intact.add(body);

    const roof = new Mesh(gableRoofGeometry(width + 0.75, depth + 0.7, 1.85), this.roofMaterial);
    roof.position.y = wallHeight;
    roof.castShadow = true;
    this.intact.add(roof);

    const frontZ = depth / 2 + 0.012;
    const door = new Mesh(new BoxGeometry(width * 0.52, wallHeight * 0.72, 0.09), this.trimMaterial);
    door.position.set(0, wallHeight * 0.37, frontZ);
    this.intact.add(door);
    for (const side of [-1, 1]) {
      const brace = new Mesh(new BoxGeometry(0.09, wallHeight * 0.68, 0.1), this.roofMaterial);
      brace.rotation.z = side * 0.5;
      brace.position.set(side * width * 0.16, wallHeight * 0.37, frontZ + 0.02);
      this.intact.add(brace);
    }
    const loft = new Mesh(new BoxGeometry(0.62, 0.62, 0.08), WINDOW);
    loft.position.set(0, wallHeight * 0.82, frontZ);
    this.intact.add(loft);
    const doorHeader = new Mesh(new BoxGeometry(width * 0.56, 0.1, 0.11), this.trimMaterial);
    doorHeader.position.set(0, wallHeight * 0.73, frontZ + 0.02);
    this.intact.add(doorHeader);
    if (rng.next() < 0.6) {
      // Grain silo with a domed cap.
      const silo = new Mesh(new CylinderGeometry(0.62, 0.62, wallHeight + 1.6, 12), SILO);
      silo.position.set(-width / 2 - 0.55, (wallHeight + 1.6) / 2, -depth * 0.15);
      silo.castShadow = true;
      const dome = new Mesh(new SphereGeometry(0.63, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), SILO_CAP);
      dome.position.set(-width / 2 - 0.55, wallHeight + 1.6, -depth * 0.15);
      this.intact.add(silo, dome);
    } else {
      for (let i = 0; i < 3; i += 1) {
        const bale = new Mesh(new CylinderGeometry(0.32, 0.32, 0.5, 10), HAY);
        bale.rotation.z = Math.PI / 2;
        bale.position.set(width / 2 + 0.45, 0.32, -depth * 0.3 + i * 0.66);
        bale.castShadow = true;
        this.intact.add(bale);
      }
    }
  }


  private buildCabin(width: number, depth: number, wallHeight: number, rng: Rng): void {
    const body = new Mesh(new BoxGeometry(width, wallHeight, depth), this.wallMaterial);
    body.position.y = wallHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.intact.add(body);

    const roof = new Mesh(gableRoofGeometry(width + 0.65, depth + 0.8, 1.35), this.roofMaterial);
    roof.position.y = wallHeight;
    roof.castShadow = true;
    this.intact.add(roof);

    const deck = new Mesh(new BoxGeometry(width * 0.82, 0.18, 0.9), this.trimMaterial);
    deck.position.set(0, 0.09, depth / 2 + 0.45);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.intact.add(deck);
    const frontZ = depth / 2 + 0.012;
    const door = new Mesh(new BoxGeometry(0.66, 1.2, 0.08), this.trimMaterial);
    door.position.set(0, 0.72, frontZ);
    this.intact.add(door);
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.1, 2.15, 0.1), this.trimMaterial);
      post.position.set(side * (width * 0.32), 1.08, depth / 2 + 0.86);
      this.intact.add(post);
    }
    const window = new Mesh(new BoxGeometry(0.55, 0.5, 0.08), WINDOW);
    window.position.set(0, 1.5, frontZ);
    this.intact.add(window);
    // Log courses along the sides, a stone chimney, maybe a woodpile.
    for (let i = 1; i < 6; i += 1) {
      for (const side of [-1, 1]) {
        const log = new Mesh(LOG_GEOMETRY, LOG);
        log.scale.y = depth + 0.2;
        log.rotation.x = Math.PI / 2;
        log.position.set(side * (width / 2 + 0.03), (i * wallHeight) / 6, 0);
        this.intact.add(log);
      }
    }
    const chimney = new Mesh(new BoxGeometry(0.5, wallHeight + 1.5, 0.5), STONE);
    chimney.position.set(width / 2 + 0.2, (wallHeight + 1.5) / 2, -depth * 0.15);
    chimney.castShadow = true;
    this.intact.add(chimney);
    if (rng.next() < 0.6) {
      const woodpile = new Mesh(new BoxGeometry(0.9, 0.45, 0.4), LOG);
      woodpile.position.set(-width / 2 - 0.4, 0.23, -depth * 0.2);
      this.intact.add(woodpile);
    }
  }


  private buildStation(width: number, depth: number, wallHeight: number): void {
    const body = new Mesh(new BoxGeometry(width, wallHeight, depth), this.wallMaterial);
    body.position.y = wallHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.intact.add(body);

    const roof = new Mesh(new BoxGeometry(width + 0.45, 0.3, depth + 0.45), this.roofMaterial);
    roof.position.y = wallHeight + 0.15;
    roof.castShadow = true;
    this.intact.add(roof);

    const frontZ = depth / 2 + 0.012;
    for (const side of [-1, 1]) {
      const bay = new Mesh(new BoxGeometry(1.08, 2.3, 0.09), this.roofMaterial);
      bay.position.set(side * 0.68, 1.15, frontZ);
      this.intact.add(bay);
      const bayTrim = new Mesh(new BoxGeometry(1.2, 0.09, 0.11), this.trimMaterial);
      bayTrim.position.set(side * 0.68, 2.33, frontZ + 0.03);
      this.intact.add(bayTrim);
    }
    const lamp = new Mesh(new BoxGeometry(0.36, 0.14, 0.12), new MeshStandardMaterial({
      color: 0xffd27a,
      emissive: 0xff9c2c,
      emissiveIntensity: 1.1,
      roughness: 0.4,
    }));
    lamp.position.set(0, wallHeight * 0.72, frontZ + 0.09);
    this.intact.add(lamp);

    const signTexture = makeSignTexture('STATION 7');
    const signMaterial = new MeshStandardMaterial({ map: signTexture, transparent: true, roughness: 0.8 });
    const sign = new Mesh(new PlaneGeometry(2.5, 0.52), signMaterial);
    sign.position.set(0, wallHeight + 0.52, frontZ);
    this.intact.add(sign);

    const flagPole = new Mesh(new BoxGeometry(0.08, 2.2, 0.08), this.trimMaterial);
    flagPole.position.set(-width / 2 + 0.35, 1.1, -depth / 2 + 0.25);
    this.intact.add(flagPole);
    const flag = new Mesh(new BoxGeometry(0.72, 0.42, 0.04), this.trimMaterial);
    flag.position.set(-width / 2 + 0.72, 1.95, -depth / 2 + 0.25);
    this.intact.add(flag);
  }

  private buildRubble(width: number, depth: number, wallHeight: number): void {
    const charred = new MeshStandardMaterial({ color: 0x2a2622, roughness: 1, flatShading: true });
    const pile = new Mesh(new BoxGeometry(width * 0.92, 0.42, depth * 0.9), charred);
    pile.position.y = 0.21;
    pile.castShadow = true;
    this.destroyed.add(pile);
    for (let i = 0; i < 4; i += 1) {
      const x = ((hash2(i, this.building.id, this.building.id * 7 + 1) / 0xffffffff) - 0.5) * width * 0.7;
      const z = ((hash2(i + 11, this.building.id, this.building.id * 13 + 3) / 0xffffffff) - 0.5) * depth * 0.7;
      const beam = new Mesh(new BoxGeometry(0.16, wallHeight * 0.22, 0.16), charred);
      beam.position.set(x, 0.35, z);
      beam.rotation.set(i * 0.4, i * 1.1, i * 0.3);
      this.destroyed.add(beam);
    }
  }
}

function paletteFor(kind: BuildingKind, seed: number): { wall: number; roof: number; trim: number } {
  const shift = hash2(seed, kind.length, seed ^ 0x99) % 3;
  if (kind === 'station') return { wall: 0xd9d3bd, roof: 0x7c2f27, trim: 0xf0e6cc };
  if (kind === 'barn') return { wall: 0x8e3f31, roof: 0x4a312b, trim: 0xe8dcc1 };
  if (kind === 'cabin') return { wall: 0x7a5638, roof: 0x3e332c, trim: 0xa9855e };
  if (kind === 'chapel') return { wall: 0xeee8da, roof: 0x55606a, trim: 0xfaf6ec };
  if (kind === 'store') {
    const fronts = [0xb8865a, 0x8f6b4a, 0xc9b28a, 0x7f8f88, 0xa9654b];
    return { wall: fronts[shift % fronts.length] as number, roof: 0x4b4743, trim: 0xefe4ca };
  }
  const walls = [0xb9a47c, 0xc4a883, 0xa8b09b, 0xc79b7b, 0x9fafb2];
  const roofs = [0x5b4438, 0x6e3f36, 0x4e4e4e, 0x75593f];
  return {
    wall: walls[shift % walls.length] as number,
    roof: roofs[(shift + 1) % roofs.length] as number,
    trim: 0xe4dbc6,
  };
}

function gableRoofGeometry(width: number, depth: number, height: number): BufferGeometry {
  const hw = width / 2;
  const hd = depth / 2;
  const positions: number[] = [];
  const push = (x: number, y: number, z: number) => positions.push(x, y, z);
  // Front slope
  push(-hw, 0, hd);
  push(hw, 0, hd);
  push(hw, height, 0);
  push(-hw, 0, hd);
  push(hw, height, 0);
  push(-hw, height, 0);
  // Back slope
  push(hw, 0, -hd);
  push(-hw, 0, -hd);
  push(-hw, height, 0);
  push(hw, 0, -hd);
  push(-hw, height, 0);
  push(hw, height, 0);
  // Left gable
  push(-hw, 0, -hd);
  push(-hw, 0, hd);
  push(-hw, height, 0);
  // Right gable
  push(hw, 0, hd);
  push(hw, 0, -hd);
  push(hw, height, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeSignTexture(text: string, background = '#7c2f27'): CanvasTexture {
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

  // Water tower serving the helipad: four splayed legs, banded tank, cone cap.
  const tower = new Group();
  // Clear of both aircraft parking spots (helicopter -x/+z, tanker +x/-z).
  tower.position.set(center.x - 4.2, y, center.z - 3.2);
  const steel = standard(0x6f7d78, 0.6);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const leg = new Mesh(new BoxGeometry(0.09, 3.2, 0.09), steel);
    leg.position.set(sx * 0.48, 1.6, sz * 0.48);
    leg.rotation.set(sz * 0.08, 0, -sx * 0.08);
    tower.add(leg);
  }
  const tankBody = new Mesh(new CylinderGeometry(0.8, 0.8, 1.3, 12), standard(0x8c9a93, 0.5));
  tankBody.position.y = 3.75;
  tankBody.castShadow = true;
  const band = new Mesh(new CylinderGeometry(0.82, 0.82, 0.1, 12), steel);
  band.position.y = 3.5;
  const cap = new Mesh(new ConeGeometry(0.88, 0.55, 12), steel);
  cap.position.y = 4.67;
  cap.castShadow = true;
  tower.add(tankBody, band, cap);
  group.add(tower);
  return group;
}

/** Four-sided hip roof: ridge along x, inset from the gable ends. */
function hipRoofGeometry(width: number, depth: number, height: number): BufferGeometry {
  const hw = width / 2;
  const hd = depth / 2;
  const ridge = Math.max(0.05, hw - hd);
  const positions: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
  const fl = [-hw, 0, hd];
  const fr = [hw, 0, hd];
  const bl = [-hw, 0, -hd];
  const br = [hw, 0, -hd];
  const rl = [-ridge, height, 0];
  const rr = [ridge, height, 0];
  tri(fl, fr, rr);
  tri(fl, rr, rl);
  tri(br, bl, rl);
  tri(br, rl, rr);
  tri(bl, fl, rl);
  tri(fr, br, rr);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
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
  const group = new Group();
  group.name = 'fire-lookout';
  group.position.set(center.x, heightmap.tileMinHeight(site.x, site.z), center.z);
  const timber = standard(0x7a5a3c, 0.9);
  const legHeight = 6.2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const leg = new Mesh(new BoxGeometry(0.14, legHeight + 0.3, 0.14), timber);
    leg.position.set(sx * 0.62, legHeight / 2, sz * 0.62);
    leg.rotation.set(sz * 0.07, 0, -sx * 0.07);
    leg.castShadow = true;
    group.add(leg);
  }
  for (const y of [1.6, 3.3, 5.0]) {
    for (const [w, d, ox, oz] of [[1.3, 0.06, 0, 0.6], [1.3, 0.06, 0, -0.6], [0.06, 1.3, 0.6, 0], [0.06, 1.3, -0.6, 0]] as const) {
      const brace = new Mesh(new BoxGeometry(w * (1 - y / 30), 0.07, d * (1 - y / 30)), timber);
      brace.position.set(ox * (1 - y / 30), y, oz * (1 - y / 30));
      group.add(brace);
    }
  }
  const deck = new Mesh(new BoxGeometry(2.2, 0.12, 2.2), timber);
  deck.position.y = legHeight;
  deck.castShadow = true;
  const cab = new Mesh(new BoxGeometry(1.5, 1.15, 1.5), standard(0xd9cfb4));
  cab.position.y = legHeight + 0.64;
  cab.castShadow = true;
  const glass = new Mesh(new BoxGeometry(1.54, 0.5, 1.54), WINDOW);
  glass.position.y = legHeight + 0.82;
  const roof = new Mesh(new ConeGeometry(1.3, 0.75, 4), standard(0x5b3b2e));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = legHeight + 1.58;
  roof.castShadow = true;
  for (const [w, d, ox, oz] of [[2.2, 0.05, 0, 1.08], [2.2, 0.05, 0, -1.08], [0.05, 2.2, 1.08, 0], [0.05, 2.2, -1.08, 0]] as const) {
    const rail = new Mesh(new BoxGeometry(w, 0.05, d), timber);
    rail.position.set(ox, legHeight + 0.5, oz);
    group.add(rail);
  }
  group.add(deck, cab, glass, roof);
  const antenna = new Mesh(new CylinderGeometry(0.02, 0.02, 1.1, 4), standard(0x3a3a3a, 0.5));
  antenna.position.set(0.3, legHeight + 2.3, 0.3);
  group.add(antenna);
  return group;
}
