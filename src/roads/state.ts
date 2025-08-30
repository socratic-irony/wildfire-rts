export type RoadMask = {
  width: number;
  height: number;
  mask: Uint8Array; // 1 for road, 0 otherwise
};

export function createRoadMask(width: number, height: number): RoadMask {
  return { width, height, mask: new Uint8Array(width * height) };
}

export function clearRoadMask(rm: RoadMask) {
  rm.mask.fill(0);
}

export function isRoad(rm: RoadMask, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= rm.width || z >= rm.height) return false;
  return rm.mask[z * rm.width + x] === 1;
}

// Rasterize a polyline of grid points (tile centers) into the road mask.
// widthTiles is the radius in tiles (e.g., 1.0 marks a ~2-tile wide road).
export function rasterizePolyline(rm: RoadMask, polyline: Array<{ x: number; z: number }>, widthTiles = 0.8) {
  if (!polyline.length) return;
  const r = Math.max(0.01, widthTiles);
  const r2 = r * r;
  for (let k = 0; k < polyline.length; k++) {
    const c = polyline[k];
    const x0 = Math.max(0, Math.floor(c.x - r - 1));
    const x1 = Math.min(rm.width - 1, Math.ceil(c.x + r + 1));
    const z0 = Math.max(0, Math.floor(c.z - r - 1));
    const z1 = Math.min(rm.height - 1, Math.ceil(c.z + r + 1));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz <= r2) rm.mask[z * rm.width + x] = 1;
      }
    }
  }
}

// Optional: apply a road mask to the fire grid by reducing combustibility.
// Current approach: mark road tiles as 'urban' fuel (lower ROS/load than vegetation).
export function applyRoadMaskToFireGrid(grid: import('../fire/grid').FireGrid, rm: RoadMask) {
  const { width, height } = rm;
  const w = grid.width, h = grid.height;
  if (w !== width || h !== height) return; // dimension mismatch safeguard
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (rm.mask[i]) {
        const t = grid.tiles[i];
        if (t.fuel !== 'rock' && t.fuel !== 'water') {
          t.fuel = 'urban';
        }
      }
    }
  }
}

