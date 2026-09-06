import { buildingFootprintCells, type Building } from '../buildings/buildings';
import type { RoadMask } from '../roads/state';

/** Generated once after road/lot edits, never in the per-frame plant loop. */
export function createVegetationClearance(roads: RoadMask, buildings: ReadonlyArray<Building>) {
  const { width, height } = roads;
  const data = new Uint8Array(width * height);
  const stamp = (x: number, z: number, radius: number) => {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = x + dx, gz = z + dz;
        if (gx >= 0 && gz >= 0 && gx < width && gz < height) data[gz * width + gx] = 1;
      }
    }
  };
  // Includes canopy radius and the half-cell offset of the rendered ribbon.
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) if (roads.mask[z * width + x]) stamp(x, z, 3);
  }
  for (const building of buildings) {
    for (const cell of buildingFootprintCells(building)) stamp(cell.x, cell.z, 2);
    const road = building.driveway.road;
    if (!road) continue;
    const entrance = building.driveway.entrance;
    const steps = Math.max(1, Math.ceil(Math.hypot(road.x - entrance.x, road.z - entrance.z)));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      stamp(Math.round(entrance.x + (road.x - entrance.x) * t), Math.round(entrance.z + (road.z - entrance.z) * t), 2);
    }
  }
  return { width, height, data };
}
