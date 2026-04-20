import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import type { HydrantSystem, FireHydrant } from '../hydrants';
import { createHydrantCoverageRings } from '../hydrantCoverage';

function makeSystem(hydrants: FireHydrant[]): HydrantSystem {
  return { hydrants, spacingCells: 10 } as unknown as HydrantSystem;
}

function hydrant(x: number, z: number, active = true, coverageRadius = 5): FireHydrant {
  return {
    id: x * 1000 + z,
    gridPos: { x, z },
    worldPos: { x, z },
    roadPathIndex: 0,
    distanceAlongPath: 0,
    coverageRadius,
    active,
  } as FireHydrant;
}

describe('hydrantCoverageRings', () => {
  it('renders one ring per active hydrant', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 's', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const rings = createHydrantCoverageRings(hm);
    rings.update(makeSystem([hydrant(5, 5, true), hydrant(10, 10, true)]));
    expect((rings.inst as any).count).toBe(2);
  });

  it('skips inactive hydrants', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 's', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const rings = createHydrantCoverageRings(hm);
    rings.update(makeSystem([hydrant(5, 5, true), hydrant(10, 10, false)]));
    expect((rings.inst as any).count).toBe(1);
  });

  it('toggles visibility', () => {
    const hm = generateHeightmap(16, 16, 1, { seed: 's', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
    const rings = createHydrantCoverageRings(hm);
    rings.setVisible(false);
    expect(rings.inst.visible).toBe(false);
    rings.setVisible(true);
    expect(rings.inst.visible).toBe(true);
  });
});
