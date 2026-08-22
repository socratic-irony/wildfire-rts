import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../../terrain/heightmap';
import { computeBiomes } from '../../terrain/biomes';
import { buildFireGrid, ignite, FireState } from '../../fire/grid';
import { countFireFootprint, createScenarioRunner, evaluateScenario } from '../scenario';
import type { ScenarioDef } from '../scenario';

function flatFireGrid(size = 16) {
  const hm = generateHeightmap(size, size, 1, { seed: 's', frequency: 0, amplitude: 0, octaves: 1, persistence: 1 });
  const biomes = computeBiomes(hm);
  return buildFireGrid(hm, biomes);
}

describe('evaluateScenario', () => {
  const def: ScenarioDef = {
    id: 'test',
    seed: 'test',
    ignitions: [],
    containmentBudget: 10,
    timeLimitSec: 60,
  };

  it('returns pending while footprint is under budget and time remaining', () => {
    expect(evaluateScenario(def, 30, 5)).toBe('pending');
  });

  it('returns loss as soon as footprint exceeds budget', () => {
    expect(evaluateScenario(def, 1, 11)).toBe('loss');
  });

  it('returns win at time limit with footprint within budget', () => {
    expect(evaluateScenario(def, 60, 10)).toBe('win');
  });

  it('prefers loss over win when both conditions meet at time limit', () => {
    expect(evaluateScenario(def, 60, 11)).toBe('loss');
  });
});

describe('countFireFootprint', () => {
  it('counts tiles in any non-Unburned state', () => {
    const grid = flatFireGrid(8);
    expect(countFireFootprint(grid)).toBe(0);

    ignite(grid, [{ x: 4, z: 4 }], 0.9);
    // Igniting tile counts as footprint.
    expect(countFireFootprint(grid)).toBeGreaterThan(0);

    // Manually mark a Burned tile — footprint still counts it.
    grid.state[0] = FireState.Burned;
    expect(countFireFootprint(grid)).toBeGreaterThanOrEqual(2);
  });
});

describe('createScenarioRunner', () => {
  it('latches on loss once footprint breaches budget, even if budget would later be met', () => {
    const def: ScenarioDef = { id: 't', seed: 't', ignitions: [], containmentBudget: 5, timeLimitSec: 10 };
    const runner = createScenarioRunner(def);
    expect(runner.result).toBe('pending');
    runner.tick(1, 6);
    expect(runner.result).toBe('loss');
    runner.tick(1, 3);
    expect(runner.result).toBe('loss');
  });

  it('latches on win at time limit and stays there', () => {
    const def: ScenarioDef = { id: 't', seed: 't', ignitions: [], containmentBudget: 100, timeLimitSec: 2 };
    const runner = createScenarioRunner(def);
    runner.tick(1, 10);
    expect(runner.result).toBe('pending');
    runner.tick(1, 20);
    expect(runner.result).toBe('win');
    runner.tick(1, 200);
    expect(runner.result).toBe('win');
  });
});
