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
  const stampDisc = (cx: number, cz: number) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(rm.width - 1, Math.ceil(cx + r + 1));
    const z0 = Math.max(0, Math.floor(cz - r - 1));
    const z1 = Math.min(rm.height - 1, Math.ceil(cz + r + 1));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz <= r2) rm.mask[z * rm.width + x] = 1;
      }
    }
  };
  // stamp vertices
  for (let k = 0; k < polyline.length; k++) {
    stampDisc(polyline[k].x, polyline[k].z);
  }
  // connect segments to ensure continuity by stepping along the line
  for (let k = 0; k < polyline.length - 1; k++) {
    const a = polyline[k];
    const b = polyline[k + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    if (steps <= 1) continue;
    for (let s = 1; s < steps; s++) {
      const x = Math.round(a.x + (dx * s) / steps);
      const z = Math.round(a.z + (dz * s) / steps);
      stampDisc(x, z);
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
