export interface IncidentView {
  id: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  resolved: boolean;
}

export type NotifyTone = 'info' | 'warning' | 'danger' | 'success';

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
}
