import { VehicleType } from './types';
import { getDefaults } from './typeDefaults';

export type PayloadState = {
  fuel: number;          // liters remaining
  fuelCapacity: number;
  water: number;         // liters remaining
  waterCapacity: number;
  fuelBurnPerSec: number;
};

export type PayloadStatus = 'ok' | 'low-water' | 'low-fuel' | 'empty';

export const LOW_FUEL_FRACTION = 0.15;
export const LOW_WATER_FRACTION = 0.10;

export function createPayload(t: VehicleType): PayloadState {
  const d = getDefaults(t);
  return {
    fuel: d.fuelCapacity,
    fuelCapacity: d.fuelCapacity,
    water: d.waterCapacity,
    waterCapacity: d.waterCapacity,
    fuelBurnPerSec: d.fuelBurnPerSec,
  };
}

/** Burn fuel proportional to dt and a load factor (1.0 nominal, >1 uphill/heavy). */
export function tickFuel(p: PayloadState, dt: number, loadFactor = 1): void {
  if (p.fuelCapacity <= 0) return;
  p.fuel = Math.max(0, p.fuel - p.fuelBurnPerSec * loadFactor * dt);
}

/** Consume water for suppression. Returns the amount actually drawn. */
export function consumeWater(p: PayloadState, requested: number): number {
  if (p.waterCapacity <= 0 || requested <= 0) return 0;
  const drawn = Math.min(p.water, requested);
  p.water -= drawn;
  return drawn;
}

export function refuel(p: PayloadState): void { p.fuel = p.fuelCapacity; }
export function refill(p: PayloadState): void { p.water = p.waterCapacity; }

export function status(p: PayloadState): PayloadStatus {
  const fuelEmpty = p.fuelCapacity > 0 && p.fuel <= 0;
  const waterEmpty = p.waterCapacity > 0 && p.water <= 0;
  if (fuelEmpty || (waterEmpty && p.waterCapacity > 0 && p.fuelCapacity === 0)) return 'empty';
  if (p.fuelCapacity > 0 && p.fuel / p.fuelCapacity <= LOW_FUEL_FRACTION) return 'low-fuel';
  if (p.waterCapacity > 0 && p.water / p.waterCapacity <= LOW_WATER_FRACTION) return 'low-water';
  return 'ok';
}

/** True when the unit should head back to base — out of fuel or out of suppressant. */
export function needsReturnToBase(p: PayloadState): boolean {
  const s = status(p);
  return s === 'empty' || s === 'low-fuel' || (p.waterCapacity > 0 && p.water <= 0);
}
