import { describe, it, expect } from 'vitest';
import { VehicleType } from '../../vehicles/types';
import { assignNearestIdle, type DispatchableUnit } from '../assignment';
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

function unit(id: number, x: number, z: number, type: VehicleType, busy = false): DispatchableUnit {
  return { id, type, pos: { x, z }, busy };
}

describe('assignNearestIdle', () => {
  it('matches the closest idle suppression unit', () => {
    const incidents = [inc(1, 100, 100)];
    const units = [
      unit(10, 200, 200, VehicleType.FIRETRUCK),
      unit(11, 110, 105, VehicleType.FIRETRUCK), // closest
      unit(12, 120, 110, VehicleType.FIRETRUCK),
    ];

    const result = assignNearestIdle(incidents, units);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ incidentId: 1, unitIds: [11] });
  });

  it('skips busy units', () => {
    const incidents = [inc(1, 0, 0)];
    const units = [
      unit(10, 5, 0, VehicleType.FIRETRUCK, true), // busy
      unit(11, 50, 0, VehicleType.FIRETRUCK),
    ];

    const result = assignNearestIdle(incidents, units);

    expect(result[0].unitIds).toEqual([11]);
  });

  it('skips non-suppression vehicles', () => {
    const incidents = [inc(1, 0, 0)];
    const units = [
      unit(10, 1, 0, VehicleType.CAR),
      unit(11, 1, 0, VehicleType.BULLDOZER),
      unit(12, 50, 0, VehicleType.FIRETRUCK),
    ];

    const result = assignNearestIdle(incidents, units);

    expect(result[0].unitIds).toEqual([12]);
  });

  it('does not double-assign a unit across incidents', () => {
    const incidents = [inc(1, 0, 0), inc(2, 5, 0)];
    const units = [unit(10, 2, 0, VehicleType.FIRETRUCK)];

    const result = assignNearestIdle(incidents, units);

    expect(result).toHaveLength(1);
    expect(result[0].incidentId).toBe(1);
  });

  it('skips already-assigned incidents', () => {
    const incidents = [inc(1, 0, 0, 'assigned'), inc(2, 10, 0)];
    const units = [unit(10, 5, 0, VehicleType.FIRETRUCK)];

    const result = assignNearestIdle(incidents, units);

    expect(result).toHaveLength(1);
    expect(result[0].incidentId).toBe(2);
  });
});
