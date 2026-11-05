export interface IncidentView {
  id: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  resolved: boolean;
}

export type NotifyTone = 'info' | 'warning' | 'danger' | 'success' | 'hint';

export type NotifyFn = (message: string, tone?: NotifyTone) => void;

export interface UnitSnapshot {
  id: number;
  kind: string;
  name: string;
  state: string;
  status: string;
  water: number;
  capacity: number;
  x: number;
  z: number;
  incidentId: number | null;
  hydrantConnected: boolean;
  selected: boolean;
  /** Seconds until a unit pulled out by a burnover is available again. */
  outOfService: number;
  /** Burnover heat stress, 0..1. */
  exposure: number;
  mutualAid: boolean;
  /** Auto-dispatch may claim this unit when it is free. */
  auto: boolean;
  /** Facing in radians (atan2 of x, z), for minimap arrows. */
  heading: number;
  /** Hydrant the engine is driving to or filling from, if any. */
  refill: { x: number; z: number; filling: boolean } | null;
}
