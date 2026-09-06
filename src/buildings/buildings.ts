import { FireState, fuelKeyOf, type FireGrid } from '../fire/grid';
import type { Heightmap } from '../terrain/heightmap';
import type { RoadMask } from '../roads/state';
import { isRoad } from '../roads/state';
import { createRng } from '../events/events';

/**
 * Procedural structures: homes and barns are placed as road-frontage lots;
 * cabins are placed as isolated, forest-preferring lots. Each structure has
 * an explicit grid footprint, a front-facing orientation, and a driveway
 * contract so placement and rendering use the same world/grid coordinates.
 */

export type BuildingKind = 'house' | 'barn' | 'cabin';
export type BuildingState = 'intact' | 'burning' | 'destroyed';

export type GridPoint = { x: number; z: number };

export type BuildingFootprint = {
  /** Number of cells along the local X/tangent axis. */
  width: number;
  /** Number of cells along the local Z/front axis. */
  depth: number;
};

export type Building = {
  id: number;
  kind: BuildingKind;
  /** Grid tile at the center of the footprint. */
  tile: GridPoint;
  footprint: BuildingFootprint;
  /** Radians; local +Z points toward the front door/driveway. */
  orientation: number;
  /** Small deterministic silhouette/material variation within a kind. */
  variant: number;
  /** Road-facing entry and the road tile it connects to, when available. */
  driveway: { entrance: GridPoint; road: GridPoint | null };
  state: BuildingState;
};

export type BuildingGenOptions = {
  /** Number of road-adjacent groups to seed. */
  clusterCount?: number;
  /** Houses/barns per group (min..max). */
  clusterSize?: [number, number];
  /** Isolated cabins far from roads. */
  cabinCount?: number;
  /** Max slope (rise/run) a building tolerates. */
  maxSlope?: number;
};

type Direction = GridPoint;

type RoadFrontage = {
  road: GridPoint;
  outward: Direction;
  tangent: Direction;
};

const ROAD_CLEARANCE_CELLS = 1;
const LOT_MARGIN = 4;
const KIND_FOOTPRINTS: Record<BuildingKind, BuildingFootprint> = {
  house: { width: 3, depth: 3 },
  barn: { width: 5, depth: 3 },
  cabin: { width: 3, depth: 2 },
};

function slopeAt(hm: Heightmap, x: number, z: number): number {
  const s = hm.scale;
  const h0 = hm.sample(x * s, z * s);
  const hx = hm.sample((x + 1) * s, z * s);
  const hz = hm.sample(x * s, (z + 1) * s);
  return Math.max(Math.abs(hx - h0), Math.abs(hz - h0)) / s;
}

function add(a: GridPoint, b: GridPoint): GridPoint {
  return { x: a.x + b.x, z: a.z + b.z };
}

function scale(direction: Direction, amount: number): Direction {
  return { x: direction.x * amount, z: direction.z * amount };
}

function negate(direction: Direction): Direction {
  return { x: -direction.x, z: -direction.z };
}

function key(point: GridPoint): string {
  return `${point.x},${point.z}`;
}

function distanceSquared(a: GridPoint, b: GridPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function distanceToNearestRoad(roadTiles: ReadonlyArray<GridPoint>, x: number, z: number): number {
  let best = Infinity;
  for (const road of roadTiles) best = Math.min(best, Math.hypot(road.x - x, road.z - z));
  return best;
}

function nearestRoad(roadTiles: ReadonlyArray<GridPoint>, point: GridPoint): GridPoint | null {
  let closest: GridPoint | null = null;
  let best = Infinity;
  for (const road of roadTiles) {
    const distance = distanceSquared(road, point);
    if (distance < best) {
      best = distance;
      closest = road;
    }
  }
  return closest;
}

function collectRoadTiles(roadMask: RoadMask): GridPoint[] {
  const tiles: GridPoint[] = [];
  for (let z = 0; z < roadMask.height; z++) {
    for (let x = 0; x < roadMask.width; x++) {
      if (isRoad(roadMask, x, z)) tiles.push({ x, z });
    }
  }
  return tiles;
}

function roadDirectionAt(roadMask: RoadMask, road: GridPoint): Direction {
  const horizontal = Number(isRoad(roadMask, road.x - 1, road.z)) + Number(isRoad(roadMask, road.x + 1, road.z));
  const vertical = Number(isRoad(roadMask, road.x, road.z - 1)) + Number(isRoad(roadMask, road.x, road.z + 1));
  return horizontal >= vertical ? { x: 1, z: 0 } : { x: 0, z: 1 };
}

function frontageCandidates(roadMask: RoadMask, roadTiles: ReadonlyArray<GridPoint>): RoadFrontage[] {
  const candidates: RoadFrontage[] = [];
  for (const road of roadTiles) {
    const tangent = roadDirectionAt(roadMask, road);
    const normal = { x: -tangent.z, z: tangent.x };
    candidates.push({ road, tangent, outward: normal });
    candidates.push({ road, tangent, outward: negate(normal) });
  }
  return candidates;
}

/** Return every grid cell covered by a building's oriented rectangular lot. */
export function buildingFootprintCells(building: Pick<Building, 'tile' | 'footprint' | 'orientation'>): GridPoint[] {
  const tangent = Math.abs(Math.cos(building.orientation)) > 0.5 ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const front = {
    x: Math.round(Math.sin(building.orientation)),
    z: Math.round(Math.cos(building.orientation)),
  };
  const cells: GridPoint[] = [];
  const xStart = -Math.floor((building.footprint.width - 1) / 2);
  const zStart = -Math.floor((building.footprint.depth - 1) / 2);
  for (let localZ = zStart; localZ < zStart + building.footprint.depth; localZ++) {
    for (let localX = xStart; localX < xStart + building.footprint.width; localX++) {
      cells.push({
        x: building.tile.x + tangent.x * localX + front.x * localZ,
        z: building.tile.z + tangent.z * localX + front.z * localZ,
      });
    }
  }
  return cells;
}

function expandedCells(cells: ReadonlyArray<GridPoint>, radius: number): GridPoint[] {
  const expanded: GridPoint[] = [];
  for (const cell of cells) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) expanded.push({ x: cell.x + dx, z: cell.z + dz });
    }
  }
  return expanded;
}

function orientationToFront(direction: Direction): number {
  const front = Math.abs(direction.x) >= Math.abs(direction.z)
    ? { x: Math.sign(direction.x) || 1, z: 0 }
    : { x: 0, z: Math.sign(direction.z) || 1 };
  return Math.atan2(front.x, front.z);
}

export function generateBuildings(
  hm: Heightmap,
  grid: FireGrid,
  roadMask: RoadMask,
  seed: string,
  opts: BuildingGenOptions = {},
): Building[] {
  const clusterCount = Math.max(0, opts.clusterCount ?? 3);
  const [clusterMin, clusterMax] = opts.clusterSize ?? [3, 6];
  const cabinCount = Math.max(0, opts.cabinCount ?? 6);
  const maxSlope = opts.maxSlope ?? 0.45;

  const rng = createRng(`buildings:${seed}`);
  const roadTiles = collectRoadTiles(roadMask);
  const candidates = frontageCandidates(roadMask, roadTiles);
  const buildings: Building[] = [];
  const occupied = new Set<string>();
  let nextId = 1;
  const cols = hm.width;
  const rows = hm.height;

  function inBounds(point: GridPoint): boolean {
    return point.x >= LOT_MARGIN && point.z >= LOT_MARGIN && point.x < cols - LOT_MARGIN && point.z < rows - LOT_MARGIN;
  }

  function canPlace(building: Pick<Building, 'tile' | 'footprint' | 'orientation'>): boolean {
    const cells = buildingFootprintCells(building);
    for (const cell of cells) {
      if (!inBounds(cell) || isRoad(roadMask, cell.x, cell.z)) return false;
      const fuel = fuelKeyOf(grid, cell.z * grid.width + cell.x);
      if (fuel === 'rock' || fuel === 'water' || slopeAt(hm, cell.x, cell.z) > maxSlope) return false;
      for (const nearby of expandedCells([cell], ROAD_CLEARANCE_CELLS)) {
        if (isRoad(roadMask, nearby.x, nearby.z) || occupied.has(key(nearby))) return false;
      }
    }
    return true;
  }

  function place(kind: BuildingKind, tile: GridPoint, orientation: number, drivewayRoad: GridPoint | null): boolean {
    const footprint = KIND_FOOTPRINTS[kind];
    const front = { x: Math.round(Math.sin(orientation)), z: Math.round(Math.cos(orientation)) };
    const building = {
      id: nextId,
      kind,
      tile,
      footprint,
      orientation,
      variant: Math.floor(rng() * 3),
      driveway: {
        entrance: add(tile, scale(front, Math.floor(footprint.depth / 2) + 1)),
        road: drivewayRoad,
      },
      state: 'intact' as const,
    } satisfies Building;
    if (!canPlace(building)) return false;
    for (const cell of expandedCells(buildingFootprintCells(building), ROAD_CLEARANCE_CELLS)) occupied.add(key(cell));
    buildings.push(building);
    nextId++;
    return true;
  }

  // Candidates come from local road tangents, never radial offsets, so every
  // frontage lot has a stable road-facing front door and setback.
  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const target = clusterMin + Math.floor(rng() * Math.max(1, clusterMax - clusterMin + 1));
    let placed = 0;
    for (let attempt = 0; attempt < candidates.length * 2 && placed < target; attempt++) {
      if (!candidates.length) break;
      const frontage = candidates[Math.floor(rng() * candidates.length)];
      const kind: BuildingKind = rng() < 0.2 ? 'barn' : 'house';
      const footprint = KIND_FOOTPRINTS[kind];
      const tile = add(frontage.road, scale(frontage.outward, ROAD_CLEARANCE_CELLS + Math.ceil(footprint.depth / 2)));
      const facing = negate(frontage.outward);
      if (place(kind, tile, orientationToFront(facing), frontage.road)) placed++;
    }
  }

  // Cabins use a separate strategy: far from roads and biased toward forest,
  // while sharing the same footprint and one-cell clearance rules.
  for (let placed = 0, attempt = 0; placed < cabinCount && attempt < 1200; attempt++) {
    const tile = {
      x: LOT_MARGIN + Math.floor(rng() * Math.max(1, cols - LOT_MARGIN * 2)),
      z: LOT_MARGIN + Math.floor(rng() * Math.max(1, rows - LOT_MARGIN * 2)),
    };
    if (roadTiles.length && distanceToNearestRoad(roadTiles, tile.x, tile.z) < 12) continue;
    const fuel = fuelKeyOf(grid, tile.z * grid.width + tile.x);
    if (fuel !== 'forest' && rng() > 0.25) continue;
    const road = nearestRoad(roadTiles, tile);
    const orientation = road
      ? orientationToFront({ x: road.x - tile.x, z: road.z - tile.z })
      : Math.floor(rng() * 4) * (Math.PI / 2);
    if (place('cabin', tile, orientation, null)) placed++;
  }

  return buildings;
}

/** Latching state machine: intact → burning → destroyed, with suppression recovery before burn-through. */
export function updateBuildingStates(buildings: Building[], grid: FireGrid): void {
  for (const b of buildings) {
    if (b.state === 'destroyed') continue;
    const idx = b.tile.z * grid.width + b.tile.x;
    if (idx < 0 || idx >= grid.state.length) continue;
    const st = grid.state[idx];
    if (b.state === 'intact') {
      if (st === FireState.Igniting || st === FireState.Burning || st === FireState.Smoldering) b.state = 'burning';
    } else if (b.state === 'burning') {
      if (st === FireState.Burned) b.state = 'destroyed';
      else if (st === FireState.Unburned) b.state = 'intact';
    }
  }
}

export type StructureReport = {
  total: number;
  intact: number;
  burning: number;
  destroyed: number;
};

export function reportStructures(buildings: ReadonlyArray<Building>): StructureReport {
  let intact = 0;
  let burning = 0;
  let destroyed = 0;
  for (const b of buildings) {
    if (b.state === 'intact') intact++;
    else if (b.state === 'burning') burning++;
    else destroyed++;
  }
  return { total: buildings.length, intact, burning, destroyed };
}

/** Protect-the-homes score: +10 per standing structure, −25 per loss. */
export function computeStructureScore(report: StructureReport): number {
  return (report.intact + report.burning) * 10 - report.destroyed * 25;
}
