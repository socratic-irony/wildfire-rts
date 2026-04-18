import { describe, it, expect } from 'vitest';
import { createRoadMask } from '../roads/state';
import {
  canSuppressAt,
  createHydrantSystem,
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
      const offset = hydrant.worldPos.z - hydrant.gridPos.z * system.cellSize;
      if (Math.abs(offset) > 0.05) {
        expect(Math.abs(offset)).toBeCloseTo(lateralOffset, 1);
        offsetSampled++;
      }
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
});

describe('hydrant-enhanced suppression', () => {
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
      const c = grid.tiles[coordToIndex(grid, center.x, center.z)];
      c.state = FireState.Burning;
      c.heat = 0.9;
      c.wetness = 0;
      c.retardant = 0;
      const o = grid.tiles[coordToIndex(grid, outside.x, outside.z)];
      o.state = FireState.Burning;
      o.heat = 0.9;
      o.wetness = 0;
      o.retardant = 0;
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

    const baseCenter = baseGrid.tiles[baseCenterIdx];
    const boostedCenter = hydrantGrid.tiles[baseCenterIdx];
    expect(baseCenter.wetness).toBeCloseTo(0.3, 5);
    expect(boostedCenter.wetness).toBeCloseTo(0.45, 5);
    expect(boostedCenter.wetness).toBeGreaterThan(baseCenter.wetness);
    expect(boostedCenter.heat).toBeLessThan(baseCenter.heat);

    const baseFar = baseGrid.tiles[baseOutsideIdx];
    const boostedFar = hydrantGrid.tiles[baseOutsideIdx];
    expect(boostedFar.wetness).toBeCloseTo(baseFar.wetness, 5);
    expect(boostedFar.heat).toBeCloseTo(baseFar.heat, 5);
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
});
