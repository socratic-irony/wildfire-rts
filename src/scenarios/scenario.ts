import { FireGrid, FireState } from '../fire/grid';

export type ScenarioResult = 'pending' | 'win' | 'loss';

export type ScenarioDef = {
  /** Unique identifier. */
  id: string;
  /** Stable seed — lets us reproduce ignitions/fire RNG deterministically. */
  seed: string;
  /** Grid-coord ignitions applied at t=0. Heat defaults to 0.9. */
  ignitions: Array<{ x: number; z: number; heat?: number }>;
  /** Maximum fire footprint (tiles ever touched by fire). Exceeding = loss. */
  containmentBudget: number;
  /** Simulated seconds the player must survive. At t=limit with footprint ≤ budget = win. */
  timeLimitSec: number;
  /** Optional human description. */
  description?: string;
};

export type ScenarioRunner = {
  def: ScenarioDef;
  elapsedSec: number;
  result: ScenarioResult;
  tick: (dtSec: number, footprint: number) => ScenarioResult;
  snapshot: () => { elapsedSec: number; result: ScenarioResult };
};

/**
 * Pure evaluator. Loss takes precedence: footprint over budget is an
 * immediate, latching failure regardless of remaining time.
 */
export function evaluateScenario(def: ScenarioDef, elapsedSec: number, footprint: number): ScenarioResult {
  if (footprint > def.containmentBudget) return 'loss';
  if (elapsedSec >= def.timeLimitSec) return 'win';
  return 'pending';
}

/**
 * Counts tiles ever touched by fire (any non-Unburned state).
 * This is monotonic over the lifetime of a grid — tiles don't un-burn.
 */
export function countFireFootprint(grid: FireGrid): number {
  let n = 0;
  for (let i = 0; i < grid.state.length; i++) {
    if (grid.state[i] !== FireState.Unburned) n++;
  }
  return n;
}

/**
 * Stateful wrapper: once a scenario resolves (win or loss), the result
 * latches — further ticks do not re-evaluate it.
 */
export function createScenarioRunner(def: ScenarioDef): ScenarioRunner {
  const runner: ScenarioRunner = {
    def,
    elapsedSec: 0,
    result: 'pending',
    tick(dtSec, footprint) {
      if (runner.result !== 'pending') return runner.result;
      runner.elapsedSec += dtSec;
      runner.result = evaluateScenario(def, runner.elapsedSec, footprint);
      return runner.result;
    },
    snapshot() {
      return { elapsedSec: runner.elapsedSec, result: runner.result };
    },
  };
  return runner;
}
