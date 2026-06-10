import { describe, it, expect } from 'vitest';
import { VehicleType } from '../../vehicles/types';
import { assignByCost, type CostDispatchableUnit } from '../cost';
import type { Incident } from '../incident';

function inc(id: number, x: number, z: number, status: Incident['status'] = 'detected'): Incident {
  return {
    id,
    status,
    tile: { x, z },
    pos: { x, z },
    detectedAt: 0,
    assignedFollowerIds: [],
  };
}

function unit(
  id: number,
  x: number,
  z: number,
  type: VehicleType,
  waterRemaining: number,
  busy = false,
): CostDispatchableUnit {
  return { id, type, pos: { x, z }, busy, waterRemaining };
}

describe('assignByCost', () => {
  it('prefers a closer firetruck with water over a distant one', () => {
    const incidents = [inc(1, 0, 0)];
    const units = [
      unit(10, 20, 0, VehicleType.FIRETRUCK, 4000),
      unit(11, 10, 0, VehicleType.FIRETRUCK, 4000), // closer
    ];
    const result = assignByCost(incidents, units);
    expect(result[0].unitIds).toEqual([11]);
  });

  it('prefers a farther firetruck with full water over a close one that is empty', () => {
    const incidents = [inc(1, 0, 0)];
    const units = [
      unit(10, 5, 0, VehicleType.FIRETRUCK, 0),    // close but no water
      unit(11, 30, 0, VehicleType.FIRETRUCK, 4000), // farther, full
    ];
    const result = assignByCost(incidents, units);
    expect(result[0].unitIds).toEqual([11]);
  });

  it('prefers a firetruck over a firefighter at similar distance', () => {
    const incidents = [inc(1, 0, 0)];
    const units = [
      unit(10, 20, 0, VehicleType.FIRETRUCK, 4000),
      unit(11, 20, 0, VehicleType.FIREFIGHTER, 20),
    ];
    const result = assignByCost(incidents, units);
    expect(result[0].unitIds).toEqual([10]);
  });

  it('falls back to a firefighter when every firetruck is empty', () => {
    const incidents = [inc(1, 0, 0)];
    const units = [
      unit(10, 20, 0, VehicleType.FIRETRUCK, 0),
      unit(11, 50, 0, VehicleType.FIREFIGHTER, 20),
    ];
    const result = assignByCost(incidents, units);
    expect(result[0].unitIds).toEqual([11]);
  });

  it('does not double-assign and skips busy / non-suppression units', () => {
    const incidents = [inc(1, 0, 0), inc(2, 100, 0)];
    const units = [
      unit(10, 1, 0, VehicleType.CAR, 0),                      // non-suppression
      unit(11, 5, 0, VehicleType.FIRETRUCK, 4000, true),       // busy
      unit(12, 10, 0, VehicleType.FIRETRUCK, 4000),            // take incident 1
      unit(13, 95, 0, VehicleType.FIRETRUCK, 4000),            // take incident 2
    ];
    const result = assignByCost(incidents, units);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ incidentId: 1, unitIds: [12] });
    expect(result[1]).toEqual({ incidentId: 2, unitIds: [13] });
  });

  it('skips already-assigned incidents', () => {
    const incidents = [inc(1, 0, 0, 'assigned'), inc(2, 20, 0)];
    const units = [unit(10, 10, 0, VehicleType.FIRETRUCK, 4000)];
    const result = assignByCost(incidents, units);
    expect(result).toHaveLength(1);
    expect(result[0].incidentId).toBe(2);
  });

  it('skips units that cannot service the incident position', () => {
    const incidents = [inc(1, 0, 0)];
    // The closer truck cannot route (e.g. incident is far from its road);
    // the helicopter can fly anywhere and must win despite being farther.
    const truck = { ...unit(10, 5, 0, VehicleType.FIRETRUCK, 4000), canService: () => false };
    const heli = { ...unit(11, 50, 0, VehicleType.HELICOPTER, 1000), canService: () => true };
    const result = assignByCost(incidents, [truck, heli]);
    expect(result).toHaveLength(1);
    expect(result[0].unitIds).toEqual([11]);
  });
});
