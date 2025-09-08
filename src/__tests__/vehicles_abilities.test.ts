import { test, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildTerrainCost } from '../roads/cost';
import { createRoadMask } from '../roads/state';
import { buildFireGrid, ignite } from '../fire/grid';
import { VehiclesManager, VehicleType } from '../vehicles/vehicles';

test('firetruck sprayWater increases wetness', () => {
  const hm = generateHeightmap(8, 8, 1, { seed: 1, frequency: 1, amplitude: 0, octaves: 1, persistence: 0.5 });
  const biomes = computeBiomes(hm);
  const terrain = buildTerrainCost(hm);
  const roadMask = createRoadMask(hm.width, hm.height);
  roadMask.mask[2 * hm.width + 2] = 1;
  const fireGrid = buildFireGrid(hm, biomes, { cellSize: hm.scale });
  ignite(fireGrid, [{ x: 2, z: 2 }]);
  const vm = new VehiclesManager(hm, terrain, roadMask, 4, undefined, fireGrid);
  vm.spawnAt(2, 2, VehicleType.FIRETRUCK);
  vm.sprayWater(0, 1.5, 0.5);
  const tile = fireGrid.tiles[2 * fireGrid.width + 2];
  expect(tile.wetness).toBeGreaterThan(0);
});
