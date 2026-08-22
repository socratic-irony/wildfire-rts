import { describe, it, expect } from 'vitest';
import { Mesh, Object3D } from 'three';
import { VehicleType } from '../types';
import { createVehicleMesh, CIVILIAN_STYLES } from '../meshes';

function countMeshes(root: Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if ((child as Mesh).isMesh) count++;
  });
  return count;
}

describe('createVehicleMesh', () => {
  it('merges decorative parts into few meshes per style/type', () => {
    // Civilians: merged body + merged wheel + yield indicator.
    for (const style of CIVILIAN_STYLES) {
      const g = createVehicleMesh(VehicleType.CAR, 1, { civilianStyle: style });
      expect(countMeshes(g)).toBeLessThanOrEqual(3);
    }
    expect(countMeshes(createVehicleMesh(VehicleType.FIRETRUCK, 1))).toBeLessThanOrEqual(6);
    expect(countMeshes(createVehicleMesh(VehicleType.BULLDOZER, 1))).toBeLessThanOrEqual(3);
    expect(countMeshes(createVehicleMesh(VehicleType.HELICOPTER, 1))).toBeLessThanOrEqual(4);
    expect(countMeshes(createVehicleMesh(VehicleType.AIRPLANE, 1))).toBeLessThanOrEqual(4);
    expect(countMeshes(createVehicleMesh(VehicleType.FIREFIGHTER, 1))).toBeLessThanOrEqual(3);
  });

  it('exposes a yield indicator via userData', () => {
    const g = createVehicleMesh(VehicleType.CAR, 1);
    const indicator = g.userData.yieldIndicator;
    expect(indicator).toBeTruthy();
    expect(indicator.visible).toBe(false);
    expect(indicator.position.y).toBeGreaterThan(0);
    expect(indicator.material.depthTest).toBe(false);
    expect(indicator.renderOrder).toBeGreaterThan(20);
  });

  it('renders vehicle parts after raised road overlays', () => {
    const g = createVehicleMesh(VehicleType.CAR, 1);
    const renderedParts: Mesh[] = [];
    g.traverse((child) => {
      if ((child as Mesh).isMesh && child !== g.userData.yieldIndicator) renderedParts.push(child as Mesh);
    });
    expect(renderedParts.length).toBeGreaterThan(0);
    expect(renderedParts.every((part) => part.renderOrder >= 20)).toBe(true);
  });

  it('firetruck includes a ladder detail', () => {
    const g = createVehicleMesh(VehicleType.FIRETRUCK, 1);
    expect(g.getObjectByName('ladder')).toBeTruthy();
  });

  it('bulldozer includes a blade detail', () => {
    const g = createVehicleMesh(VehicleType.BULLDOZER, 1);
    expect(g.getObjectByName('blade')).toBeTruthy();
  });

  it('helicopter has rotor + skids and no wheels', () => {
    const g = createVehicleMesh(VehicleType.HELICOPTER, 1);
    expect(g.getObjectByName('rotor')).toBeTruthy();
    expect(g.getObjectByName('skid')).toBeTruthy();
    expect(g.getObjectByName('wheel')).toBeFalsy();
  });

  it('airplane has wings + tail fin and no wheels', () => {
    const g = createVehicleMesh(VehicleType.AIRPLANE, 1);
    expect(g.getObjectByName('wings')).toBeTruthy();
    expect(g.getObjectByName('tailFin')).toBeTruthy();
    expect(g.getObjectByName('wheel')).toBeFalsy();
  });

  it('firefighter has a helmet and no wheels', () => {
    const g = createVehicleMesh(VehicleType.FIREFIGHTER, 1);
    expect(g.getObjectByName('helmet')).toBeTruthy();
    expect(g.getObjectByName('wheel')).toBeFalsy();
  });

  it('keeps runtime FX hooks: mainRotor group and flashable lightbar pair', () => {
    const heli = createVehicleMesh(VehicleType.HELICOPTER, 1);
    const rotorGroup = heli.userData.mainRotor as Object3D;
    expect(rotorGroup).toBeTruthy();
    // Spinning the group must move the (merged) rotor mesh inside it.
    expect(rotorGroup.children.some((c) => (c as Mesh).isMesh)).toBe(true);

    const truck = createVehicleMesh(VehicleType.FIRETRUCK, 1);
    const lightbar = truck.userData.lightbar as Object3D;
    expect(lightbar).toBeTruthy();
    // The flash animation reads children[0]/children[1] emissive materials.
    expect(lightbar.children.length).toBe(2);
    const redMat = ((lightbar.children[0] as Mesh).material as unknown as { emissiveIntensity: number });
    const blueMat = ((lightbar.children[1] as Mesh).material as unknown as { emissiveIntensity: number });
    expect(redMat.emissiveIntensity).toBeDefined();
    expect(blueMat.emissiveIntensity).toBeDefined();
  });

  it('merged bodies cast shadows and carry per-vertex colors', () => {
    for (const t of [VehicleType.CAR, VehicleType.FIRETRUCK, VehicleType.BULLDOZER]) {
      const g = createVehicleMesh(t, 1);
      const body = g.getObjectByName('body') as Mesh;
      expect(body).toBeTruthy();
      expect(body.castShadow).toBe(true);
      expect(body.geometry.getAttribute('color')).toBeTruthy();
    }
  });

  it('merged ground vehicles keep a wheel mesh with baked transforms', () => {
    for (const style of CIVILIAN_STYLES) {
      const g = createVehicleMesh(VehicleType.CAR, 1, { civilianStyle: style });
      const wheel = g.getObjectByName('wheel') as Mesh;
      expect(wheel).toBeTruthy();
      // Wheels sit above the ground plane after their transforms are baked in.
      wheel.geometry.computeBoundingBox();
      expect(wheel.geometry.boundingBox!.max.y).toBeGreaterThan(0);
    }
  });
});
