import { FireGrid, FireState } from './grid';
import { computePerimeter, Polyline } from './perimeter';

export type FireStats = {
  burning: number;
  smoldering: number;
  active: number;
  burnedTiles: number;
  burnedAreaWorld: number; // in world units^2
  perimeterTile: number;   // length in tile units
  perimeterWorld: number;  // length in world units
  polylines: Polyline[];
};

function polylineLength(poly: Polyline): number {
  let len = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    len += Math.hypot(dx, dz);
  }
  return len;
}

export function computeFireStats(grid: FireGrid): FireStats {
  const burning = grid.bCount;
  const smoldering = grid.sCount;
  let burnedTiles = 0;
  for (let i = 0; i < grid.tiles.length; i++) if (grid.tiles[i].state === FireState.Burned) burnedTiles++;
  const active = burning + smoldering;
  const polylines = computePerimeter(grid);
  const perTile = polylines.reduce((s, p) => s + polylineLength(p), 0);
  const cell = grid.params.cellSize;
  return {
    burning,
    smoldering,
    active,
    burnedTiles,
    burnedAreaWorld: burnedTiles * cell * cell,
    perimeterTile: perTile,
    perimeterWorld: perTile * cell,
    polylines,
  };
}

