export type FuelKey = 'grass' | 'chaparral' | 'forest' | 'rock' | 'water' | 'urban';

export type FuelParams = {
  baseROS: number;      // m/s baseline rate of spread on flat, no wind
  fuelLoad: number;     // arbitrary units (relative intensity)
  flameDur: number;     // s, active flaming duration
  smolderDur: number;   // s, lingering heat
  k_m: number;          // moisture factor weight (higher → more sensitive)
  k_s: number;          // slope factor weight
  k_w: number;          // wind factor weight (per m/s)
};

export type FireParams = {
  cellSize: number;   // world units per tile edge
  dt: number;         // fixed simulation step seconds
  fuels: Record<FuelKey, FuelParams>;
  thresholds: {
    extinguishHeat: number;
    crownHeat: number;
  };
  timeConstants: {
    tauWet: number;   // wetness decay time constant (s)
    tauRet: number;   // retardant decay (s)
  };
  spotting: {
    enabled: boolean;
    baseRate: number;         // events per burning tile per second at heat=1
    maxDistanceTiles: number; // base distance in tiles
  };
  chaos: number; // 0..1 randomness blend
};

export const DEFAULT_FIRE_PARAMS: FireParams = {
  cellSize: 1,
  dt: 0.25,
  fuels: {
    grass:     { baseROS: 0.30, fuelLoad: 0.8, flameDur: 15, smolderDur: 10, k_m: 0.50, k_s: 0.90, k_w: 0.09 },
    chaparral: { baseROS: 0.15, fuelLoad: 2.0, flameDur: 35, smolderDur: 25, k_m: 0.60, k_s: 1.20, k_w: 0.07 },
    forest:    { baseROS: 0.07, fuelLoad: 3.5, flameDur: 60, smolderDur: 40, k_m: 0.65, k_s: 1.40, k_w: 0.05 },
    rock:      { baseROS: 0.00, fuelLoad: 0.0, flameDur: 0,  smolderDur: 0,  k_m: 0.0,  k_s: 0.0,  k_w: 0.0 },
    water:     { baseROS: 0.00, fuelLoad: 0.0, flameDur: 0,  smolderDur: 0,  k_m: 0.0,  k_s: 0.0,  k_w: 0.0 },
    urban:     { baseROS: 0.04, fuelLoad: 1.0, flameDur: 25, smolderDur: 10, k_m: 0.55, k_s: 0.80, k_w: 0.05 },
  },
  thresholds: { extinguishHeat: 0.12, crownHeat: 0.85 },
  timeConstants: { tauWet: 60, tauRet: 600 },
  spotting: { enabled: true, baseRate: 0.02, maxDistanceTiles: 16 },
  chaos: 0.05,
};

