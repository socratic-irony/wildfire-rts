import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { GRID_SIZE, NEIGHBOR_4, inGrid, tileIndex } from './constants';
import { Heightmap } from './heightmap';
import { BiomeMap, Terrain } from './biomes';

export interface TilePoint {
  x: number;
  z: number;
}

/**
 * Binary min-heap of tile indices keyed by (priority, insertion order). The
 * tie-break matches the original linear scan, so generated maps are unchanged.
 */
class TileQueue {
  private readonly indices: number[] = [];
  private readonly priorities: number[] = [];
  private readonly order: number[] = [];
  private sequence = 0;

  get size(): number {
    return this.indices.length;
  }

  push(index: number, priority: number): void {
    this.indices.push(index);
    this.priorities.push(priority);
    this.order.push(this.sequence);
    this.sequence += 1;
    let i = this.indices.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.indices[0]!;
    const last = this.indices.length - 1;
    this.swap(0, last);
    this.indices.pop();
    this.priorities.pop();
    this.order.pop();
    let i = 0;
    const n = this.indices.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const pa = this.priorities[a]!;
    const pb = this.priorities[b]!;
    return pa < pb || (pa === pb && this.order[a]! < this.order[b]!);
  }

  private swap(a: number, b: number): void {
    [this.indices[a], this.indices[b]] = [this.indices[b]!, this.indices[a]!];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b]!, this.priorities[a]!];
    [this.order[a], this.order[b]] = [this.order[b]!, this.order[a]!];
  }
}

/** Extra planner cost for changing direction. */
const TURN_PENALTY = 2.5;

export class RoadNetwork {
  readonly size = GRID_SIZE;
  readonly mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  private revisionValue = 0;
  private components: Int32Array | null = null;
  private componentRevision = -1;

  get revision(): number {
    return this.revisionValue;
  }

  /**
   * True if two tiles are joined by road (4-neighbour connectivity, the same
   * rule as findPath). Off-road endpoints snap to the nearest road tile the
   * way findPath does. Labels are recomputed only after the road mask changes.
   */
  connected(start: TilePoint, goal: TilePoint): boolean {
    const from = this.has(start.x, start.z) ? start : this.nearest(start.x, start.z, 12);
    const to = this.has(goal.x, goal.z) ? goal : this.nearest(goal.x, goal.z, 12);
    if (!from || !to) return false;
    const labels = this.componentLabels();
    const a = labels[tileIndex(from.x, from.z)] ?? -1;
    return a >= 0 && a === labels[tileIndex(to.x, to.z)];
  }

  private componentLabels(): Int32Array {
    if (this.components && this.componentRevision === this.revisionValue) return this.components;
    const labels = this.components ?? new Int32Array(this.mask.length);
    labels.fill(-1);
    const stack: number[] = [];
    let next = 0;
    for (let i = 0; i < this.mask.length; i += 1) {
      if (this.mask[i] !== 1 || labels[i] !== -1) continue;
      labels[i] = next;
      stack.push(i);
      while (stack.length > 0) {
        const index = stack.pop()!;
        const x = index % GRID_SIZE;
        const z = (index - x) / GRID_SIZE;
        for (const [dx, dz] of NEIGHBOR_4) {
          const nx = x + dx;
          const nz = z + dz;
          if (!inGrid(nx, nz)) continue;
          const n = tileIndex(nx, nz);
          if (this.mask[n] !== 1 || labels[n] !== -1) continue;
          labels[n] = next;
          stack.push(n);
        }
      }
      next += 1;
    }
    this.components = labels;
    this.componentRevision = this.revisionValue;
    return labels;
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
    const open = new TileQueue();
    open.push(startIndex, 0);
    const cameFrom = new Int32Array(this.mask.length).fill(-1);
    const cost = new Float32Array(this.mask.length).fill(Infinity);
    cost[startIndex] = 0;
    const closed = new Uint8Array(this.mask.length);

    while (open.size > 0) {
      const index = open.pop();
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
          open.push(nextIndex, nextCost + heuristic);
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

/**
 * Lay out the starting road network for a seeded map: a town street grid
 * around the layout's crossroads, plus highways that wind out to the map edge
 * and a spur up to the highest ground, planned over the raw terrain so they
 * follow gentle grades.
 */
export function generateRoadNetwork(heightmap: Heightmap, seed: number): RoadNetwork {
  const network = new RoadNetwork();
  const rng = new Rng(seed ^ 0x510e527f);
  const { town, side } = heightmap.layout;
  const cx = town.x;
  const cz = town.z;
  const clampTile = (v: number) => clamp(Math.round(v), 2, GRID_SIZE - 3);
  const line = (ax: number, az: number, bx: number, bz: number) =>
    network.addLine({ x: clampTile(ax), z: clampTile(az) }, { x: clampTile(bx), z: clampTile(bz) });

  const ewReach = town.rx + 1;
  const nsReach = town.rz + 1;
  line(cx - ewReach, cz, cx + ewReach, cz);
  line(cx, cz - nsReach, cx, cz + nsReach);
  const sideSpacing = 11;
  const sideReach = Math.round(town.rz * 0.8);
  line(cx + sideSpacing, cz - sideReach, cx + sideSpacing, cz + sideReach);
  line(cx - sideSpacing, cz - sideReach, cx - sideSpacing, cz + sideReach);
  const crossZ = cz + (rng.next() < 0.5 ? 1 : -1) * (sideReach - 1);
  line(cx - sideSpacing - 4, crossZ, cx + sideSpacing + 4, crossZ);
  if (rng.next() < 0.6) {
    // An occasional back lane on the station side.
    const laneX = cx + side * (sideSpacing + 6);
    line(laneX, cz - 6, laneX, cz + 6);
    line(cx + side * sideSpacing, cz - 6, laneX, cz - 6);
  }

  // Highways out of town. Always at least two, in random directions.
  const exits: Array<{ from: TilePoint; to: TilePoint }> = [
    { from: { x: clampTile(cx + ewReach), z: cz }, to: { x: GRID_SIZE - 2, z: clampTile(cz + rng.range(-24, 24)) } },
    { from: { x: clampTile(cx - ewReach), z: cz }, to: { x: 1, z: clampTile(cz + rng.range(-24, 24)) } },
    { from: { x: cx, z: clampTile(cz + nsReach) }, to: { x: clampTile(cx + rng.range(-24, 24)), z: GRID_SIZE - 2 } },
    { from: { x: cx, z: clampTile(cz - nsReach) }, to: { x: clampTile(cx + rng.range(-24, 24)), z: 1 } },
  ];
  for (let i = exits.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [exits[i], exits[j]] = [exits[j] as (typeof exits)[number], exits[i] as (typeof exits)[number]];
  }
  const exitCount = 2 + Math.floor(rng.next() * 2.2);
  for (const exit of exits.slice(0, exitCount)) {
    const path = planRoadPath(heightmap, null, exit.from, exit.to);
    if (path) network.addPath(path);
  }

  // Spur to the highest ground away from town (a lookout / repeater site).
  let peak: TilePoint | null = null;
  let peakHeight = -Infinity;
  for (let tz = 6; tz < GRID_SIZE - 6; tz += 2) {
    for (let tx = 6; tx < GRID_SIZE - 6; tx += 2) {
      if (Math.hypot((tx - cx) / town.rx, (tz - cz) / town.rz) < 1.5) continue;
      const h = heightmap.tileHeight(tx, tz) + rng.range(0, 0.5);
      if (h > peakHeight) {
        peakHeight = h;
        peak = { x: tx, z: tz };
      }
    }
  }
  if (peak) {
    const start = network.nearest(peak.x, peak.z, GRID_SIZE);
    if (start) {
      const path = planRoadPath(heightmap, null, start, peak);
      if (path) network.addPath(path);
    }
  }
  return network;
}

export function planRoadPath(
  heightmap: Heightmap,
  biomes: BiomeMap | null,
  start: TilePoint,
  goal: TilePoint,
  blocked?: Uint8Array,
): TilePoint[] | null {
  const terrainAt = (index: number): Terrain => {
    if (biomes) return (biomes.types[index] ?? Terrain.Grass) as Terrain;
    return heightmap.isWater(index % GRID_SIZE, Math.floor(index / GRID_SIZE)) ? Terrain.Water : Terrain.Grass;
  };
  const startX = clamp(start.x, 0, GRID_SIZE - 1);
  const startZ = clamp(start.z, 0, GRID_SIZE - 1);
  const goalX = clamp(goal.x, 0, GRID_SIZE - 1);
  const goalZ = clamp(goal.z, 0, GRID_SIZE - 1);
  if (terrainAt(tileIndex(startX, startZ)) === Terrain.Water) return null;
  if (terrainAt(tileIndex(goalX, goalZ)) === Terrain.Water) return null;

  const startIndex = tileIndex(startX, startZ);
  const goalIndex = tileIndex(goalX, goalZ);
  if (blocked && (blocked[startIndex] === 1 || blocked[goalIndex] === 1)) return null;
  const open = new TileQueue();
  open.push(startIndex, 0);
  const cameFrom = new Int32Array(GRID_SIZE * GRID_SIZE).fill(-1);
  const cost = new Float32Array(GRID_SIZE * GRID_SIZE).fill(Infinity);
  const closed = new Uint8Array(GRID_SIZE * GRID_SIZE);
  cost[startIndex] = 0;

  while (open.size > 0) {
    const current = { index: open.pop() };
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
      const terrain = terrainAt(nextIndex);
      if (terrain === Terrain.Water) continue;
      // Climbing along the direction of travel is acceptable (it becomes a
      // ramp); crossing a slope sideways forces a deep cut, so it costs more.
      const [h00, h10, h01, h11] = heightmap.cornerHeights(nx, nz);
      const gradX = Math.abs(h10 + h11 - h00 - h01) / (2 * heightmap.tileSize);
      const gradZ = Math.abs(h01 + h11 - h00 - h10) / (2 * heightmap.tileSize);
      const along = dx !== 0 ? gradX : gradZ;
      const lateral = dx !== 0 ? gradZ : gradX;
      const rockPenalty = terrain === Terrain.Rock ? 14 : 0;
      // Prefer long straight runs over 1-tile staircases: every bend becomes a
      // flat pad when graded, so zigzags look jagged and chew up the hillside.
      const parent = cameFrom[current.index] ?? -1;
      const turning =
        parent >= 0 && (parent % GRID_SIZE !== cx - dx || Math.floor(parent / GRID_SIZE) !== cz - dz);
      const stepCost = 1 + along * 5 + lateral * 14 + rockPenalty + (turning ? TURN_PENALTY : 0);
      const nextCost = (cost[current.index] ?? 0) + stepCost;
      if (nextCost < (cost[nextIndex] ?? Infinity)) {
        cost[nextIndex] = nextCost;
        cameFrom[nextIndex] = current.index;
        const heuristic = Math.abs(nx - goalX) + Math.abs(nz - goalZ);
        open.push(nextIndex, nextCost + heuristic);
      }
    }
  }
  return null;
}
