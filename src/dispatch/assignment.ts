import type { VehicleType } from '../vehicles/types';

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

// Assignment strategy lives in cost.ts (assignByCost); this module holds the
// shared dispatch types.
