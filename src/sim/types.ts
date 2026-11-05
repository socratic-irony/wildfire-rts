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
}
