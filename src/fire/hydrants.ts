import type { RoadMask } from '../roads/state';

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

export function createHydrantSystem(roadMask: RoadMask, cellSize = 2.0): HydrantSystem {
  return {
    hydrants: [],
    roadMask,
    nextId: 1,
    minSpacingTiles: 100,      // Minimum spacing as specified
    idealSpacingTiles: 25,     // 50m / 2m per tile = 25 tiles
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

function isRoad(roadMask: RoadMask, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= roadMask.width || z >= roadMask.height) return false;
  return roadMask.mask[z * roadMask.width + x] === 1;
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

export function placeHydrant(system: HydrantSystem, pos: { x: number; z: number }): boolean {
  if (!isValidHydrantPosition(system, pos)) return false;
  
  const hydrant: FireHydrant = {
    id: system.nextId++,
    gridPos: { x: Math.round(pos.x), z: Math.round(pos.z) },
    worldPos: { 
      x: (pos.x + 0.5) * system.cellSize, 
      z: (pos.z + 0.5) * system.cellSize 
    },
    coverageRadius: 5, // ~10m at 2m/tile
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

function findOptimalSpacing(system: HydrantSystem, roadTiles: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const candidates: Array<{ x: number; z: number }> = [];
  
  // Simple approach: place hydrants at regular intervals along road network
  // For each road tile, check if we should place a hydrant there
  for (const tile of roadTiles) {
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
      candidates.push(tile);
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
  
  // Find positions that need hydrants
  const candidates = findOptimalSpacing(system, roadTiles);
  
  // Place new hydrants
  for (const pos of candidates) {
    placeHydrant(system, pos);
  }
}

export function clearHydrants(system: HydrantSystem): void {
  system.hydrants.length = 0;
  system.nextId = 1;
}