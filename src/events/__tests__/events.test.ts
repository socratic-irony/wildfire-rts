import { describe, it, expect } from 'vitest';
import { createEventSystem, createRng } from '../events';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid , fuelIndex, fuelKeyOf} from '../../fire/grid';
import type { Env } from '../../fire/sim';

function makeGrid(size = 16) {
  const hm = generateHeightmap(size, size, 1, {
    seed: 'flat',
    frequency: 0,
    amplitude: 0,
    octaves: 1,
    persistence: 1,
  });
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes, { cellSize: 1 });
}

function runFor(
  sys: ReturnType<typeof createEventSystem>,
  grid: ReturnType<typeof makeGrid>,
  env: Env,
  seconds: number,
  ignitions: Array<{ x: number; z: number }>,
) {
  const dt = 0.05;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    sys.tick(dt, grid, env, (tile) => ignitions.push(tile));
  }
}

describe('createRng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a1 = createRng('seed-a');
    const a2 = createRng('seed-a');
    const b = createRng('seed-b');
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const v of seqA1) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of seqA1) expect(v).toBeLessThan(1);
  });
});

describe('createEventSystem', () => {
  it('does nothing while disabled', () => {
    const grid = makeGrid();
    const env: Env = { windDirRad: 0, windSpeed: 0 };
    const sys = createEventSystem('s');
    const ignitions: Array<{ x: number; z: number }> = [];
    runFor(sys, grid, env, 300, ignitions);
    expect(ignitions).toHaveLength(0);
    expect(sys.getLog()).toHaveLength(0);
    expect(env.windSpeed).toBe(0);
  });

  it('produces lightning and wind shifts over time when enabled', () => {
    const grid = makeGrid();
    const env: Env = { windDirRad: 0, windSpeed: 0 };
    const sys = createEventSystem('s', { lightningMeanIntervalSec: 10, windShiftMeanIntervalSec: 10 });
    sys.setEnabled(true);
    const ignitions: Array<{ x: number; z: number }> = [];
    runFor(sys, grid, env, 120, ignitions);

    const log = sys.getLog();
    expect(log.some((e) => e.kind === 'lightning')).toBe(true);
    expect(log.some((e) => e.kind === 'wind-shift')).toBe(true);
    expect(ignitions.length).toBeGreaterThan(0);
    // Wind eased toward a non-zero target.
    expect(env.windSpeed).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const env1: Env = { windDirRad: 0, windSpeed: 0 };
    const env2: Env = { windDirRad: 0, windSpeed: 0 };
    const sysA = createEventSystem('same-seed');
    const sysB = createEventSystem('same-seed');
    sysA.setEnabled(true);
    sysB.setEnabled(true);
    const ignA: Array<{ x: number; z: number }> = [];
    const ignB: Array<{ x: number; z: number }> = [];
    runFor(sysA, makeGrid(), env1, 200, ignA);
    runFor(sysB, makeGrid(), env2, 200, ignB);
    expect(ignA).toEqual(ignB);
    expect(sysA.getLog()).toEqual(sysB.getLog());
    expect(env1.windSpeed).toBeCloseTo(env2.windSpeed, 10);
    expect(env1.windDirRad).toBeCloseTo(env2.windDirRad, 10);
  });

  it('only strikes ignitable fuel (never rock/water/urban)', () => {
    const grid = makeGrid();
    // Mark a band of tiles urban (road) — lightning must avoid them.
    for (let x = 0; x < grid.width; x++) {
      grid.fuel[5 * grid.width + x] = fuelIndex('urban');
    }
    const env: Env = { windDirRad: 0, windSpeed: 0 };
    const sys = createEventSystem('strike', { lightningMeanIntervalSec: 5 });
    sys.setEnabled(true);
    const ignitions: Array<{ x: number; z: number }> = [];
    runFor(sys, grid, env, 300, ignitions);
    expect(ignitions.length).toBeGreaterThan(0);
    for (const tile of ignitions) {
      expect(['rock', 'water', 'urban']).not.toContain(fuelKeyOf(grid, tile.z * grid.width + tile.x));
    }
  });
});
