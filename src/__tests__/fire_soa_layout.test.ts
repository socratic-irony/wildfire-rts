import { describe, expect, it } from 'vitest';
import { generateHeightmap } from '../terrain/heightmap';
import { computeBiomes } from '../terrain/biomes';
import { buildFireGrid, ignite, FireGrid, FUEL_KEYS, fuelIndex, fuelKeyOf } from '../fire/grid';
import { FireSim } from '../fire/sim';

function createFlatHeightmap(width: number, height: number) {
  return generateHeightmap(width, height, 1, {
    seed: 'flat',
    frequency: 0,
    amplitude: 0,
    octaves: 1,
    persistence: 1,
  });
}

function makeGrid(width = 128, height = 128): FireGrid {
  const hm = createFlatHeightmap(width, height);
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes, {
    cellSize: 1,
    spotting: { enabled: false, baseRate: 0, maxDistanceTiles: 0 },
  });
}

/** Seed ~500 burning tiles deterministically and run `ticks` fixed steps. */
function runSeededBurn(grid: FireGrid, ticks: number) {
  const step = Math.max(1, Math.floor(Math.sqrt((grid.width * grid.height) / 500)));
  let seeded = 0;
  for (let z = 2; z < grid.height - 2 && seeded < 500; z += step) {
    for (let x = 2; x < grid.width - 2 && seeded < 500; x += step) {
      ignite(grid, [{ x, z }], 0.8);
      seeded++;
    }
  }
  const sim = new FireSim(grid, { windDirRad: 0.7, windSpeed: 2 });
  for (let t = 0; t < ticks; t++) sim.step(0.25);
}

describe('fire grid structure-of-arrays layout', () => {
  it('allocates every per-tile array at width*height', () => {
    const grid = makeGrid(64, 48);
    const cap = 64 * 48;
    expect(grid.state.length).toBe(cap);
    expect(grid.heat.length).toBe(cap);
    expect(grid.progress.length).toBe(cap);
    expect(grid.wetness.length).toBe(cap);
    expect(grid.retardant.length).toBe(cap);
    expect(grid.lineStrength.length).toBe(cap);
    expect(grid.fuelMoisture.length).toBe(cap);
    expect(grid.lastIgnitedAt.length).toBe(cap);
    expect(grid.fuel.length).toBe(cap);
    expect(grid.slopeTan.length).toBe(cap);
    expect(grid.downX.length).toBe(cap);
    expect(grid.downZ.length).toBe(cap);
    expect(grid.igniting.length).toBe(cap);
    expect(grid.burning.length).toBe(cap);
    expect(grid.smoldering.length).toBe(cap);
  });

  it('fuel indices round-trip through FUEL_KEYS/fuelKeyOf', () => {
    for (const key of FUEL_KEYS) {
      expect(FUEL_KEYS[fuelIndex(key)]).toBe(key);
    }
    const grid = makeGrid(16, 16);
    for (let i = 0; i < grid.fuel.length; i++) {
      const key = fuelKeyOf(grid, i);
      expect(fuelIndex(key)).toBe(grid.fuel[i]);
    }
  });

  it('two seeded runs evolve identically and stay NaN-free', () => {
    const run = () => {
      const grid = makeGrid(128, 128);
      runSeededBurn(grid, 60);
      return grid;
    };
    const a = run();
    const b = run();

    // Frontier sizes match exactly at every checkpoint
    expect(b.iCount).toBe(a.iCount);
    expect(b.bCount).toBe(a.bCount);
    expect(b.sCount).toBe(a.sCount);
    // Full state vectors bit-identical
    expect(Buffer.compare(Buffer.from(b.state), Buffer.from(a.state))).toBe(0);
    expect(Buffer.compare(Buffer.from(b.heat.buffer), Buffer.from(a.heat.buffer))).toBe(0);
    expect(Buffer.compare(Buffer.from(b.progress.buffer), Buffer.from(a.progress.buffer))).toBe(0);

    // No NaNs anywhere after 60 ticks
    for (const arr of [a.heat, a.progress, a.wetness, a.retardant]) {
      for (let i = 0; i < arr.length; i++) expect(Number.isNaN(arr[i])).toBe(false);
    }
  });

  it('tick() over a synthetic 16k grid with 500 burning tiles stays well within frame budget', () => {
    const grid = makeGrid(128, 128);
    const start = performance.now();
    runSeededBurn(grid, 120); // 30 simulated seconds
    const elapsedMs = performance.now() - start;
    // Generous bound: this is a regression tripwire, not a benchmark.
    // (AoS baseline ran this workload in tens of milliseconds; SoA should be faster.)
    expect(elapsedMs).toBeLessThan(2000);

    // Functional invariant: fire actually progressed rather than stalling/vanishing
    expect(grid.state.some(s => s > 0)).toBe(true);
  });
});
