import { clamp } from '../core/math';
import { GRID_SIZE, NEIGHBOR_4, inGrid, tileIndex } from './constants';
import { Heightmap } from './heightmap';
import { BiomeMap, Terrain } from './biomes';

export interface TilePoint {
  x: number;
  z: number;
}

interface QueueEntry {
  index: number;
  priority: number;
}

export const INITIAL_ROADS: ReadonlyArray<ReadonlyArray<TilePoint>> = [
  [
    { x: 22, z: 45 },
    { x: 72, z: 45 },
  ],
  [
    { x: 47, z: 20 },
    { x: 47, z: 70 },
  ],
  [
    { x: 30, z: 57 },
    { x: 64, z: 57 },
  ],
  [
    { x: 36, z: 32 },
    { x: 36, z: 58 },
  ],
  [
    { x: 58, z: 32 },
    { x: 58, z: 58 },
  ],
  [
    { x: 47, z: 33 },
    { x: 47, z: 24 },
    { x: 55, z: 24 },
    { x: 55, z: 15 },
    { x: 67, z: 15 },
    { x: 67, z: 33 },
  ],
  [
    { x: 22, z: 45 },
    { x: 22, z: 61 },
  ],
  [
    { x: 64, z: 57 },
    { x: 74, z: 57 },
  ],
];

export class RoadNetwork {
  readonly size = GRID_SIZE;
  readonly mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  private revisionValue = 0;

  get revision(): number {
    return this.revisionValue;
  }

  has(tx: number, tz: number): boolean {
    return inGrid(tx, tz) && this.mask[tileIndex(tx, tz)] === 1;
  }

  set(tx: number, tz: number, value: boolean): void {
    if (!inGrid(tx, tz)) return;
    const index = tileIndex(tx, tz);
    const next = value ? 1 : 0;
    if (this.mask[index] !== next) {
      this.mask[index] = next;
      this.revisionValue += 1;
    }
  }

  addPath(path: ReadonlyArray<TilePoint>): void {
    for (const point of path) this.set(point.x, point.z, true);
  }

  addLine(from: TilePoint, to: TilePoint): void {
    let x = from.x;
    let z = from.z;
    const dx = Math.sign(to.x - from.x);
    const dz = Math.sign(to.z - from.z);
    let guard = 0;
    while (guard < GRID_SIZE * 2) {
      this.set(x, z, true);
      if (x === to.x && z === to.z) break;
      if (x !== to.x) x += dx;
      else if (z !== to.z) z += dz;
      guard += 1;
    }
  }

  clear(): void {
    this.mask.fill(0);
    this.revisionValue += 1;
  }

  count(): number {
    let total = 0;
    for (let i = 0; i < this.mask.length; i += 1) total += this.mask[i] ?? 0;
    return total;
  }

  neighbors(tx: number, tz: number): TilePoint[] {
    const result: TilePoint[] = [];
    for (const [dx, dz] of NEIGHBOR_4) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (this.has(nx, nz)) result.push({ x: nx, z: nz });
    }
    return result;
  }

  connectionMask(tx: number, tz: number): number {
    let mask = 0;
    if (this.has(tx, tz - 1)) mask |= 1;
    if (this.has(tx + 1, tz)) mask |= 2;
    if (this.has(tx, tz + 1)) mask |= 4;
    if (this.has(tx - 1, tz)) mask |= 8;
    return mask;
  }

  nearest(tx: number, tz: number, maxRadius = 24): (TilePoint & { distance: number }) | null {
    let best: (TilePoint & { distance: number }) | null = null;
    let bestDistance = Infinity;
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = tx + dx;
          const z = tz + dz;
          if (!this.has(x, z)) continue;
          const dist = Math.hypot(dx, dz);
          if (dist < bestDistance) {
            bestDistance = dist;
            best = { x, z, distance: dist };
          }
        }
      }
      if (best && radius >= bestDistance) break;
    }
    return best;
  }

  findPath(start: TilePoint, goal: TilePoint): TilePoint[] | null {
    const startTile = this.has(start.x, start.z) ? start : this.nearest(start.x, start.z, 12);
    const goalTile = this.has(goal.x, goal.z) ? goal : this.nearest(goal.x, goal.z, 12);
    if (!startTile || !goalTile) return null;
    if (startTile.x === goalTile.x && startTile.z === goalTile.z) return [{ x: startTile.x, z: startTile.z }];

    const startIndex = tileIndex(startTile.x, startTile.z);
    const goalIndex = tileIndex(goalTile.x, goalTile.z);
    const open: QueueEntry[] = [{ index: startIndex, priority: 0 }];
    const cameFrom = new Int32Array(this.mask.length).fill(-1);
    const cost = new Float32Array(this.mask.length).fill(Infinity);
    cost[startIndex] = 0;
    const closed = new Uint8Array(this.mask.length);

    while (open.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i += 1) {
        if ((open[i]?.priority ?? 0) < (open[bestIndex]?.priority ?? 0)) bestIndex = i;
      }
      const current = open.splice(bestIndex, 1)[0];
      if (!current) break;
      const index = current.index;
      if (index === goalIndex) {
        const path: TilePoint[] = [];
        let step = index;
        while (step !== -1) {
          path.push({ x: step % GRID_SIZE, z: Math.floor(step / GRID_SIZE) });
          step = cameFrom[step] ?? -1;
        }
        path.reverse();
        return path;
      }
      if (closed[index]) continue;
      closed[index] = 1;
      const cx = index % GRID_SIZE;
      const cz = Math.floor(index / GRID_SIZE);
      for (const [dx, dz] of NEIGHBOR_4) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.has(nx, nz)) continue;
        const nextIndex = tileIndex(nx, nz);
        if (closed[nextIndex]) continue;
        const nextCost = (cost[index] ?? 0) + 1;
        if (nextCost < (cost[nextIndex] ?? Infinity)) {
          cost[nextIndex] = nextCost;
          cameFrom[nextIndex] = index;
          const heuristic = Math.abs(nx - goalTile.x) + Math.abs(nz - goalTile.z);
          open.push({ index: nextIndex, priority: nextCost + heuristic });
        }
      }
    }
    return null;
  }

  forEach(callback: (tx: number, tz: number, index: number) => void): void {
    for (let tz = 0; tz < GRID_SIZE; tz += 1) {
      for (let tx = 0; tx < GRID_SIZE; tx += 1) {
        const index = tileIndex(tx, tz);
        if (this.mask[index]) callback(tx, tz, index);
      }
    }
  }
}

export function createInitialRoads(): RoadNetwork {
  const network = new RoadNetwork();
  for (const route of INITIAL_ROADS) {
    for (let i = 0; i < route.length - 1; i += 1) {
      const a = route[i];
      const b = route[i + 1];
      if (a && b) network.addLine(a, b);
    }
  }
  return network;
}

export function planRoadPath(
  heightmap: Heightmap,
  biomes: BiomeMap,
  start: TilePoint,
  goal: TilePoint,
  blocked?: Uint8Array,
): TilePoint[] | null {
  const startX = clamp(start.x, 0, GRID_SIZE - 1);
  const startZ = clamp(start.z, 0, GRID_SIZE - 1);
  const goalX = clamp(goal.x, 0, GRID_SIZE - 1);
  const goalZ = clamp(goal.z, 0, GRID_SIZE - 1);
  if (biomes.types[tileIndex(startX, startZ)] === Terrain.Water) return null;
  if (biomes.types[tileIndex(goalX, goalZ)] === Terrain.Water) return null;

  const startIndex = tileIndex(startX, startZ);
  const goalIndex = tileIndex(goalX, goalZ);
  if (blocked && (blocked[startIndex] === 1 || blocked[goalIndex] === 1)) return null;
  const open: QueueEntry[] = [{ index: startIndex, priority: 0 }];
  const cameFrom = new Int32Array(GRID_SIZE * GRID_SIZE).fill(-1);
  const cost = new Float32Array(GRID_SIZE * GRID_SIZE).fill(Infinity);
  const closed = new Uint8Array(GRID_SIZE * GRID_SIZE);
  cost[startIndex] = 0;

  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) {
      if ((open[i]?.priority ?? 0) < (open[bestIndex]?.priority ?? 0)) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    if (!current) break;
    if (current.index === goalIndex) {
      const path: TilePoint[] = [];
      let step = goalIndex;
      while (step !== -1) {
        path.push({ x: step % GRID_SIZE, z: Math.floor(step / GRID_SIZE) });
        step = cameFrom[step] ?? -1;
      }
      path.reverse();
      return path;
    }
    if (closed[current.index]) continue;
    closed[current.index] = 1;
    const cx = current.index % GRID_SIZE;
    const cz = Math.floor(current.index / GRID_SIZE);
    for (const [dx, dz] of NEIGHBOR_4) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inGrid(nx, nz)) continue;
      const nextIndex = tileIndex(nx, nz);
      if (closed[nextIndex]) continue;
      if (blocked && blocked[nextIndex] === 1) continue;
      const terrain = biomes.types[nextIndex] ?? Terrain.Grass;
      if (terrain === Terrain.Water) continue;
      const slope = heightmap.slopeTan(nx, nz);
      const rockPenalty = terrain === Terrain.Rock ? 14 : 0;
      const townBonus = terrain === Terrain.Urban ? -0.35 : 0;
      const stepCost = 1 + slope * 12 + rockPenalty + townBonus;
      const nextCost = (cost[current.index] ?? 0) + stepCost;
      if (nextCost < (cost[nextIndex] ?? Infinity)) {
        cost[nextIndex] = nextCost;
        cameFrom[nextIndex] = current.index;
        const heuristic = Math.abs(nx - goalX) + Math.abs(nz - goalZ);
        open.push({ index: nextIndex, priority: nextCost + heuristic });
      }
    }
  }
  return null;
}
