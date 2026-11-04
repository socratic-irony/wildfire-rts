import { clamp, smoothstep } from '../core/math';
import { fbm2, ridgeNoise2 } from '../core/rng';
import { GRID_SIZE, LEVEL_HEIGHT, TILE_SIZE } from './constants';

export const TOWN_CENTER = { x: 47, z: 45 };
export const TOWN_RADIUS = { x: 19, z: 15 };
export const TOWN_LEVEL = 3;
export const LAKE_CENTER = { x: 23, z: 72 };
export const LAKE_RADIUS = 10.5;
export const WATER_LEVEL = 0.7;

export class Heightmap {
  readonly size = GRID_SIZE;
  readonly tileSize = TILE_SIZE;
  readonly levelHeight = LEVEL_HEIGHT;
  readonly levels: Uint8Array;
  readonly waterMask: Uint8Array;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.levels = generateLevels(this.seed);
    this.waterMask = generateWaterMask(this.levels);
  }

  levelAtVertex(ix: number, iz: number): number {
    const x = clamp(ix, 0, this.size);
    const z = clamp(iz, 0, this.size);
    return this.levels[z * (this.size + 1) + x] ?? 0;
  }

  vertexHeight(ix: number, iz: number): number {
    return this.levelAtVertex(ix, iz) * this.levelHeight;
  }

  heightAt(wx: number, wz: number): number {
    const gx = clamp(wx / this.tileSize, 0, this.size);
    const gz = clamp(wz / this.tileSize, 0, this.size);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(this.size, x0 + 1);
    const z1 = Math.min(this.size, z0 + 1);
    const fx = gx - x0;
    const fz = gz - z0;
    const h00 = this.vertexHeight(x0, z0);
    const h10 = this.vertexHeight(x1, z0);
    const h01 = this.vertexHeight(x0, z1);
    const h11 = this.vertexHeight(x1, z1);
    const top = h00 + (h10 - h00) * fx;
    const bottom = h01 + (h11 - h01) * fx;
    return top + (bottom - top) * fz;
  }

  cornerHeights(tx: number, tz: number): [number, number, number, number] {
    return [
      this.vertexHeight(tx, tz),
      this.vertexHeight(tx + 1, tz),
      this.vertexHeight(tx, tz + 1),
      this.vertexHeight(tx + 1, tz + 1),
    ];
  }

  tileHeight(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    return (h00 + h10 + h01 + h11) / 4;
  }

  tileMaxHeight(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    return Math.max(h00, h10, h01, h11);
  }

  tileMinHeight(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    return Math.min(h00, h10, h01, h11);
  }

  slopeTan(tx: number, tz: number): number {
    const [h00, h10, h01, h11] = this.cornerHeights(tx, tz);
    const dx = (h10 + h11 - h00 - h01) / (2 * this.tileSize);
    const dz = (h01 + h11 - h00 - h10) / (2 * this.tileSize);
    return Math.hypot(dx, dz);
  }

  isWater(tx: number, tz: number): boolean {
    return this.waterMask[tz * this.size + tx] === 1;
  }

  normalAt(wx: number, wz: number): { x: number; y: number; z: number } {
    const e = 0.45;
    const hx = this.heightAt(wx + e, wz) - this.heightAt(wx - e, wz);
    const hz = this.heightAt(wx, wz + e) - this.heightAt(wx, wz - e);
    const nx = -hx;
    const ny = 2 * e;
    const nz = -hz;
    const length = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / length, y: ny / length, z: nz / length };
  }

  isTownVertex(ix: number, iz: number): boolean {
    return (
      (ix - TOWN_CENTER.x) ** 2 / TOWN_RADIUS.x ** 2 + (iz - TOWN_CENTER.z) ** 2 / TOWN_RADIUS.z ** 2 <
      1
    );
  }
}

function generateLevels(seed: number): Uint8Array {
  const stride = GRID_SIZE + 1;
  const levels = new Uint8Array(stride * stride);
  const raw = new Float32Array(stride * stride);

  for (let iz = 0; iz < stride; iz += 1) {
    for (let ix = 0; ix < stride; ix += 1) {
      const nx = ix / GRID_SIZE;
      const nz = iz / GRID_SIZE;
      const broad = fbm2(nx * 2.8, nz * 2.8, seed, 4, 0.52, 2.0);
      const detail = fbm2(nx * 8.5, nz * 8.5, seed + 911, 3, 0.48, 2.0);
      const ridge = ridgeNoise2(nx * 2.2 + 5.2, nz * 2.2 - 1.4, seed + 431);
      const edge = Math.max(Math.abs(nx - 0.5), Math.abs(nz - 0.5)) * 2;
      const rim = smoothstep(0.5, 1.0, edge) * 5.2;
      const bowl = (1 - smoothstep(0.0, 0.9, edge)) * 1.1;
      let value = broad * 0.62 + detail * 0.23 + ridge * 0.15 + bowl;
      value = clamp(value, 0, 1);
      raw[iz * stride + ix] = value + rim;
    }
  }

  for (let iz = 0; iz < stride; iz += 1) {
    for (let ix = 0; ix < stride; ix += 1) {
      const i = iz * stride + ix;
      let level = Math.round(1 + (raw[i] ?? 0) * 4.4);
      const townDx = (ix - TOWN_CENTER.x) / TOWN_RADIUS.x;
      const townDz = (iz - TOWN_CENTER.z) / TOWN_RADIUS.z;
      if (townDx * townDx + townDz * townDz <= 0.9) {
        level = TOWN_LEVEL;
      }
      const lakeDist = Math.hypot(ix - LAKE_CENTER.x, iz - LAKE_CENTER.z);
      const lakeEdge = LAKE_RADIUS + (fbm2(ix * 0.14, iz * 0.14, seed + 71, 2, 0.5, 2) - 0.5) * 3.2;
      if (lakeDist < lakeEdge) {
        level = 0;
      }
      levels[i] = Math.max(0, Math.min(12, level));
    }
  }

  enforceSlopeLimit(levels, stride, 24);
  return levels;
}

function enforceSlopeLimit(levels: Uint8Array, stride: number, passes: number): void {
  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;
    for (let iz = 0; iz < stride; iz += 1) {
      for (let ix = 0; ix < stride; ix += 1) {
        const i = iz * stride + ix;
        let value = levels[i] ?? 0;
        let minNeighbor = 255;
        if (ix > 0) minNeighbor = Math.min(minNeighbor, levels[i - 1] ?? 0);
        if (ix < stride - 1) minNeighbor = Math.min(minNeighbor, levels[i + 1] ?? 0);
        if (iz > 0) minNeighbor = Math.min(minNeighbor, levels[i - stride] ?? 0);
        if (iz < stride - 1) minNeighbor = Math.min(minNeighbor, levels[i + stride] ?? 0);
        if (value > minNeighbor + 1) {
          levels[i] = minNeighbor + 1;
          value = minNeighbor + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function generateWaterMask(levels: Uint8Array): Uint8Array {
  const stride = GRID_SIZE + 1;
  const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let tz = 0; tz < GRID_SIZE; tz += 1) {
    for (let tx = 0; tx < GRID_SIZE; tx += 1) {
      const i = tz * stride + tx;
      const maxCorner = Math.max(
        levels[i] ?? 0,
        levels[i + 1] ?? 0,
        levels[i + stride] ?? 0,
        levels[i + stride + 1] ?? 0,
      );
      const dist = Math.hypot(tx + 0.5 - LAKE_CENTER.x, tz + 0.5 - LAKE_CENTER.z);
      if (maxCorner <= 0 && dist < LAKE_RADIUS + 2.5) {
        mask[tz * GRID_SIZE + tx] = 1;
      }
    }
  }
  return mask;
}
