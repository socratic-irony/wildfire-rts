import { describe, it, expect } from 'vitest';
import { VehicleType } from '../types';
import {
  createPayload,
  tickFuel,
  consumeWater,
  refuel,
  refill,
  status,
  needsReturnToBase,
} from '../payload';

describe('payload', () => {
  it('initializes from VehicleType defaults', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    expect(p.water).toBe(p.waterCapacity);
    expect(p.fuel).toBe(p.fuelCapacity);
    expect(p.waterCapacity).toBeGreaterThan(0);
  });

  it('burns fuel over time scaled by load', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    const start = p.fuel;
    tickFuel(p, 10, 1);
    const burned1 = start - p.fuel;
    tickFuel(p, 10, 2);
    const burned2 = start - p.fuel - burned1;
    expect(burned2).toBeCloseTo(burned1 * 2, 5);
  });

  it('clamps fuel at zero', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    tickFuel(p, 1e9, 100);
    expect(p.fuel).toBe(0);
  });

  it('draws water up to remaining capacity', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    const drawn = consumeWater(p, 100);
    expect(drawn).toBe(100);
    expect(p.water).toBe(p.waterCapacity - 100);

    p.water = 50;
    const drawn2 = consumeWater(p, 200);
    expect(drawn2).toBe(50);
    expect(p.water).toBe(0);
  });

  it('reports status thresholds', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    expect(status(p)).toBe('ok');

    p.water = p.waterCapacity * 0.05;
    expect(status(p)).toBe('low-water');

    p.fuel = p.fuelCapacity * 0.05;
    expect(status(p)).toBe('low-fuel');

    p.fuel = 0;
    expect(status(p)).toBe('empty');
  });

  it('signals return-to-base when out of water or fuel', () => {
    const p = createPayload(VehicleType.FIRETRUCK);
    expect(needsReturnToBase(p)).toBe(false);

    p.water = 0;
    expect(needsReturnToBase(p)).toBe(true);

    refill(p);
    p.fuel = p.fuelCapacity * 0.05;
    expect(needsReturnToBase(p)).toBe(true);

    refuel(p);
    expect(needsReturnToBase(p)).toBe(false);
  });

  it('handles vehicles without a water tank', () => {
    const p = createPayload(VehicleType.CAR);
    expect(p.waterCapacity).toBe(0);
    expect(consumeWater(p, 50)).toBe(0);
    expect(status(p)).toBe('ok');
    expect(needsReturnToBase(p)).toBe(false);
  });
});
