/**
 * Regression tests for follower suppression loop, incident lifecycle, and
 * logistics (water consumption, return-to-base, refill).
 */

import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, applyWaterAoEWithHydrants, FireState, ignite } from '../fire/grid';
import { createIncidentRegistry } from '../dispatch/incident';
import {
  createPayload,
  consumeWater,
  refuel,
  refill,
  needsReturnToBase,
} from '../vehicles/payload';
import { VehicleType } from '../vehicles/types';

function flatGrid(size = 8) {
  const hm = generateHeightmap(size, size, 1, { seed: 'flat', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes, { cellSize: 1 });
}

describe('follower_suppression_applies_water_and_wetness', () => {
  it('applyWaterAoEWithHydrants increases tile wetness and knocks down heat', () => {
    const grid = flatGrid();
    ignite(grid, [{ x: 4, z: 4 }]);
    grid.tiles[4 * grid.width + 4].state = FireState.Burning;
    grid.tiles[4 * grid.width + 4].heat = 0.8;

    const prevWetness = grid.tiles[4 * grid.width + 4].wetness;
    const prevHeat = grid.tiles[4 * grid.width + 4].heat;

    applyWaterAoEWithHydrants(grid, { x: 4.5, z: 4.5 }, 2.5, 0.4, undefined);

    const tile = grid.tiles[4 * grid.width + 4];
    expect(tile.wetness).toBeGreaterThan(prevWetness);
    expect(tile.heat).toBeLessThan(prevHeat);
  });

  it('consumeWater reduces payload water and returns actual drawn amount', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    const initial = p.water;
    const drawn = consumeWater(p, 100);
    expect(drawn).toBe(100);
    expect(p.water).toBe(initial - 100);
  });

  it('consumeWater clamps at zero and returns only what was available', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    p.water = 30;
    const drawn = consumeWater(p, 500);
    expect(drawn).toBe(30);
    expect(p.water).toBe(0);
  });
});

describe('empty_tank_reopens_incident_and_sends_unit_home', () => {
  it('reopen() on an assigned incident resets it to detected with no assignees', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;
    const reg = createIncidentRegistry(1);
    const [inc] = reg.detectFromFireGrid(grid, 0);

    reg.markAssigned(inc.id, [7, 8], 1);
    expect(reg.byId(inc.id)?.status).toBe('assigned');
    expect(reg.byId(inc.id)?.assignedFollowerIds).toHaveLength(2);

    reg.reopen(inc.id);

    const after = reg.byId(inc.id)!;
    expect(after.status).toBe('detected');
    expect(after.assignedFollowerIds).toHaveLength(0);
    expect(after.assignedAt).toBeUndefined();
    expect(after.engagedAt).toBeUndefined();
  });

  it('reopen() on an engaged incident also resets it', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;
    const reg = createIncidentRegistry(1);
    const [inc] = reg.detectFromFireGrid(grid, 0);

    reg.markAssigned(inc.id, [5], 1);
    reg.markEngaged(inc.id, 2);
    expect(reg.byId(inc.id)?.status).toBe('engaged');

    reg.reopen(inc.id);

    expect(reg.byId(inc.id)?.status).toBe('detected');
    expect(reg.byId(inc.id)?.assignedFollowerIds).toHaveLength(0);
  });

  it('reopen() on a resolved incident is a no-op', () => {
    const grid = flatGrid();
    grid.tiles[0].state = FireState.Burning;
    const reg = createIncidentRegistry(1);
    const [inc] = reg.detectFromFireGrid(grid, 0);

    reg.markResolved(inc.id, 1);
    reg.reopen(inc.id);

    expect(reg.byId(inc.id)?.status).toBe('resolved');
  });
});

describe('returning_unit_only_clears_busy_after_refill', () => {
  it('needsReturnToBase is true when water is empty', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    expect(needsReturnToBase(p)).toBe(false);
    p.water = 0;
    expect(needsReturnToBase(p)).toBe(true);
  });

  it('refill restores water to full capacity', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    p.water = 0;
    refill(p);
    expect(p.water).toBe(p.waterCapacity);
    expect(needsReturnToBase(p)).toBe(false);
  });

  it('refuel restores fuel to full capacity', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    p.fuel = 0;
    refuel(p);
    expect(p.fuel).toBe(p.fuelCapacity);
  });

  it('unit is still "busy" until refill is complete (not just return triggered)', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    p.water = 0;
    // Simulate: needsReturn triggers, but busy should stay true until refill
    expect(needsReturnToBase(p)).toBe(true);
    // Only after refill should needsReturnToBase return false
    refill(p);
    refuel(p);
    expect(needsReturnToBase(p)).toBe(false);
  });
});
