import type { Heightmap } from './heightmap';

type GridDimensions = Pick<Heightmap, 'width' | 'height' | 'scale'>;

export type GridCell = { x: number; z: number };

export function worldToGridCell(
  heightmap: GridDimensions,
  worldX: number,
  worldZ: number,
): GridCell {
  return {
    x: Math.max(0, Math.min(heightmap.width - 1, Math.round(worldX / heightmap.scale))),
    z: Math.max(0, Math.min(heightmap.height - 1, Math.round(worldZ / heightmap.scale))),
  };
}
