import type { Vector3 } from 'three';

export enum VehicleType {
  CAR = 'car',
  FIRETRUCK = 'firetruck',
  BULLDOZER = 'bulldozer',
  HELICOPTER = 'helicopter',
  AIRPLANE = 'airplane',
  FIREFIGHTER = 'firefighter'
}

export type VehicleFxState = {
  id: number;
  pos: Vector3;
  forward: Vector3;
  up: Vector3;
  right: Vector3;
  speed: number;
  type: VehicleType;
  sprayingWater?: boolean;
  siren?: boolean;
};
