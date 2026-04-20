import { describe, it, expect } from 'vitest';
import { Mesh } from 'three';
import { VehicleType } from '../types';
import { createVehicleMesh } from '../meshes';

describe('createVehicleMesh', () => {
  it('returns a group with body + four wheels for each vehicle type', () => {
    for (const t of [VehicleType.FIRETRUCK, VehicleType.BULLDOZER, VehicleType.CAR]) {
      const g = createVehicleMesh(t, 1);
      const meshChildren = g.children.filter((c) => (c as Mesh).isMesh);
      // body (1) + 4 wheels + at least one type-specific detail
      expect(meshChildren.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('exposes a yield indicator via userData', () => {
    const g = createVehicleMesh(VehicleType.CAR, 1);
    const indicator = g.userData.yieldIndicator;
    expect(indicator).toBeTruthy();
    expect(indicator.visible).toBe(false);
  });

  it('firetruck includes a ladder detail', () => {
    const g = createVehicleMesh(VehicleType.FIRETRUCK, 1);
    expect(g.getObjectByName('ladder')).toBeTruthy();
  });

  it('bulldozer includes a blade detail', () => {
    const g = createVehicleMesh(VehicleType.BULLDOZER, 1);
    expect(g.getObjectByName('blade')).toBeTruthy();
  });
});
