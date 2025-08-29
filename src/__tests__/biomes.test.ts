import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes, computeSlopeMap } from '../terrain/biomes';

function flatHM(width: number, height: number) {
  const hm = generateHeightmap(width, height, 1, {
    seed: 0,
    frequency: 0,
    amplitude: 0,
    octaves: 1,
    persistence: 0.5,
  });
  hm.data.fill(0);
  return hm;
}

describe('biomes and slopes', () => {
  it('slope is ~0 on flat heightmap', () => {
    const hm = flatHM(16, 16);
    const slope = computeSlopeMap(hm);
    // ignore borders (not computed)
    const center = slope[9 * (16 + 1) + 9];
    expect(center).toBeLessThan(0.001);
  });

  it('slope matches analytic ramp (~26.56° for a=1)', () => {
    const hm = flatHM(16, 16);
    const cols = hm.width + 1;
    for (let z = 0; z < 17; z++) {
      for (let x = 0; x < 17; x++) hm.data[z * cols + x] = x; // a=1
    }
    const slope = computeSlopeMap(hm);
    const center = slope[8 * (16 + 1) + 8];
    expect(center).toBeGreaterThan(26);
    expect(center).toBeLessThan(27.2);
  });

  it('rock mask appears on steep terrain and not on flat', () => {
    const flat = flatHM(16, 16);
    const bFlat = computeBiomes(flat);
    const rockFlat = Array.from(bFlat.rock).reduce((a, b) => a + b, 0);
    expect(rockFlat).toBe(0);

    const steep = flatHM(16, 16);
    const cols = steep.width + 1;
    for (let z = 0; z < 17; z++) {
      for (let x = 0; x < 17; x++) steep.data[z * cols + x] = 2 * x; // a=2 -> ~45°
    }
    const bSteep = computeBiomes(steep);
    const rockSteep = Array.from(bSteep.rock).reduce((a, b) => a + b, 0);
    expect(rockSteep).toBeGreaterThan(0);
  });
});

