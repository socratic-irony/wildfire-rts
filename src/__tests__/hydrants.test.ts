import { describe, it, expect } from 'vitest';
import { createRoadMask } from '../roads/state';
import {
  canSuppressAt,
  createHydrantSystem,
  findActiveHydrantById,
  findActiveHydrantWithinReach,
  findNearestHydrant,
  getHydrantCoverage,
  isInHydrantCoverage,
  placeHydrant,
  removeHydrant,
  updateHydrantPlacement,
} from '../fire/hydrants';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import {
  buildFireGrid,
  applyWaterAoE,
  applyWaterAoEWithHydrants,
  coordToIndex,
  FireState,
} from '../fire/grid';

describe('fire hydrant placement', () => {
  it('enforces spacing, offsets, and coverage checks', () => {
    const width = 80;
    const height = 3;
    const roadMask = createRoadMask(width, height);
    for (let x = 0; x < width; x++) {
      roadMask.mask[1 * width + x] = 1;
    }

    const system = createHydrantSystem(roadMask, 2);
    updateHydrantPlacement(system);

    expect(system.hydrants.length).toBeGreaterThan(0);

    const hydrants = [...system.hydrants].sort((a, b) => a.gridPos.x - b.gridPos.x);
    for (let i = 1; i < hydrants.length; i++) {
      const prev = hydrants[i - 1];
      const curr = hydrants[i];
      const dx = curr.gridPos.x - prev.gridPos.x;
      const dz = curr.gridPos.z - prev.gridPos.z;
      const dist = Math.hypot(dx, dz);
      expect(dist).toBeGreaterThanOrEqual(system.minSpacingTiles);
    }

    const lateralOffset = system.cellSize * 1.4;
    let offsetSampled = 0;
    for (const hydrant of hydrants) {
      expect(hydrant.coverageRadius).toBe(25);
      const offset = hydrant.worldPos.z - (hydrant.gridPos.z + 0.5) * system.cellSize;
      expect(Math.abs(offset)).toBeCloseTo(lateralOffset, 1);
      offsetSampled++;
    }
    expect(offsetSampled).toBeGreaterThan(0);

    // Coverage check using a single-road-tile system
    const soloMask = createRoadMask(60, 3);
    soloMask.mask[1 * soloMask.width + 10] = 1;
    const soloSystem = createHydrantSystem(soloMask, 2);
    updateHydrantPlacement(soloSystem);
    expect(soloSystem.hydrants.length).toBe(1);
    const only = soloSystem.hydrants[0];
    expect(isInHydrantCoverage(soloSystem.hydrants, { ...only.gridPos })).toBe(true);
    const outside = { x: only.gridPos.x + only.coverageRadius + 5, z: only.gridPos.z };
    expect(isInHydrantCoverage(soloSystem.hydrants, outside)).toBe(false);
  });

  it('skips automatic placement on crossroad tiles', () => {
    const mask = createRoadMask(25, 25);
    for (let x = 2; x < 23; x++) mask.mask[12 * mask.width + x] = 1;
    for (let z = 2; z < 23; z++) mask.mask[z * mask.width + 12] = 1;

    const system = createHydrantSystem(mask, 2);
    updateHydrantPlacement(system);

    expect(system.hydrants.some((hydrant) => hydrant.gridPos.x === 12 && hydrant.gridPos.z === 12)).toBe(false);
    for (const hydrant of system.hydrants) {
      expect(hydrant.worldPos.x).toBeGreaterThanOrEqual(0);
      expect(hydrant.worldPos.z).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('hydrant-enhanced suppression', () => {
  it('matches base suppression exactly when no hydrant system is provided', () => {
    const hm = generateHeightmap(7, 6, 1, {
      seed: 'water-characterization',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const biomes = computeBiomes(hm);
    const params = { cellSize: 1, spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 } };
    const baseGrid = buildFireGrid(hm, biomes, params);
    const hydrantGrid = buildFireGrid(hm, biomes, params);

    for (let i = 0; i < baseGrid.state.length; i++) {
      const state = i % 5 as FireState;
      const heat = ((i * 17) % 101) / 100;
      const wetness = ((i * 13) % 97) / 100;
      baseGrid.state[i] = state;
      baseGrid.heat[i] = heat;
      baseGrid.wetness[i] = wetness;
      hydrantGrid.state[i] = state;
      hydrantGrid.heat[i] = heat;
      hydrantGrid.wetness[i] = wetness;
    }

    // Exercise burning and smoldering knockdown while the radius is clipped by
    // the top and left map edges.
    baseGrid.state[coordToIndex(baseGrid, 0, 0)] = FireState.Burning;
    hydrantGrid.state[coordToIndex(hydrantGrid, 0, 0)] = FireState.Burning;
    baseGrid.state[coordToIndex(baseGrid, 1, 1)] = FireState.Smoldering;
    hydrantGrid.state[coordToIndex(hydrantGrid, 1, 1)] = FireState.Smoldering;

    const center = { x: 0.25, z: 0.5 };
    applyWaterAoE(baseGrid, center, 2.75, 0.37);
    applyWaterAoEWithHydrants(hydrantGrid, center, 2.75, 0.37, undefined);

    expect({
      wetness: Array.from(hydrantGrid.wetness),
      heat: Array.from(hydrantGrid.heat),
      state: Array.from(hydrantGrid.state),
    }).toEqual({
      wetness: Array.from(baseGrid.wetness),
      heat: Array.from(baseGrid.heat),
      state: Array.from(baseGrid.state),
    });
  });

  it('boosts water intensity only inside hydrant coverage', () => {
    const hm = generateHeightmap(12, 12, 1, {
      seed: 'flat',
      frequency: 0,
      amplitude: 0,
      octaves: 1,
      persistence: 1,
    });
    const biomes = computeBiomes(hm);
    const params = { cellSize: 1, spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 } };
    const baseGrid = buildFireGrid(hm, biomes, params);
    const hydrantGrid = buildFireGrid(hm, biomes, params);

    const center = { x: 5, z: 5 };
    const outside = { x: 7, z: 5 }; // distance 2 tiles from center
    const baseCenterIdx = coordToIndex(baseGrid, center.x, center.z);
    const baseOutsideIdx = coordToIndex(baseGrid, outside.x, outside.z);

    const prep = (grid: typeof baseGrid) => {
      const ci = coordToIndex(grid, center.x, center.z);
      grid.state[ci] = FireState.Burning;
      grid.heat[ci] = 0.9;
      grid.wetness[ci] = 0;
      grid.retardant[ci] = 0;
      const oi = coordToIndex(grid, outside.x, outside.z);
      grid.state[oi] = FireState.Burning;
      grid.heat[oi] = 0.9;
      grid.wetness[oi] = 0;
      grid.retardant[oi] = 0;
    };
    prep(baseGrid);
    prep(hydrantGrid);

    const hydrantSystem = {
      hydrants: [
        {
          active: true,
          gridPos: { ...center },
          coverageRadius: 1,
        },
      ],
    };

    applyWaterAoE(baseGrid, center, 2, 0.3);
    applyWaterAoEWithHydrants(hydrantGrid, center, 2, 0.3, hydrantSystem);

    expect(hydrantGrid.wetness[baseCenterIdx]).toBeCloseTo(0.45, 5);
    expect(hydrantGrid.wetness[baseCenterIdx]).toBeGreaterThan(baseGrid.wetness[baseCenterIdx]);
    expect(baseGrid.wetness[baseCenterIdx]).toBeCloseTo(0.3, 5);
    expect(hydrantGrid.heat[baseCenterIdx]).toBeLessThan(baseGrid.heat[baseCenterIdx]);

    expect(hydrantGrid.wetness[baseOutsideIdx]).toBeCloseTo(baseGrid.wetness[baseOutsideIdx], 5);
    expect(hydrantGrid.heat[baseOutsideIdx]).toBeCloseTo(baseGrid.heat[baseOutsideIdx], 5);
  });
});

describe('hydrant utility helpers', () => {
  it('supports placement, queries, and removal', () => {
    const mask = createRoadMask(40, 3);
    for (let x = 0; x < mask.width; x++) {
      mask.mask[1 * mask.width + x] = 1;
    }

    const system = createHydrantSystem(mask, 2);
    expect(placeHydrant(system, { x: 5, z: 1 })).toBe(true);
    const hydrant = system.hydrants[0];

    const coverage = getHydrantCoverage(hydrant);
    expect(coverage).toContainEqual({ x: hydrant.gridPos.x, z: hydrant.gridPos.z });

    expect(canSuppressAt(system, hydrant.gridPos)).toBe(true);
    expect(canSuppressAt(system, { x: hydrant.gridPos.x + hydrant.coverageRadius + 10, z: hydrant.gridPos.z })).toBe(false);

    const nearest = findNearestHydrant(system, { x: hydrant.gridPos.x + 4, z: hydrant.gridPos.z });
    expect(nearest?.id).toBe(hydrant.id);

    expect(removeHydrant(system, hydrant.id)).toBe(true);
    expect(system.hydrants.length).toBe(0);
  });

  it('finds only active hydrants within the bounded roadside draw reach', () => {
    const mask = createRoadMask(20, 3);
    mask.mask[1 * mask.width + 5] = 1;
    const system = createHydrantSystem(mask, 2);
    expect(placeHydrant(system, { x: 5, z: 1 })).toBe(true);
    const source = system.hydrants[0];

    expect(findActiveHydrantWithinReach(system, source.worldPos, 6)?.id).toBe(source.id);
    expect(findActiveHydrantWithinReach(system, { x: source.worldPos.x + 6.1, z: source.worldPos.z }, 6)).toBeNull();

    source.active = false;
    expect(findActiveHydrantWithinReach(system, source.worldPos, 6)).toBeNull();

    source.active = true;
    expect(findActiveHydrantById(system, source.id)?.id).toBe(source.id);
    expect(removeHydrant(system, source.id)).toBe(true);
    expect(findActiveHydrantById(system, source.id)).toBeNull();
  });
});
