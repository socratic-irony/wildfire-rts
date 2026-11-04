import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CanvasTexture,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { hash2, Rng } from '../core/rng';
import { clamp } from '../core/math';
import { GRID_SIZE, TILE_SIZE, tileIndex, tileToWorld } from './constants';
import { Heightmap, TOWN_CENTER } from './heightmap';
import { BiomeMap, Terrain } from './biomes';
import { RoadNetwork } from './roads';

export type BuildingKind = 'house' | 'barn' | 'cabin' | 'station';
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
export const HELIPAD_CENTER = { x: 56, z: 47 };
export const HELIPAD_SIZE = 3;
export const STATION_FOOTPRINT = { x0: 50, z0: 46, w: 3, d: 2 };

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
    for (let dz = 0; dz < HELIPAD_SIZE; dz += 1) {
      for (let dx = 0; dx < HELIPAD_SIZE; dx += 1) {
        for (let ringZ = -1; ringZ <= 1; ringZ += 1) {
          for (let ringX = -1; ringX <= 1; ringX += 1) {
            const tx = HELIPAD_CENTER.x + dx + ringX - 1;
            const tz = HELIPAD_CENTER.z + dz + ringZ - 1;
            if (tx >= 0 && tz >= 0 && tx < GRID_SIZE && tz < GRID_SIZE) {
              this.occupied[tileIndex(tx, tz)] = 1;
            }
          }
        }
      }
    }
  }

  private placeStation(): void {
    const { x0, z0, w, d } = STATION_FOOTPRINT;
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
    const distanceToTown = Math.hypot(roadX - TOWN_CENTER.x, roadZ - TOWN_CENTER.z);
    const roll = rng.next();
    let kind: BuildingKind = 'house';
    if (distanceToTown > 21 && roll < 0.52) kind = 'cabin';
    else if (roll < 0.18) kind = 'barn';
    const facadeW = kind === 'barn' ? 3 : 2;
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
    let score = rng.range(0, 12) + (kind === 'house' ? 4 : 0);
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
  }
}

function standard(color: number, roughness = 0.88): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
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
    const depth = building.depth * TILE_SIZE;
    const wallHeight = building.kind === 'barn' ? 3.15 : building.kind === 'station' ? 3.3 : 2.35;
    if (building.kind === 'station') {
      this.buildStation(width, depth, wallHeight);
    } else if (building.kind === 'barn') {
      this.buildBarn(width, depth, wallHeight);
    } else if (building.kind === 'cabin') {
      this.buildCabin(width, depth, wallHeight);
    } else {
      this.buildHouse(width, depth, wallHeight);
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

  private buildHouse(width: number, depth: number, wallHeight: number): void {
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
      const window = new Mesh(new BoxGeometry(0.62, 0.58, 0.08), windowMaterial());
      window.position.set(side * (width * 0.29), 1.45, frontZ);
      this.intact.add(window);
      const sideWindow = new Mesh(new BoxGeometry(0.08, 0.55, 0.62), windowMaterial());
      sideWindow.position.set(side * (width / 2 + 0.01), 1.4, 0.1);
      this.intact.add(sideWindow);
    }
    const chimney = new Mesh(new BoxGeometry(0.36, 1.0, 0.36), this.trimMaterial);
    chimney.position.set(width * 0.3, wallHeight + 0.9, -depth * 0.2);
    chimney.castShadow = true;
    this.intact.add(chimney);
  }

  private buildBarn(width: number, depth: number, wallHeight: number): void {
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
    const loft = new Mesh(new BoxGeometry(0.62, 0.62, 0.08), windowMaterial());
    loft.position.set(0, wallHeight * 0.82, frontZ);
    this.intact.add(loft);
  }

  private buildCabin(width: number, depth: number, wallHeight: number): void {
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
    const window = new Mesh(new BoxGeometry(0.55, 0.5, 0.08), windowMaterial());
    window.position.set(0, 1.5, frontZ);
    this.intact.add(window);
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

function windowMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0x364a57,
    emissive: 0x283b44,
    emissiveIntensity: 0.25,
    roughness: 0.32,
    metalness: 0.05,
  });
}

function paletteFor(kind: BuildingKind, seed: number): { wall: number; roof: number; trim: number } {
  const shift = hash2(seed, kind.length, seed ^ 0x99) % 3;
  if (kind === 'station') return { wall: 0xd9d3bd, roof: 0x7c2f27, trim: 0xf0e6cc };
  if (kind === 'barn') return { wall: 0x8e3f31, roof: 0x4a312b, trim: 0xe8dcc1 };
  if (kind === 'cabin') return { wall: 0x7a5638, roof: 0x3e332c, trim: 0xa9855e };
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

function makeSignTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#7c2f27';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#f0e6cc';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    ctx.fillStyle = '#f7efdc';
    ctx.font = 'bold 58px Georgia, serif';
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
  const center = tileToWorld(HELIPAD_CENTER.x, HELIPAD_CENTER.z);
  const y = heightmap.tileHeight(HELIPAD_CENTER.x, HELIPAD_CENTER.z);
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

  const tank = new Mesh(
    new BoxGeometry(0.9, 1.6, 0.9),
    new MeshStandardMaterial({ color: 0x7f8d84, roughness: 0.75, metalness: 0.25 }),
  );
  tank.position.set(center.x + 3.7, y + 0.8, center.z - 2.3);
  tank.castShadow = true;
  group.add(tank);
  return group;
}
