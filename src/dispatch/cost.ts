import { VehicleType } from '../vehicles/types';
import type { Incident } from './incident';
import type { Assignment, DispatchableUnit } from './assignment';

export type CostDispatchableUnit = DispatchableUnit & {
  /** Current liters of water the unit carries. 0 for non-water units. */
  waterRemaining: number;
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

function typeBias(t: VehicleType): number {
  // Lower is better. Firetrucks are the canonical ground suppression unit,
  // so they win ties against a firefighter sent on foot.
  switch (t) {
    case VehicleType.FIRETRUCK: return 0.8;
    case VehicleType.HELICOPTER: return 0.9;
    case VehicleType.AIRPLANE: return 0.95;
    case VehicleType.FIREFIGHTER: return 1.1;
    default: return 1.3;
  }
}

function waterPenalty(u: CostDispatchableUnit): number {
  // Firefighters carry a token 20 L; we don't want to penalize them for that.
  // For tanker-class units (firetruck/heli/plane), empty tanks are a hard
  // demotion because they can't suppress — they have to refill first.
  if (u.type === VehicleType.FIREFIGHTER) return 1.0;
  if (u.type !== VehicleType.FIRETRUCK && u.type !== VehicleType.HELICOPTER && u.type !== VehicleType.AIRPLANE) {
    return 1.0;
  }
  if (u.waterRemaining <= 0) return 8.0;
  if (u.waterRemaining < 500) return 1.8;
  return 1.0;
}

/**
 * Cost-based assignment. For each detected incident, pick the idle
 * suppression unit that minimizes:
 *
 *   cost = distance * typeBias(type) * waterPenalty(unit)
 *
 * This preserves the "closest usually wins" intuition of the greedy
 * assignment while correcting two well-known pathologies:
 *
 *   - a close-but-empty firetruck being sent to a fire it can't fight
 *   - a lone firefighter being picked over a firetruck at similar range
 *
 * Incidents are processed in their natural order; within each incident
 * the cheapest unit is claimed. This replaced the greedy nearest-idle
 * baseline that previously lived in ./assignment.ts.
 */
export function assignByCost(
  incidents: ReadonlyArray<Incident>,
  units: ReadonlyArray<CostDispatchableUnit>,
): Assignment[] {
  const assignments: Assignment[] = [];
  const claimed = new Set<number>();

  for (const inc of incidents) {
    if (inc.status !== 'detected') continue;

    let bestUnit: CostDispatchableUnit | undefined;
    let bestCost = Infinity;
    for (const u of units) {
      if (u.busy || claimed.has(u.id)) continue;
      if (!isSuppressionUnit(u.type)) continue;
      const dx = u.pos.x - inc.pos.x;
      const dz = u.pos.z - inc.pos.z;
      const dist = Math.hypot(dx, dz);
      const cost = dist * typeBias(u.type) * waterPenalty(u);
      if (cost < bestCost) { bestCost = cost; bestUnit = u; }
    }

    if (bestUnit) {
      claimed.add(bestUnit.id);
      assignments.push({ incidentId: inc.id, unitIds: [bestUnit.id] });
    }
  }

  return assignments;
}
