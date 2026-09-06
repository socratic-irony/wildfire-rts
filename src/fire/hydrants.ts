import { isRoad, type RoadMask } from '../roads/state';

export type FireHydrant = {
  id: number;
  gridPos: { x: number; z: number };    // Grid tile position  
  worldPos: { x: number; z: number };   // World space position
  coverageRadius: number;               // Tiles (typically 5 for ~10m at 2m/tile)
  active: boolean;                      // Can be disabled/damaged
  waterPressure: number;                // 0..1 (future: affects spray effectiveness)
};

export type HydrantSystem = {
  hydrants: FireHydrant[];
  roadMask: RoadMask;                   // Reference to road system
  nextId: number;
  minSpacingTiles: number;              // Minimum 100 tiles between hydrants
  idealSpacingTiles: number;            // Target ~25 tiles (50m at 2m/tile scale)
  cellSize: number;                     // World units per tile (typically 2.0)
};

/** Roadside placement and truck draw constants are intentionally explicit. */
export const HYDRANT_MIN_SPACING_TILES = 8;
export const HYDRANT_IDEAL_SPACING_TILES = 10;
export const HYDRANT_ROADSIDE_OFFSET_TILES = 1.4;
export const HYDRANT_COVERAGE_RADIUS_TILES = 25;

export function createHydrantSystem(roadMask: RoadMask, cellSize = 2.0): HydrantSystem {
  return {
    hydrants: [],
    roadMask,
    nextId: 1,
    minSpacingTiles: HYDRANT_MIN_SPACING_TILES,
    idealSpacingTiles: HYDRANT_IDEAL_SPACING_TILES,
    cellSize,
  };
}

export function isInHydrantCoverage(hydrants: FireHydrant[], gridPos: { x: number; z: number }): boolean {
  return hydrants.some(h => {
    if (!h.active) return false;
    const dx = h.gridPos.x - gridPos.x;
    const dz = h.gridPos.z - gridPos.z;
    return (dx * dx + dz * dz) <= (h.coverageRadius * h.coverageRadius);
  });
}

export function canSuppressAt(system: HydrantSystem, pos: { x: number; z: number }): boolean {
  // Must be on road AND within hydrant coverage
  return isRoad(system.roadMask, pos.x, pos.z) && isInHydrantCoverage(system.hydrants, pos);
}

export function findNearestHydrant(system: HydrantSystem, pos: { x: number; z: number }): FireHydrant | null {
  let nearest: FireHydrant | null = null;
  let minDistSq = Infinity;
  
  for (const hydrant of system.hydrants) {
    if (!hydrant.active) continue;
    const dx = hydrant.gridPos.x - pos.x;
    const dz = hydrant.gridPos.z - pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      nearest = hydrant;
    }
  }
  
  return nearest;
}

/**
 * Find an active source close enough for a ground unit to draw directly.
 * `worldPos` is used here instead of grid coordinates because a hydrant is
 * deliberately placed beside the road rather than on its centerline.
 */
export function findActiveHydrantWithinReach(
  system: HydrantSystem,
  worldPos: { x: number; z: number },
  maxDistance: number,
): FireHydrant | null {
  const maxDistanceSq = maxDistance * maxDistance;
  let nearest: FireHydrant | null = null;
  let nearestDistanceSq = maxDistanceSq;
  for (const hydrant of system.hydrants) {
    if (!hydrant.active) continue;
    const dx = hydrant.worldPos.x - worldPos.x;
    const dz = hydrant.worldPos.z - worldPos.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq <= nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      nearest = hydrant;
    }
  }
  return nearest;
}

export function findActiveHydrantById(system: HydrantSystem, id: number): FireHydrant | null {
  const hydrant = system.hydrants.find((candidate) => candidate.id === id);
  return hydrant?.active ? hydrant : null;
}

export function getHydrantCoverage(hydrant: FireHydrant): Array<{ x: number; z: number }> {
  const coverage: Array<{ x: number; z: number }> = [];
  const r = hydrant.coverageRadius;
  const r2 = r * r;
  
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz <= r2) {
        coverage.push({
          x: hydrant.gridPos.x + dx,
          z: hydrant.gridPos.z + dz
        });
      }
    }
  }
  
  return coverage;
}

function isValidHydrantPosition(system: HydrantSystem, pos: { x: number; z: number }): boolean {
  // Must be on a road tile
  if (!isRoad(system.roadMask, pos.x, pos.z)) return false;
  
  // Must respect minimum spacing from existing hydrants
  for (const existing of system.hydrants) {
    const dx = existing.gridPos.x - pos.x;
    const dz = existing.gridPos.z - pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < system.minSpacingTiles * system.minSpacingTiles) {
      return false;
    }
  }
  
  return true;
}

export function placeHydrant(system: HydrantSystem, pos: { x: number; z: number }, isLeftSide?: boolean): boolean {
  if (!isValidHydrantPosition(system, pos)) return false;
  
  // Calculate actual placement position (potentially offset from road center)
  const placementPos = (isLeftSide !== undefined) 
    ? getHydrantOffsetPosition(system.roadMask, pos, isLeftSide)
    : pos;
  
  const hydrant: FireHydrant = {
    id: system.nextId++,
    gridPos: { x: Math.round(pos.x), z: Math.round(pos.z) }, // Keep grid position as road tile
    worldPos: { 
      x: placementPos.x * system.cellSize, 
      z: placementPos.z * system.cellSize 
    },
    coverageRadius: HYDRANT_COVERAGE_RADIUS_TILES,
    active: true,
    waterPressure: 1.0,
  };
  
  system.hydrants.push(hydrant);
  return true;
}

export function removeHydrant(system: HydrantSystem, id: number): boolean {
  const index = system.hydrants.findIndex(h => h.id === id);
  if (index === -1) return false;
  
  system.hydrants.splice(index, 1);
  return true;
}

function getAllRoadTiles(roadMask: RoadMask): Array<{ x: number; z: number }> {
  const roadTiles: Array<{ x: number; z: number }> = [];
  
  for (let z = 0; z < roadMask.height; z++) {
    for (let x = 0; x < roadMask.width; x++) {
      if (roadMask.mask[z * roadMask.width + x] === 1) {
        roadTiles.push({ x, z });
      }
    }
  }
  
  return roadTiles;
}

function findRoadDirection(roadMask: RoadMask, x: number, z: number): { dx: number; dz: number } | null {
  // Find the direction of the road at this position by checking neighboring road tiles
  const neighbors: Array<{ x: number; z: number; dx: number; dz: number }> = [];
  
  // Check 8 directions around the current tile
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue; // Skip center
      const nx = x + dx;
      const nz = z + dz;
      if (isRoad(roadMask, nx, nz)) {
        neighbors.push({ x: nx, z: nz, dx, dz });
      }
    }
  }
  
  if (neighbors.length === 0) return null;
  
  // Calculate average direction vector
  let avgDx = 0, avgDz = 0;
  for (const neighbor of neighbors) {
    avgDx += neighbor.dx;
    avgDz += neighbor.dz;
  }
  
  let len = Math.sqrt(avgDx * avgDx + avgDz * avgDz);
  if (len === 0) {
    // Opposite neighbors on a straight road cancel in the average. Prefer a
    // cardinal axis in that case so hydrants never fall back to the road
    // centerline. At a four-way junction the x axis is a stable tie-breaker.
    const hasEastWest = neighbors.some((neighbor) => neighbor.dz === 0 && neighbor.dx !== 0);
    const hasNorthSouth = neighbors.some((neighbor) => neighbor.dx === 0 && neighbor.dz !== 0);
    if (hasEastWest) {
      avgDx = 1;
      avgDz = 0;
    } else if (hasNorthSouth) {
      avgDx = 0;
      avgDz = 1;
    } else {
      const first = neighbors[0];
      avgDx = first.dx;
      avgDz = first.dz;
    }
    len = Math.sqrt(avgDx * avgDx + avgDz * avgDz);
  }
  
  return { dx: avgDx / len, dz: avgDz / len };
}

function getHydrantOffsetPosition(
  roadMask: RoadMask, 
  centerPos: { x: number; z: number }, 
  isLeftSide: boolean,
  offsetDistance = HYDRANT_ROADSIDE_OFFSET_TILES
): { x: number; z: number } {
  const direction = findRoadDirection(roadMask, centerPos.x, centerPos.z);
  if (!direction) {
    // If we can't determine road direction, place on the center
    return centerPos;
  }
  
  // Calculate perpendicular vector (rotate 90 degrees)
  const perpDx = -direction.dz;
  const perpDz = direction.dx;
  
  // Apply offset to left or right side
  const sideMultiplier = isLeftSide ? -1 : 1;
  let offsetX = centerPos.x + (perpDx * offsetDistance * sideMultiplier);
  let offsetZ = centerPos.z + (perpDz * offsetDistance * sideMultiplier);

  // Keep the roadside fixture clear of the rasterized road where a wide or
  // diagonal stamp reaches the first candidate offset. The normal road mask
  // uses a sub-two-tile radius, so the first candidate remains the usual
  // 1.4-tile placement; the bounded fallback handles wider custom roads.
  if (isRoad(roadMask, Math.round(offsetX), Math.round(offsetZ))) {
    const clearance = offsetDistance + 0.75;
    offsetX = centerPos.x + (perpDx * clearance * sideMultiplier);
    offsetZ = centerPos.z + (perpDz * clearance * sideMultiplier);
  }
  
  return { 
    x: Math.round(offsetX * 10) / 10, // Round to 0.1 precision for sub-tile placement
    z: Math.round(offsetZ * 10) / 10 
  };
}

function findOptimalSpacing(system: HydrantSystem, roadTiles: Array<{ x: number; z: number }>): Array<{ x: number; z: number; isLeftSide: boolean }> {
  const candidates: Array<{ x: number; z: number; isLeftSide: boolean }> = [];
  let alternateLeft = true; // Start with left side
  
  // Sort road tiles to ensure consistent placement order
  const sortedTiles = roadTiles.slice().sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    return a.z - b.z;
  });
  
  for (const tile of sortedTiles) {
    // Check if this position would have ideal spacing
    let needsHydrant = true;
    
    for (const existing of system.hydrants) {
      const dx = existing.gridPos.x - tile.x;
      const dz = existing.gridPos.z - tile.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      // If there's already a hydrant within ideal spacing range, don't place another
      if (dist < system.idealSpacingTiles) {
        needsHydrant = false;
        break;
      }
    }
    
    if (needsHydrant && isValidHydrantPosition(system, tile)) {
      candidates.push({ ...tile, isLeftSide: alternateLeft });
      alternateLeft = !alternateLeft; // Alternate for next hydrant
    }
  }
  
  return candidates;
}

export function updateHydrantPlacement(system: HydrantSystem): void {
  // Remove hydrants that are no longer on road tiles
  system.hydrants = system.hydrants.filter(h => 
    isRoad(system.roadMask, h.gridPos.x, h.gridPos.z)
  );
  
  // Get all current road tiles
  const roadTiles = getAllRoadTiles(system.roadMask);
  
  // Find positions that need hydrants with alternating side placement
  const candidates = findOptimalSpacing(system, roadTiles);
  
  // Place new hydrants with alternating sides
  for (const candidate of candidates) {
    placeHydrant(system, { x: candidate.x, z: candidate.z }, candidate.isLeftSide);
  }
}

export function clearHydrants(system: HydrantSystem): void {
  system.hydrants.length = 0;
  system.nextId = 1;
}
