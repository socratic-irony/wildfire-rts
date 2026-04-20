import type { ScenarioDef } from './scenario';

/**
 * Baseline MVP scenario: a small fire is ignited near the default
 * firetruck fleet. The player (or auto-dispatch) must keep the total
 * burned footprint under the containment budget for the time limit.
 *
 * The ignition point is a fixed tile, not a unit-relative one. Baseline
 * spawns place at least one firetruck within auto-dispatch range.
 */
export const defaultContainmentScenario: ScenarioDef = {
  id: 'mvp-containment-1',
  seed: '42',
  description: 'Keep the fire footprint below 400 tiles for 60 simulated seconds.',
  ignitions: [{ x: 64, z: 64, heat: 0.9 }],
  containmentBudget: 400,
  timeLimitSec: 60,
};
