import { FireState, fuelKeyOf, type FireGrid } from '../fire/grid';
import type { Heightmap } from '../terrain/heightmap';
import type { RoadMask } from '../roads/state';
import { isRoad } from '../roads/state';
import { createRng } from '../events/events';

/**
 * Procedural structures: homes clustered near roads plus isolated cabins in
 * the woods. Buildings are 1-tile victims of the fire sim — they catch fire
 * when their tile ignites and are destroyed once it burns through. The
 * scenario score rewards keeping them intact.
 */

export type BuildingKind = 'house' | 'barn' | 'cabin';
export type BuildingState = 'intact' | 'burning' | 'destroyed';

export type Building = {
  id: number;
  kind: BuildingKind;
  /** Grid tile the building occupies. */
  tile: { x: number; z: number };
  state: BuildingState;
};

export type BuildingGenOptions = {
  /** Number of road-adjacent clusters. */
  clusterCount?: number;
  /** Houses per cluster (min..max). */
  clusterSize?: [number, number];
  /** Isolated cabins far from roads. */
  cabinCount?: number;
  /** Max slope (rise/run) a building tolerates. */
  maxSlope?: number;
};

function slopeAt(hm: Heightmap, x: number, z: number): number {
  const s = hm.scale;
  const h0 = hm.sample(x * s, z * s);
  const hx = hm.sample((x + 1) * s, z * s);
  const hz = hm.sample(x * s, (z + 1) * s);
  return Math.max(Math.abs(hx - h0), Math.abs(hz - h0)) / s;
}

function distToNearestRoad(roadTiles: Array<{ x: number; z: number }>, x: number, z: number): number {
  let best = Infinity;
  for (const r of roadTiles) {
    const d = Math.hypot(r.x - x, r.z - z);
    if (d < best) best = d;
  }
  return best;
}

function collectRoadTiles(roadMask: RoadMask): Array<{ x: number; z: number }> {
  const tiles: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < roadMask.height; z++) {
    for (let x = 0; x < roadMask.width; x++) {
      if (roadMask.mask[z * roadMask.width + x] === 1) tiles.push({ x, z });
    }
  }
  return tiles;
}

export function generateBuildings(
  hm: Heightmap,
  grid: FireGrid,
  roadMask: RoadMask,
  seed: string,
  opts: BuildingGenOptions = {},
): Building[] {
  const clusterCount = opts.clusterCount ?? 3;
  const [clusterMin, clusterMax] = opts.clusterSize ?? [3, 6];
  const cabinCount = opts.cabinCount ?? 6;
  const maxSlope = opts.maxSlope ?? 0.45;

  const rng = createRng(`buildings:${seed}`);
  const roadTiles = collectRoadTiles(roadMask);
  const buildings: Building[] = [];
  const used = new Set<number>();
  let nextId = 1;
  const margin = 4;

  const cols = hm.width;
  const rows = hm.height;

  function usable(x: number, z: number, minRoadDist: number, maxRoadDist: number): boolean {
    if (x < margin || z < margin || x >= cols - margin || z >= rows - margin) return false;
    if (used.has(z * cols + x)) return false;
    if (isRoad(roadMask, x, z)) return false;
    const fuel = fuelKeyOf(grid, z * grid.width + x);
    if (fuel === 'rock' || fuel === 'water') return false;
    if (slopeAt(hm, x, z) > maxSlope) return false;
    if (roadTiles.length) {
      const d = distToNearestRoad(roadTiles, x, z);
      if (d < minRoadDist || d > maxRoadDist) return false;
    }
    return true;
  }

  function place(x: number, z: number, kind: BuildingKind) {
    used.add(z * cols + x);
    buildings.push({ id: nextId++, kind, tile: { x, z }, state: 'intact' });
  }

  // — Road-adjacent clusters: pick a road tile, scatter houses 2–6 tiles out —
  if (roadTiles.length) {
    for (let c = 0; c < clusterCount; c++) {
      const center = roadTiles[Math.floor(rng() * roadTiles.length)];
      const target = clusterMin + Math.floor(rng() * (clusterMax - clusterMin + 1));
      let placed = 0;
      for (let attempt = 0; attempt < 60 && placed < target; attempt++) {
        const ang = rng() * Math.PI * 2;
        const dist = 2 + rng() * 4;
        const x = Math.round(center.x + Math.cos(ang) * dist);
        const z = Math.round(center.z + Math.sin(ang) * dist);
        if (!usable(x, z, 1.5, 8)) continue;
        place(x, z, rng() < 0.2 ? 'barn' : 'house');
        placed++;
      }
    }
  }

  // — Cabins in the woods: far from any road, preferring forest tiles —
  for (let placed = 0, attempt = 0; placed < cabinCount && attempt < 600; attempt++) {
    const x = margin + Math.floor(rng() * (cols - margin * 2));
    const z = margin + Math.floor(rng() * (rows - margin * 2));
    const farFromRoad = roadTiles.length ? distToNearestRoad(roadTiles, x, z) >= 12 : true;
    if (!farFromRoad) continue;
    if (!usable(x, z, 0, Infinity)) continue;
    // Prefer forest fuel: accept non-forest only occasionally so cabins read
    // as "in the woods" without making generation fail on sparse maps.
const inForest = fuelKeyOf(grid, z * grid.width + x) === 'forest';
    if (!inForest && rng() > 0.25) continue;
    place(x, z, 'cabin');
    placed++;
  }

  return buildings;
}

/**
 * Latching state machine: intact → burning while the tile is hot,
 * burning → destroyed once the tile has burned through (or after the
 * building has burned long enough that the tile smolders out).
 */
export function updateBuildingStates(buildings: Building[], grid: FireGrid): void {
  for (const b of buildings) {
    if (b.state === 'destroyed') continue;
    const idx = b.tile.z * grid.width + b.tile.x;
    if (idx < 0 || idx >= grid.state.length) continue;
    const st = grid.state[idx];
    if (b.state === 'intact') {
      if (
        st === FireState.Igniting ||
        st === FireState.Burning ||
        st === FireState.Smoldering
      ) {
        b.state = 'burning';
      }
    } else if (b.state === 'burning') {
      if (st === FireState.Burned) {
        b.state = 'destroyed';
      } else if (st === FireState.Unburned) {
        // Fire was suppressed before burning through — the structure survives.
        b.state = 'intact';
      }
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
  let intact = 0, burning = 0, destroyed = 0;
  for (const b of buildings) {
    if (b.state === 'intact') intact++;
    else if (b.state === 'burning') burning++;
    else destroyed++;
  }
  return { total: buildings.length, intact, burning, destroyed };
}

/**
 * Protect-the-homes score: +10 per structure still standing, −25 per
 * structure lost. Burning structures count as standing until they collapse —
 * the player can still save them.
 */
export function computeStructureScore(report: StructureReport): number {
  return (report.intact + report.burning) * 10 - report.destroyed * 25;
}
