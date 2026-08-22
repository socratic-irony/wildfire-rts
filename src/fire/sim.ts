import { FireGrid, FireState, FUEL_KEYS, fuelIndex, coordToIndex, indexToCoord } from './grid';
import { getLogger } from '../../tools/logging/index.js';

export type Env = {
  windDirRad: number; // radians; 0 = +Z, pi/2 = +X
  windSpeed: number;  // m/s
  humidity?: number;  // 0..1 ambient humidity for slow drift
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function dirDot(ax: number, az: number, bx: number, bz: number) {
  const la = Math.hypot(ax, az) || 1e-6;
  const lb = Math.hypot(bx, bz) || 1e-6;
  return (ax / la) * (bx / lb) + (az / la) * (bz / lb);
}

function neighborDirs() {
  const d: Array<{ dx: number; dz: number; dist: number }> = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    d.push({ dx, dz, dist: Math.hypot(dx, dz) });
  }
  return d;
}
const NEIGH = neighborDirs();

function fuel(grid: FireGrid, i: number) { return grid.params.fuels[FUEL_KEYS[grid.fuel[i]]]; }

// Compute effective rate-of-spread toward neighbor (m/s)
function effectiveROS(grid: FireGrid, srcIdx: number, nDX: number, nDZ: number, env: Env) {
  const F = fuel(grid, srcIdx);
  if (F.baseROS <= 0 || F.fuelLoad <= 0) return 0;

  // Wind vector in XZ
  const wx = Math.sin(env.windDirRad);
  const wz = Math.cos(env.windDirRad);
  const windAlign = clamp(dirDot(wx, wz, nDX, nDZ), -1, 1); // -1 rear, +1 head
  const windMul = Math.exp(F.k_w * env.windSpeed * windAlign);

  // Slope along direction (downslope vector points +down). Uphill fire (opposite downslope) spreads faster.
  const uphillX = -grid.downX[srcIdx], uphillZ = -grid.downZ[srcIdx];
  const slopeAlign = clamp(dirDot(uphillX, uphillZ, nDX, nDZ), -1, 1);
  const slopeMul = Math.exp(F.k_s * grid.slopeTan[srcIdx] * Math.max(0, slopeAlign));

  // Moisture gates via wetness/retardant on target are applied separately as gate factors
  const ros = F.baseROS * windMul * slopeMul;
  return ros;
}

function moistGate(targetWet: number, targetRet: number, F: ReturnType<typeof fuel>) {
  const mw = Math.exp(-F.k_m * clamp(targetWet, 0, 1));
  const mr = Math.exp(-1.2 * clamp(targetRet, 0, 1));
  return mw * mr;
}

function barrierFactor(lineStrength: number) {
  return clamp(1 - lineStrength, 0, 1);
}

function rand01(seed: number) {
  // simple LCG hash; note: for determinism, call order must be stable
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 16; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

const UNBURNED_I = FireState.Unburned as number;
const IGNITING_I = FireState.Igniting as number;
const BURNING_I = FireState.Burning as number;
const SMOLDERING_I = FireState.Smoldering as number;
const BURNED_I = FireState.Burned as number;
const ROCK_I = fuelIndex('rock');
const WATER_I = fuelIndex('water');

export class FireSim {
  private grid: FireGrid;
  private env: Env;
  private acc = 0;
  private logger = getLogger();
  private stepCount = 0;

  constructor(grid: FireGrid, env?: Partial<Env>) {
    this.grid = grid;
    this.env = { windDirRad: 0, windSpeed: 0, humidity: 0.3, ...env } as Env;
  }

  setEnv(env: Partial<Env>) { Object.assign(this.env, env); }

  step(dt: number) {
    const P = this.grid.params;
    this.acc += dt;
    const fixed = P.dt;
    let steps = 0;
    while (this.acc >= fixed && steps < 6) {
      this.tick(fixed);
      this.acc -= fixed;
      steps++;
      this.stepCount++;
    }
    
    // Log fire simulation state periodically (every 30 steps = ~1 second).
    // Skip formatting entirely unless debug output is actually enabled.
    if (this.stepCount % 30 === 0 && this.logger.isEnabled('debug')) {
      this.logger.debug('Fire simulation state', {
        igniting: this.grid.iCount,
        burning: this.grid.bCount,
        smoldering: this.grid.sCount,
        windSpeed: this.env.windSpeed.toFixed(1),
        windDirection: (this.env.windDirRad * 180 / Math.PI).toFixed(0) + '°',
        simTime: this.grid.time.toFixed(1) + 's'
      });
    }
  }

  private tick(dt: number) {
    const g = this.grid;
    g.time += dt;

    // 1) decay wetness/retardant
    const dw = Math.exp(-dt / g.params.timeConstants.tauWet);
    const dr = Math.exp(-dt / g.params.timeConstants.tauRet);
    const humid = this.env.humidity ?? 0.3;
    const HUMID_TAU = 300; // seconds, slow drift toward ambient humidity
    const hm = 1 - Math.exp(-dt / HUMID_TAU);
    for (let i = 0; i < g.sCount; i++) {
      const idx = g.smoldering[i];
      g.wetness[idx] *= dw; g.retardant[idx] *= dr; g.fuelMoisture[idx] += (humid - g.fuelMoisture[idx]) * hm;
    }
    for (let i = 0; i < g.bCount; i++) {
      const idx = g.burning[i];
      g.wetness[idx] *= dw; g.retardant[idx] *= dr; g.fuelMoisture[idx] += (humid - g.fuelMoisture[idx]) * hm;
    }
    for (let i = 0; i < g.iCount; i++) {
      const idx = g.igniting[i];
      g.wetness[idx] *= dw; g.retardant[idx] *= dr; g.fuelMoisture[idx] += (humid - g.fuelMoisture[idx]) * hm;
    }

    // 2) ignition trials from burning tiles
    const newIgnitions: number[] = [];
    for (let bi = 0; bi < g.bCount; bi++) {
      const i = g.burning[bi];
      const c = indexToCoord(g, i);
      const baseF = fuel(g, i);
      const isCrown = g.heat[i] > g.params.thresholds.crownHeat;
      for (const n of NEIGH) {
        const nx = c.x + n.dx; const nz = c.z + n.dz;
        if (nx < 0 || nz < 0 || nx >= g.width || nz >= g.height) continue;
        const j = coordToIndex(g, nx, nz);
        if (g.state[j] !== UNBURNED_I) continue;
        if (g.fuel[j] === ROCK_I || g.fuel[j] === WATER_I) continue;

        const ros = effectiveROS(g, i, n.dx, n.dz, this.env);
        const adv = (ros * dt) / (g.params.cellSize * n.dist);
        // Convert fractional advance to probability via Poisson arrival
        // adv >= 1 -> ignite almost certainly, adv small -> small chance
        let p = 1 - Math.exp(-clamp(adv, 0, 10));
        // Hard moisture gate and damping (crown fire can partially bypass)
        const fuelMoistEff = clamp(g.fuelMoisture[j] + g.wetness[j] + 0.6 * g.retardant[j], 0, 1);
        if (fuelMoistEff > 0.9 && !isCrown) continue;
        const m = moistGate(g.wetness[j] + g.fuelMoisture[j], g.retardant[j], baseF);
        p *= isCrown ? Math.max(m, 0.25) : m;
        let bf = barrierFactor(g.lineStrength[j]);
        // Crown-level heat can partially bypass strong lines (embers/spotting across line)
        if (isCrown) bf = Math.max(bf, 0.15);
        p *= bf;
        p = clamp(p, 0, 1);
        // Deterministic hash as RNG; compare to probability
        const h = rand01((j + (g.time * 997) | 0) ^ (g.seed ^ 0x51f15e));
        // chaos retained via hashed RNG input above; no extra thresholding needed
        if (h < p) newIgnitions.push(j);
      }
      // spotting (very simplified): occasional downwind leap within range
      if (g.params.spotting.enabled && this.env.windSpeed > 0) {
        const rate = g.params.spotting.baseRate * g.heat[i];
        const pr = 1 - Math.exp(-rate * dt);
        const r = rand01((i ^ (g.time * 997) | 0) + 0x1234abcd);
        if (r < pr) {
          const maxTiles = g.params.spotting.maxDistanceTiles * (1 + 0.2 * this.env.windSpeed);
          const wx = Math.sin(this.env.windDirRad);
          const wz = Math.cos(this.env.windDirRad);
          const dist = Math.min(maxTiles, 2 + Math.floor(r * maxTiles));
          const tx = Math.round(c.x + wx * dist);
          const tz = Math.round(c.z + wz * dist);
          if (tx >= 0 && tz >= 0 && tx < g.width && tz < g.height) {
            const j = coordToIndex(g, tx, tz);
            if (g.state[j] === UNBURNED_I && g.fuel[j] !== ROCK_I && g.fuel[j] !== WATER_I) newIgnitions.push(j);
          }
        }
      }
    }

    // 3) combustion advance
    const nextBurning: number[] = [];
    const nextSmolder: number[] = [];
    const nextIgniting: number[] = [];
    // Promote igniting tiles after timer
    for (let ii = 0; ii < g.iCount; ii++) {
      const i = g.igniting[ii];
      if (g.time - g.lastIgnitedAt[i] >= g.params.timeConstants.tIgnite) {
        g.state[i] = BURNING_I;
        g.heat[i] = Math.max(g.heat[i], 0.6);
        nextBurning.push(i);
      } else {
        nextIgniting.push(i);
      }
    }
    for (let bi = 0; bi < g.bCount; bi++) {
      const i = g.burning[bi];
      const F = fuel(g, i);
      const rise = dt / Math.max(1, F.flameDur * 0.5);
      g.heat[i] = clamp(g.heat[i] + rise * (1 - g.heat[i]), 0, 1);
      g.progress[i] += dt / Math.max(1e-3, F.flameDur + F.smolderDur);
      // Early extinguish: push to Smoldering when cool and isolated
      let isolated = false;
      if (g.heat[i] < g.params.thresholds.extinguishHeat) {
        isolated = true;
        const c = indexToCoord(g, i);
        for (const n of NEIGH) {
          const nx = c.x + n.dx, nz = c.z + n.dz;
          if (nx < 0 || nz < 0 || nx >= g.width || nz >= g.height) continue;
          const j = coordToIndex(g, nx, nz);
          const s = g.state[j];
          if (s === BURNING_I || s === IGNITING_I) { isolated = false; break; }
        }
      }
      if (isolated || g.progress[i] >= F.flameDur / (F.flameDur + F.smolderDur)) {
        g.state[i] = SMOLDERING_I;
        nextSmolder.push(i);
      } else {
        nextBurning.push(i);
      }
    }
    for (let si = 0; si < g.sCount; si++) {
      const i = g.smoldering[si];
      const F = fuel(g, i);
      g.heat[i] = clamp(g.heat[i] - dt / Math.max(1, F.smolderDur), 0, 1);
      g.progress[i] += dt / Math.max(1e-3, F.flameDur + F.smolderDur);
      if (g.progress[i] >= 1) {
        g.state[i] = BURNED_I;
      } else {
        nextSmolder.push(i);
      }
    }

    // apply new ignitions
    for (const j of newIgnitions) {
      if (g.state[j] === UNBURNED_I) {
        g.state[j] = IGNITING_I;
        g.lastIgnitedAt[j] = g.time;
        g.heat[j] = Math.max(g.heat[j], 0.4);
        g.progress[j] = 0.0;
        nextIgniting.push(j);
      }
    }

    // 4) write frontier lists
    g.iCount = nextIgniting.length;
    g.bCount = nextBurning.length;
    g.sCount = 0;
    for (let k = 0; k < g.iCount; k++) g.igniting[k] = nextIgniting[k];
    for (let k = 0; k < g.bCount; k++) g.burning[k] = nextBurning[k];
    for (const j of nextSmolder) g.smoldering[g.sCount++] = j;
  }
}
