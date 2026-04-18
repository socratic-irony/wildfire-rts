import { VehicleType } from './types';

export type VehicleTypeDefaults = {
  speedTilesPerSec: number;
  color: number;
  emissive: number;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  // Behavior flags
  canOffroad: boolean;
  isAirborne: boolean;
  // Payload / fuel (placeholders for upcoming dispatch + fuel model — ROADMAP item 3)
  waterCapacity: number;   // liters; 0 = no water tank
  fuelCapacity: number;    // liters
  fuelBurnPerSec: number;  // liters/sec at nominal load
};

export const VEHICLE_DEFAULTS: Record<VehicleType, VehicleTypeDefaults> = {
  [VehicleType.CAR]: {
    speedTilesPerSec: 3.2,
    color: 0x1e90ff,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.7,
    metalness: 0.1,
    canOffroad: false,
    isAirborne: false,
    waterCapacity: 0,
    fuelCapacity: 60,
    fuelBurnPerSec: 0.002,
  },
  [VehicleType.FIRETRUCK]: {
    speedTilesPerSec: 2.5,
    color: 0xcc0000,
    emissive: 0x220000,
    emissiveIntensity: 0.3,
    roughness: 0.6,
    metalness: 0.2,
    canOffroad: false,
    isAirborne: false,
    waterCapacity: 4000,
    fuelCapacity: 200,
    fuelBurnPerSec: 0.01,
  },
  [VehicleType.BULLDOZER]: {
    speedTilesPerSec: 1.5,
    color: 0xffdd00,
    emissive: 0x332200,
    emissiveIntensity: 0.2,
    roughness: 0.8,
    metalness: 0.3,
    canOffroad: true,
    isAirborne: false,
    waterCapacity: 0,
    fuelCapacity: 300,
    fuelBurnPerSec: 0.015,
  },
  [VehicleType.HELICOPTER]: {
    speedTilesPerSec: 5,
    color: 0x4a4a4a,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.5,
    metalness: 0.6,
    canOffroad: true,
    isAirborne: true,
    waterCapacity: 1000,
    fuelCapacity: 500,
    fuelBurnPerSec: 0.05,
  },
  [VehicleType.AIRPLANE]: {
    speedTilesPerSec: 7,
    color: 0xe0e0e0,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.4,
    metalness: 0.7,
    canOffroad: true,
    isAirborne: true,
    waterCapacity: 12000,
    fuelCapacity: 4000,
    fuelBurnPerSec: 0.3,
  },
  [VehicleType.FIREFIGHTER]: {
    speedTilesPerSec: 2.8,
    color: 0xff8800,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    canOffroad: true,
    isAirborne: false,
    waterCapacity: 20,
    fuelCapacity: 0,
    fuelBurnPerSec: 0,
  },
};

export function getDefaults(t: VehicleType): VehicleTypeDefaults {
  return VEHICLE_DEFAULTS[t] ?? VEHICLE_DEFAULTS[VehicleType.CAR];
}
