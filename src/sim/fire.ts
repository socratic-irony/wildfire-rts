import { clamp } from '../core/math';
import { hash01_3, hash2 } from '../core/rng';
import { GRID_SIZE, NEIGHBOR_8, TILE_SIZE, tileIndex } from '../world/constants';
import { BiomeMap, Terrain } from '../world/biomes';
import { Heightmap } from '../world/heightmap';

export enum FireState {
  Unburned = 0,
  Igniting = 1,
  Burning = 2,
  Smoldering = 3,
  Burned = 4,
  Cleared = 5,
}

export enum Fuel {
  Grass = 0,
  Brush = 1,
  Forest = 2,
  Urban = 3,
  Rock = 4,
  Water = 5,
  Road = 6,
}

export interface FuelProfile {
  name: string;
  baseROS: number;
  flameDuration: number;
  smolderDuration: number;
  moistureDamp: number;
  slopeFactor: number;
  windFactor: number;
  ignitionDelay: number;
  spotChance: number;
}

export const FUELS: Record<Fuel, FuelProfile> = {
  [Fuel.Grass]: {
    name: 'Grass',
    baseROS: 0.62,
    flameDuration: 13,
    smolderDuration: 8,
    moistureDamp: 0.55,
    slopeFactor: 1.3,
    windFactor: 0.14,
    ignitionDelay: 0.55,
    spotChance: 0.0007,
  },
  [Fuel.Brush]: {
    name: 'Chaparral',
    baseROS: 0.36,
    flameDuration: 26,
    smolderDuration: 13,
    moistureDamp: 0.65,
    slopeFactor: 1.55,
    windFactor: 0.11,
    ignitionDelay: 0.75,
    spotChance: 0.0012,
  },
  [Fuel.Forest]: {
    name: 'Timber',
    baseROS: 0.24,
    flameDuration: 38,
    smolderDuration: 18,
    moistureDamp: 0.72,
    slopeFactor: 1.8,
    windFactor: 0.09,
    ignitionDelay: 0.9,
    spotChance: 0.0016,
  },
  [Fuel.Urban]: {
    name: 'Structure',
    baseROS: 0.19,
    flameDuration: 30,
    smolderDuration: 15,
    moistureDamp: 0.55,
    slopeFactor: 0.8,
    windFactor: 0.07,
    ignitionDelay: 0.8,
    spotChance: 0.0005,
  },
  [Fuel.Rock]: {
    name: 'Rock',
    baseROS: 0,
    flameDuration: 0,
    smolderDuration: 0,
    moistureDamp: 0,
    slopeFactor: 0,
    windFactor: 0,
    ignitionDelay: 0,
    spotChance: 0,
  },
  [Fuel.Water]: {
    name: 'Water',
    baseROS: 0,
    flameDuration: 0,
    smolderDuration: 0,
    moistureDamp: 0,
    slopeFactor: 0,
    windFactor: 0,
    ignitionDelay: 0,
    spotChance: 0,
  },
  [Fuel.Road]: {
    name: 'Asphalt',
    baseROS: 0,
    flameDuration: 0,
    smolderDuration: 0,
    moistureDamp: 0,
    slopeFactor: 0,
    windFactor: 0,
    ignitionDelay: 0,
    spotChance: 0,
  },
};

export interface FireEnv {
  windDirRad: number;
  windSpeed: number;
  humidity: number;
}

export interface IgnitionEvent {
  tx: number;
  tz: number;
  spot: boolean;
}

export interface FireStats {
  active: number;
  burning: number;
  igniting: number;
  smoldering: number;
  burned: number;
  cleared: number;
  burnedHectares: number;
}

export interface FireOptions {
  roadMask?: Uint8Array;
  structureAt?: Int16Array;
  seed?: number;
}

const FIXED_STEP = 0.2;
const MAX_STEPS = 12;
/**
 * Global rate-of-spread scale. Terrace banks carry fuel (they used to be
 * classed as bare rock, which turned every slope into a free firebreak), so
 * the base rates are trimmed to keep a single start containable.
 */
const SPREAD_SCALE = 0.35;
/** Ember spotting scale; spotting grows with fire size, so it dominates late growth. */
const SPOT_SCALE = 0.3;
/** Fire backing downhill spreads slower: 1 / (1 + k · slope · downhill). */
const DOWNSLOPE_DAMPING = 0.9;

export class Wildfire {
  readonly state = new Uint8Array(GRID_SIZE * GRID_SIZE);
  readonly heat = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly progress = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly wetness = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly retardant = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly lineStrength = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly fuel = new Uint8Array(GRID_SIZE * GRID_SIZE);
  readonly fuelMoisture = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly slopeTan = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly gradientX = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly gradientZ = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly ignitionTimer = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly retreatTimer = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly seed: number;
  env: FireEnv = { windDirRad: Math.PI * 1.35, windSpeed: 5.5, humidity: 0.28 };
  simTime = 0;
  private accumulator = 0;
  private stepIndex = 0;
  private readonly events: IgnitionEvent[] = [];
  private eventCursor = 0;

  constructor(
    heightmap: Heightmap,
    biomes: BiomeMap,
    options: FireOptions = {},
  ) {
    this.seed = options.seed ?? heightmap.seed;
    const roadMask = options.roadMask;
    const structureAt = options.structureAt;
    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        const terrain = (biomes.types[index] ?? Terrain.Grass) as Terrain;
        const [h00, h10, h01, h11] = heightmap.cornerHeights(tx, tz);
        this.slopeTan[index] = heightmap.slopeTan(tx, tz);
        this.gradientX[index] = (h10 + h11 - h00 - h01) / (2 * TILE_SIZE);
        this.gradientZ[index] = (h01 + h11 - h00 - h10) / (2 * TILE_SIZE);
        const isRoad = roadMask ? roadMask[index] === 1 : false;
        const isStructure = structureAt ? (structureAt[index] ?? -1) >= 0 : false;
        let fuel: Fuel;
        if (isRoad) fuel = Fuel.Road;
        else if (isStructure) fuel = Fuel.Urban;
        else fuel = terrainToFuel(terrain);
        this.fuel[index] = fuel;
        const biomeMoisture = biomes.moisture[index] ?? 0.25;
        this.fuelMoisture[index] = clamp(0.08 + biomeMoisture * 0.52, 0.05, 0.7);
      }
    }
  }

  /** Re-read slopes after the terrain was regraded (new road cuts). */
  refreshTerrain(heightmap: Heightmap): void {
    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        const [h00, h10, h01, h11] = heightmap.cornerHeights(tx, tz);
        this.slopeTan[index] = heightmap.slopeTan(tx, tz);
        this.gradientX[index] = (h10 + h11 - h00 - h01) / (2 * TILE_SIZE);
        this.gradientZ[index] = (h01 + h11 - h00 - h10) / (2 * TILE_SIZE);
      }
    }
  }

  refreshRoadMask(roadMask: Uint8Array): void {
    for (let i = 0; i < this.fuel.length; i += 1) {
      if (roadMask[i] === 1) {
        this.fuel[i] = Fuel.Road;
        const state = this.state[i] ?? FireState.Unburned;
        if (state === FireState.Burning || state === FireState.Igniting || state === FireState.Smoldering) {
          this.state[i] = FireState.Cleared;
          this.heat[i] = 0;
          this.progress[i] = 1;
        }
      }
    }
  }

  setWind(directionRad: number, speed: number): void {
    this.env.windDirRad = directionRad;
    this.env.windSpeed = Math.max(0, speed);
  }

  get windVector(): { x: number; z: number } {
    return {
      x: Math.sin(this.env.windDirRad) * this.env.windSpeed,
      z: Math.cos(this.env.windDirRad) * this.env.windSpeed,
    };
  }

  ignite(tx: number, tz: number, spot = false): boolean {
    if (tx < 0 || tz < 0 || tx >= GRID_SIZE || tz >= GRID_SIZE) return false;
    const index = tileIndex(tx, tz);
    return this.igniteIndex(index, spot);
  }

  step(dt: number): IgnitionEvent[] {
    this.eventCursor = 0;
    this.accumulator += Math.min(dt, 0.4);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
      this.tick(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    return this.events.slice(0, this.eventCursor);
  }

  tick(dt: number): void {
    this.simTime += dt;
    this.stepIndex += 1;
    const wind = this.windVector;
    const windDirLength = Math.hypot(wind.x, wind.z);
    const windX = windDirLength > 0 ? wind.x / windDirLength : 0;
    const windZ = windDirLength > 0 ? wind.z / windDirLength : 1;

    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        this.wetness[index] = Math.max(0, (this.wetness[index] ?? 0) * Math.exp(-dt / 110));
        this.retardant[index] = Math.max(0, (this.retardant[index] ?? 0) * Math.exp(-dt / 620));
        const state = this.state[index] ?? FireState.Unburned;
        if (state === FireState.Igniting) {
          this.ignitionTimer[index] = (this.ignitionTimer[index] ?? 0) + dt;
          const fuel = FUELS[(this.fuel[index] ?? Fuel.Grass) as Fuel];
          if ((this.ignitionTimer[index] ?? 0) >= fuel.ignitionDelay) {
            this.state[index] = FireState.Burning;
            this.heat[index] = Math.max(0.12, this.heat[index] ?? 0);
          }
        } else if (state === FireState.Burning) {
          this.updateBurning(index, dt, windX, windZ, windDirLength);
        } else if (state === FireState.Smoldering) {
          const fuel = FUELS[(this.fuel[index] ?? Fuel.Grass) as Fuel];
          this.heat[index] = Math.max(0, (this.heat[index] ?? 0) - dt / Math.max(2, fuel.smolderDuration));
          if ((this.heat[index] ?? 0) <= 0.015) {
            this.state[index] = FireState.Burned;
            this.heat[index] = 0;
          }
        }
      }
    }
  }

  private updateBurning(index: number, dt: number, windX: number, windZ: number, windSpeed: number): void {
    const fuelType = this.fuel[index] ?? Fuel.Grass;
    const fuel = FUELS[fuelType as Fuel];
    if (fuel.baseROS <= 0) {
      this.state[index] = FireState.Burned;
      return;
    }
    const heat = this.heat[index] ?? 0;
    this.heat[index] = clamp(heat + (1 - heat) * (dt / 1.7), 0, 1);
    this.progress[index] = clamp((this.progress[index] ?? 0) + ((this.heat[index] ?? 0) * dt) / fuel.flameDuration, 0, 1);
    if ((this.progress[index] ?? 0) >= 1) {
      this.state[index] = FireState.Smoldering;
      this.heat[index] = Math.min(0.82, this.heat[index] ?? 0.82);
      return;
    }

    const tx = index % GRID_SIZE;
    const tz = Math.floor(index / GRID_SIZE);
    for (const [dx, dz] of NEIGHBOR_8) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE) continue;
      const neighbor = tileIndex(nx, nz);
      if (this.state[neighbor] !== FireState.Unburned) continue;
      const neighborFuelType = (this.fuel[neighbor] ?? Fuel.Grass) as Fuel;
      const neighborFuel = FUELS[neighborFuelType];
      if (neighborFuel.baseROS <= 0) continue;
      const directionLength = Math.hypot(dx, dz);
      const dirX = dx / directionLength;
      const dirZ = dz / directionLength;

      const windDot = dirX * windX + dirZ * windZ;
      const gradientLength = Math.hypot(this.gradientX[index] ?? 0, this.gradientZ[index] ?? 0);
      const upSlopeDot =
        gradientLength > 0.0001
          ? (dirX * (this.gradientX[index] ?? 0) + dirZ * (this.gradientZ[index] ?? 0)) / gradientLength
          : 0;
      const windMult = 1 + fuel.windFactor * windSpeed * Math.max(0, windDot) * 1.25;
      const slope = this.slopeTan[index] ?? 0;
      const slopeMult =
        upSlopeDot >= 0
          ? 1 + fuel.slopeFactor * slope * upSlopeDot
          : 1 / (1 + DOWNSLOPE_DAMPING * slope * -upSlopeDot);
      const effectiveMoisture = clamp(
        (this.fuelMoisture[index] ?? 0.2) + (this.wetness[neighbor] ?? 0) + (this.retardant[neighbor] ?? 0) * 0.62,
        0,
        1,
      );
      const moistureMult = clamp(1 - fuel.moistureDamp * effectiveMoisture, 0.045, 1);
      let ros = fuel.baseROS * SPREAD_SCALE * windMult * slopeMult * moistureMult;
      if (fuelType === Fuel.Grass && (this.progress[index] ?? 0) > 0.75) ros *= 0.7;
      const advance = ros * dt;
      let probability = clamp(advance / TILE_SIZE, 0, 1);
      const headBias = 0.55 + 0.45 * Math.max(0, windDot);
      probability *= headBias;

      let barrier = 1 - clamp((this.lineStrength[neighbor] ?? 0), 0, 1);
      const neighborRetardant = this.retardant[neighbor] ?? 0;
      probability *= 1 - clamp(neighborRetardant, 0, 0.95);
      const neighborWetness = this.wetness[neighbor] ?? 0;
      if (neighborWetness > 0.5) probability *= 0.05;
      else if (neighborWetness > 0.2) probability *= 0.35;
      if ((this.heat[index] ?? 0) > 0.86) barrier = Math.max(barrier, 0.16);
      probability *= barrier;
      probability = clamp(probability, 0, 0.55);
      if (probability <= 0) continue;
      const roll = hash01_3(index, neighbor + 1, this.stepIndex, this.seed ^ 0x9e3779b9);
      if (roll < probability) this.igniteIndex(neighbor, false);
    }

    if (windSpeed > 2.5 && fuel.spotChance > 0) {
      const spotRoll = hash01_3(index, this.stepIndex + 17, 91, this.seed ^ 0x51ed270b);
      const chance = fuel.spotChance * SPOT_SCALE * (this.heat[index] ?? 0) * (0.45 + windSpeed / 10);
      if (spotRoll < chance) this.trySpot(index, windX, windZ, windSpeed);
    }
  }

  private trySpot(index: number, windX: number, windZ: number, windSpeed: number): void {
    const tx = index % GRID_SIZE;
    const tz = Math.floor(index / GRID_SIZE);
    const spread = 5 + Math.min(13, windSpeed * 0.85);
    const distance = 4 + hash2(index, this.stepIndex, this.seed + 3) % Math.floor(spread);
    const jitter = (hash01_3(index, this.stepIndex, 3, this.seed + 71) - 0.5) * 0.7;
    const jitterX = Math.cos(this.env.windDirRad) * jitter;
    const jitterZ = -Math.sin(this.env.windDirRad) * jitter;
    const sx = Math.round(tx + windX * distance + jitterX);
    const sz = Math.round(tz + windZ * distance + jitterZ);
    if (sx < 0 || sz < 0 || sx >= GRID_SIZE || sz >= GRID_SIZE) return;
    const spotIndex = tileIndex(sx, sz);
    if (this.state[spotIndex] !== FireState.Unburned) return;
    const fuel = FUELS[(this.fuel[spotIndex] ?? Fuel.Grass) as Fuel];
    if (fuel.baseROS <= 0) return;
    const landingMoisture = clamp(
      (this.fuelMoisture[spotIndex] ?? 0.2) + (this.wetness[spotIndex] ?? 0) + (this.retardant[spotIndex] ?? 0) * 0.5,
      0,
      1,
    );
    if (landingMoisture > 0.62) return;
    const roll = hash01_3(spotIndex, this.stepIndex, 1, this.seed + 449);
    if (roll < 0.32 * (1 - landingMoisture)) {
      this.igniteIndex(spotIndex, true);
    }
  }

  private igniteIndex(index: number, spot: boolean): boolean {
    if (this.state[index] !== FireState.Unburned && this.state[index] !== FireState.Burned) return false;
    if (this.state[index] === FireState.Burned) return false;
    const fuel = this.fuel[index] ?? Fuel.Grass;
    if (FUELS[fuel as Fuel].baseROS <= 0) return false;
    if ((this.wetness[index] ?? 0) > 0.62) return false;
    this.state[index] = FireState.Igniting;
    this.heat[index] = Math.max(0.06, this.heat[index] ?? 0);
    this.progress[index] = 0;
    this.ignitionTimer[index] = 0;
    if (spot) {
      this.events[this.eventCursor] = {
        tx: index % GRID_SIZE,
        tz: Math.floor(index / GRID_SIZE),
        spot: true,
      };
      this.eventCursor += 1;
    }
    return true;
  }

  applyWater(worldX: number, worldZ: number, radiusWorld: number, power: number, dt: number): number {
    const centerTx = worldX / TILE_SIZE - 0.5;
    const centerTz = worldZ / TILE_SIZE - 0.5;
    const radiusTiles = radiusWorld / TILE_SIZE;
    const minX = Math.max(0, Math.floor(centerTx - radiusTiles));
    const maxX = Math.min(GRID_SIZE - 1, Math.ceil(centerTx + radiusTiles));
    const minZ = Math.max(0, Math.floor(centerTz - radiusTiles));
    const maxZ = Math.min(GRID_SIZE - 1, Math.ceil(centerTz + radiusTiles));
    let extinguished = 0;
    for (let tz = minZ; tz <= maxZ; tz += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        const dist = Math.hypot(tx - centerTx, tz - centerTz);
        if (dist > radiusTiles) continue;
        const falloff = 1 - dist / radiusTiles;
        const index = tileIndex(tx, tz);
        this.wetness[index] = clamp((this.wetness[index] ?? 0) + power * dt * 0.55 * falloff, 0, 1);
        const state = this.state[index] ?? FireState.Unburned;
        if (state === FireState.Burning || state === FireState.Igniting || state === FireState.Smoldering) {
          const before = this.heat[index] ?? 0;
          const next = Math.max(0, before - power * dt * 0.85 * falloff);
          this.heat[index] = next;
          if (state === FireState.Igniting && (this.wetness[index] ?? 0) > 0.5) {
            this.state[index] = FireState.Unburned;
            this.ignitionTimer[index] = 0;
          } else if (state === FireState.Burning && next < 0.1) {
            this.state[index] = FireState.Smoldering;
            extinguished += 1;
          } else if (state === FireState.Smoldering && next < 0.02) {
            this.state[index] = FireState.Burned;
            extinguished += 1;
          }
        }
      }
    }
    return extinguished;
  }

  applyRetardantLine(ax: number, az: number, bx: number, bz: number, widthWorld: number, strength: number): void {
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) / TILE_SIZE - widthWorld / TILE_SIZE - 1));
    const maxX = Math.min(GRID_SIZE - 1, Math.ceil(Math.max(ax, bx) / TILE_SIZE + widthWorld / TILE_SIZE + 1));
    const minZ = Math.max(0, Math.floor(Math.min(az, bz) / TILE_SIZE - widthWorld / TILE_SIZE - 1));
    const maxZ = Math.min(GRID_SIZE - 1, Math.ceil(Math.max(az, bz) / TILE_SIZE + widthWorld / TILE_SIZE + 1));
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz || 1;
    for (let tz = minZ; tz <= maxZ; tz += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        const wx = (tx + 0.5) * TILE_SIZE;
        const wz = (tz + 0.5) * TILE_SIZE;
        const t = clamp(((wx - ax) * dx + (wz - az) * dz) / lengthSq, 0, 1);
        const px = ax + dx * t;
        const pz = az + dz * t;
        const dist = Math.hypot(wx - px, wz - pz);
        if (dist > widthWorld) continue;
        const falloff = 1 - dist / widthWorld;
        const index = tileIndex(tx, tz);
        if ((this.fuel[index] ?? Fuel.Road) === Fuel.Water || (this.fuel[index] ?? Fuel.Road) === Fuel.Road) continue;
        this.retardant[index] = Math.max(this.retardant[index] ?? 0, strength * falloff);
        this.wetness[index] = Math.min(1, (this.wetness[index] ?? 0) + 0.12 * falloff);
      }
    }
  }

  clearLine(worldX: number, worldZ: number, radiusWorld: number): number {
    const tx = Math.floor(worldX / TILE_SIZE);
    const tz = Math.floor(worldZ / TILE_SIZE);
    const radiusTiles = radiusWorld / TILE_SIZE;
    let cleared = 0;
    for (let z = Math.floor(tz - radiusTiles); z <= Math.ceil(tz + radiusTiles); z += 1) {
      for (let x = Math.floor(tx - radiusTiles); x <= Math.ceil(tx + radiusTiles); x += 1) {
        if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
        if (Math.hypot(x - tx, z - tz) > radiusTiles) continue;
        const index = tileIndex(x, z);
        const fuel = this.fuel[index] ?? Fuel.Rock;
        if (fuel === Fuel.Water || fuel === Fuel.Road) continue;
        this.state[index] = FireState.Cleared;
        this.heat[index] = 0;
        this.progress[index] = 1;
        this.lineStrength[index] = Math.max(this.lineStrength[index] ?? 0, 1);
        this.retreatTimer[index] = 30;
        cleared += 1;
      }
    }
    return cleared;
  }

  headTileNear(worldX: number, worldZ: number, radiusTiles = 30): { x: number; z: number; distance: number } | null {
    const wind = this.windVector;
    const length = Math.hypot(wind.x, wind.z) || 1;
    const wx = wind.x / length;
    const wz = wind.z / length;
    const tx = worldX / TILE_SIZE;
    const tz = worldZ / TILE_SIZE;
    let best: { x: number; z: number; distance: number } | null = null;
    let bestScore = -Infinity;
    for (let z = Math.max(0, Math.floor(tz - radiusTiles)); z <= Math.min(GRID_SIZE - 1, Math.ceil(tz + radiusTiles)); z += 1) {
      for (let x = Math.max(0, Math.floor(tx - radiusTiles)); x <= Math.min(GRID_SIZE - 1, Math.ceil(tx + radiusTiles)); x += 1) {
        const dist = Math.hypot(x + 0.5 - tx, z + 0.5 - tz);
        if (dist > radiusTiles) continue;
        const state = this.state[tileIndex(x, z)] ?? FireState.Unburned;
        if (state !== FireState.Burning && state !== FireState.Igniting) continue;
        const score = (x + 0.5 - tx) * wx + (z + 0.5 - tz) * wz + (this.heat[tileIndex(x, z)] ?? 0) * 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z, distance: dist };
        }
      }
    }
    return best;
  }

  nearestActive(worldX: number, worldZ: number, maxTiles = 20): { x: number; z: number; distance: number } | null {
    const tx = worldX / TILE_SIZE;
    const tz = worldZ / TILE_SIZE;
    let best: { x: number; z: number; distance: number } | null = null;
    for (let z = Math.max(0, Math.floor(tz - maxTiles)); z <= Math.min(GRID_SIZE - 1, Math.ceil(tz + maxTiles)); z += 1) {
      for (let x = Math.max(0, Math.floor(tx - maxTiles)); x <= Math.min(GRID_SIZE - 1, Math.ceil(tx + maxTiles)); x += 1) {
        const state = this.state[tileIndex(x, z)] ?? FireState.Unburned;
        if (state !== FireState.Burning && state !== FireState.Igniting && state !== FireState.Smoldering) continue;
        const dist = Math.hypot(x + 0.5 - tx, z + 0.5 - tz);
        if (!best || dist < best.distance) best = { x, z, distance: dist };
      }
    }
    return best;
  }

  activeCountNear(worldX: number, worldZ: number, radiusTiles: number): number {
    const tx = worldX / TILE_SIZE;
    const tz = worldZ / TILE_SIZE;
    let count = 0;
    for (let z = Math.max(0, Math.floor(tz - radiusTiles)); z <= Math.min(GRID_SIZE - 1, Math.ceil(tz + radiusTiles)); z += 1) {
      for (let x = Math.max(0, Math.floor(tx - radiusTiles)); x <= Math.min(GRID_SIZE - 1, Math.ceil(tx + radiusTiles)); x += 1) {
        if (Math.hypot(x + 0.5 - tx, z + 0.5 - tz) > radiusTiles) continue;
        const state = this.state[tileIndex(x, z)] ?? FireState.Unburned;
        if (state === FireState.Burning || state === FireState.Igniting || state === FireState.Smoldering) count += 1;
      }
    }
    return count;
  }

  isActiveNear(worldX: number, worldZ: number, radiusTiles: number): boolean {
    const tx = worldX / TILE_SIZE;
    const tz = worldZ / TILE_SIZE;
    for (let z = Math.max(0, Math.floor(tz - radiusTiles)); z <= Math.min(GRID_SIZE - 1, Math.ceil(tz + radiusTiles)); z += 1) {
      for (let x = Math.max(0, Math.floor(tx - radiusTiles)); x <= Math.min(GRID_SIZE - 1, Math.ceil(tx + radiusTiles)); x += 1) {
        if (Math.hypot(x + 0.5 - tx, z + 0.5 - tz) > radiusTiles) continue;
        const state = this.state[tileIndex(x, z)] ?? FireState.Unburned;
        if (state === FireState.Burning || state === FireState.Igniting || state === FireState.Smoldering) return true;
      }
    }
    return false;
  }

  centroid(): { x: number; z: number; count: number } {
    let sx = 0;
    let sz = 0;
    let count = 0;
    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const state = this.state[tileIndex(tx, tz)] ?? FireState.Unburned;
        if (state === FireState.Burning || state === FireState.Igniting) {
          sx += tx;
          sz += tz;
          count += 1;
        }
      }
    }
    if (count === 0) return { x: 0, z: 0, count: 0 };
    return {
      x: (sx / count + 0.5) * TILE_SIZE,
      z: (sz / count + 0.5) * TILE_SIZE,
      count,
    };
  }

  stats(): FireStats {
    let burning = 0;
    let igniting = 0;
    let smoldering = 0;
    let burned = 0;
    let cleared = 0;
    for (let i = 0; i < this.state.length; i += 1) {
      const state = this.state[i];
      if (state === FireState.Burning) burning += 1;
      else if (state === FireState.Igniting) igniting += 1;
      else if (state === FireState.Smoldering) smoldering += 1;
      else if (state === FireState.Burned) burned += 1;
      else if (state === FireState.Cleared) cleared += 1;
    }
    return {
      active: burning + igniting + smoldering,
      burning,
      igniting,
      smoldering,
      burned,
      cleared,
      burnedHectares: (burned * TILE_SIZE * TILE_SIZE) / 10000,
    };
  }

  get activeFireCount(): number {
    let count = 0;
    for (let i = 0; i < this.state.length; i += 1) {
      const state = this.state[i];
      if (state === FireState.Burning || state === FireState.Igniting) count += 1;
    }
    return count;
  }

  fuelAt(tx: number, tz: number): FuelProfile {
    return FUELS[(this.fuel[tileIndex(tx, tz)] ?? Fuel.Rock) as Fuel];
  }

  stateAt(tx: number, tz: number): FireState {
    return (this.state[tileIndex(tx, tz)] ?? FireState.Unburned) as FireState;
  }
}

function terrainToFuel(terrain: Terrain): Fuel {
  switch (terrain) {
    case Terrain.Forest:
      return Fuel.Forest;
    case Terrain.Brush:
      return Fuel.Brush;
    case Terrain.Urban:
      return Fuel.Urban;
    case Terrain.Grass:
      return Fuel.Grass;
    case Terrain.Rock:
      return Fuel.Rock;
    case Terrain.Water:
      return Fuel.Water;
    case Terrain.Road:
      return Fuel.Road;
    default:
      return Fuel.Grass;
  }
}
