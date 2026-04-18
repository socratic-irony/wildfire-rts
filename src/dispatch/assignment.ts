import { VehicleType } from '../vehicles/types';
import type { Incident } from './incident';

export type DispatchableUnit = {
  id: number;
  type: VehicleType;
  pos: { x: number; z: number };
  busy: boolean;
};

export type Assignment = {
  incidentId: number;
  unitIds: number[];
};

const SUPPRESSION_TYPES: ReadonlyArray<VehicleType> = [
  VehicleType.FIRETRUCK,
  VehicleType.HELICOPTER,
  VehicleType.AIRPLANE,
  VehicleType.FIREFIGHTER,
];

function isSuppressionUnit(t: VehicleType): boolean {
  return SUPPRESSION_TYPES.includes(t);
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/**
 * Greedy nearest-idle assignment: for each unassigned incident, pick the
 * closest idle suppression unit. Returns one assignment per incident that
 * could be matched. Caller is responsible for marking units busy and
 * incidents assigned.
 *
 * This is intentionally simple — replace with cost-based or
 * priority-queued assignment in a follow-up (see ROADMAP item 1).
 */
export function assignNearestIdle(
  incidents: ReadonlyArray<Incident>,
  units: ReadonlyArray<DispatchableUnit>
): Assignment[] {
  const assignments: Assignment[] = [];
  const claimed = new Set<number>();

  for (const inc of incidents) {
    if (inc.status !== 'detected') continue;

    let bestUnit: DispatchableUnit | undefined;
    let bestD2 = Infinity;
    for (const u of units) {
      if (u.busy || claimed.has(u.id)) continue;
      if (!isSuppressionUnit(u.type)) continue;
      const d2 = dist2(u.pos, inc.pos);
      if (d2 < bestD2) { bestD2 = d2; bestUnit = u; }
    }

    if (bestUnit) {
      claimed.add(bestUnit.id);
      assignments.push({ incidentId: inc.id, unitIds: [bestUnit.id] });
    }
  }

  return assignments;
}
