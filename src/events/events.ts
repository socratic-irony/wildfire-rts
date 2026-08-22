import { FireState, fuelIndex, type FireGrid } from '../fire/grid';
import type { Env } from '../fire/sim';

/**
 * Random in-game events: lightning ignitions and wind shifts.
 *
 * Deterministic for a fixed seed and tick sequence — the audit fast-forwards
 * with 50 ms chunks and asserts the same seed reproduces the same event log.
 * Disabled by default so existing audit scenarios stay deterministic; the
 * player (or a scenario def) opts in.
 */

export type GameEvent =
  | { kind: 'lightning'; t: number; tile: { x: number; z: number } }
  | { kind: 'wind-shift'; t: number; windDirRad: number; windSpeed: number };

export type EventSystemOptions = {
  /** Mean seconds between lightning strikes (exponential inter-arrival). */
  lightningMeanIntervalSec?: number;
  /** Mean seconds between wind shifts. */
  windShiftMeanIntervalSec?: number;
  /** Wind speed range sampled on each shift, m/s. */
  windSpeedRange?: [number, number];
  /** How fast the live env eases toward the shift target, fraction/sec. */
  windEaseRate?: number;
  /** Max retained log entries. */
  maxLog?: number;
};

export type EventSystem = {
  isEnabled(): boolean;
  setEnabled(on: boolean): void;
  /** Advance by dt sim-seconds. Mutates env in place; ignites via callback. */
  tick(
    dt: number,
    grid: FireGrid,
    env: Env,
    ignite: (tile: { x: number; z: number }, heat: number) => void,
  ): void;
  getLog(): ReadonlyArray<GameEvent>;
};

/** Deterministic 32-bit RNG (mulberry32) seeded from a string. */
export function createRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exponential inter-arrival sample with mean `meanSec`. */
function nextInterval(rng: () => number, meanSec: number): number {
  // Clamp u away from 0 so log() stays finite.
  const u = Math.max(1e-9, rng());
  return -Math.log(u) * meanSec;
}

/** Fuels that lightning can plausibly ignite. */
const ROCK_I = fuelIndex('rock');
const WATER_I = fuelIndex('water');
const URBAN_I = fuelIndex('urban');

function isIgnitable(grid: FireGrid, x: number, z: number): boolean {
  const i = z * grid.width + x;
  const f = grid.fuel[i];
  return (
    grid.state[i] === FireState.Unburned &&
    f !== ROCK_I &&
    f !== WATER_I &&
    f !== URBAN_I
  );
}

export function createEventSystem(seed: string, opts: EventSystemOptions = {}): EventSystem {
  const lightningMean = opts.lightningMeanIntervalSec ?? 35;
  const windShiftMean = opts.windShiftMeanIntervalSec ?? 25;
  const [windMin, windMax] = opts.windSpeedRange ?? [0.5, 8];
  const windEaseRate = opts.windEaseRate ?? 0.6;
  const maxLog = opts.maxLog ?? 256;

  const rng = createRng(seed);
  let enabled = false;
  let clock = 0;
  let nextLightningAt = nextInterval(rng, lightningMean);
  let nextWindShiftAt = nextInterval(rng, windShiftMean);
  let windTarget: { dirRad: number; speed: number } | null = null;
  const log: GameEvent[] = [];

  function push(e: GameEvent) {
    log.push(e);
    if (log.length > maxLog) log.shift();
  }

  function strikeLightning(
    grid: FireGrid,
    ignite: (tile: { x: number; z: number }, heat: number) => void,
  ) {
    // Rejection-sample an ignitable tile; bounded attempts keep the RNG
    // consumption deterministic even on heavily burned maps.
    for (let attempt = 0; attempt < 24; attempt++) {
      const x = Math.floor(rng() * grid.width);
      const z = Math.floor(rng() * grid.height);
      if (!isIgnitable(grid, x, z)) continue;
      const heat = 0.7 + rng() * 0.2;
      ignite({ x, z }, heat);
      push({ kind: 'lightning', t: clock, tile: { x, z } });
      return;
    }
  }

  return {
    isEnabled: () => enabled,
    setEnabled(on) {
      enabled = on;
    },

    tick(dt, grid, env, ignite) {
      if (!enabled || dt <= 0) return;
      clock += dt;

      while (clock >= nextLightningAt) {
        strikeLightning(grid, ignite);
        nextLightningAt += nextInterval(rng, lightningMean);
      }

      while (clock >= nextWindShiftAt) {
        windTarget = {
          dirRad: rng() * Math.PI * 2,
          speed: windMin + rng() * (windMax - windMin),
        };
        push({ kind: 'wind-shift', t: clock, windDirRad: windTarget.dirRad, windSpeed: windTarget.speed });
        nextWindShiftAt += nextInterval(rng, windShiftMean);
      }

      if (windTarget) {
        const k = Math.min(1, windEaseRate * dt);
        env.windSpeed += (windTarget.speed - env.windSpeed) * k;
        // Ease angle along the shortest arc.
        const raw = windTarget.dirRad - env.windDirRad;
        const dAng = Math.atan2(Math.sin(raw), Math.cos(raw));
        env.windDirRad += dAng * k;
      }
    },

    getLog: () => log,
  };
}
