export const GRID_SIZE = 96;
export const TILE_SIZE = 2;
export const LEVEL_HEIGHT = 2;
export const WORLD_SIZE = GRID_SIZE * TILE_SIZE;
export const FIXED_STEP = 0.2;
export const MAX_STEPS_PER_FRAME = 5;
export const SHIFT_DURATION = 8 * 60;

export function tileIndex(tx: number, tz: number): number {
  return tz * GRID_SIZE + tx;
}

export function indexToTile(index: number): { x: number; z: number } {
  return { x: index % GRID_SIZE, z: Math.floor(index / GRID_SIZE) };
}

export function inGrid(tx: number, tz: number): boolean {
  return tx >= 0 && tz >= 0 && tx < GRID_SIZE && tz < GRID_SIZE;
}

export function tileToWorld(tx: number, tz: number): { x: number; z: number } {
  return { x: (tx + 0.5) * TILE_SIZE, z: (tz + 0.5) * TILE_SIZE };
}

export function worldToTile(wx: number, wz: number): { x: number; z: number } {
  return {
    x: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(wx / TILE_SIZE))),
    z: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(wz / TILE_SIZE))),
  };
}

export const NEIGHBOR_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export const NEIGHBOR_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
