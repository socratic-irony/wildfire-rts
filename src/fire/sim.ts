import { FireGrid, FireState, coordToIndex, indexToCoord } from './grid';
import { FireParams } from './params';

export type Env = {
  windDirRad: number; // radians; 0 = +Z, pi/2 = +X
  windSpeed: number;  // m/s
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

function fuel(grid: FireGrid, i: number) { return grid.params.fuels[grid.tiles[i].fuel]; }

// Compute effective rate-of-spread toward neighbor (m/s)
function effectiveROS(grid: FireGrid, srcIdx: number, nDX: number, nDZ: number, env: Env) {
  const t = grid.tiles[srcIdx];
  const F = fuel(grid, srcIdx);
  if (F.baseROS <= 0 || F.fuelLoad <= 0) return 0;

  // Wind vector in XZ
  const wx = Math.sin(env.windDirRad);
  const wz = Math.cos(env.windDirRad);
  const windAlign = clamp(dirDot(wx, wz, nDX, nDZ), -1, 1); // -1 rear, +1 head
  const windMul = Math.exp(F.k_w * env.windSpeed * windAlign);

  // Slope along direction (downslope vector points +down). Uphill fire (opposite downslope) spreads faster.
  const uphillX = -t.downX, uphillZ = -t.downZ;
  const slopeAlign = clamp(dirDot(uphillX, uphillZ, nDX, nDZ), -1, 1);
  const slopeMul = Math.exp(F.k_s * t.slopeTan * Math.max(0, slopeAlign));

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

export class FireSim {
  private grid: FireGrid;
  private env: Env;
  private acc = 0;
  constructor(grid: FireGrid, env?: Partial<Env>) {
    this.grid = grid;
    this.env = { windDirRad: 0, windSpeed: 0, ...env } as Env;
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
    }
  }

  private tick(dt: number) {
    const g = this.grid;
    g.time += dt;

    // 1) decay wetness/retardant
    const dw = Math.exp(-dt / g.params.timeConstants.tauWet);
    const dr = Math.exp(-dt / g.params.timeConstants.tauRet);
    for (let i = 0; i < g.sCount; i++) {
      const idx = g.smoldering[i];
      const t = g.tiles[idx];
      t.wetness *= dw; t.retardant *= dr;
    }
    for (let i = 0; i < g.bCount; i++) {
      const idx = g.burning[i];
      const t = g.tiles[idx];
      t.wetness *= dw; t.retardant *= dr;
    }

    // 2) ignition trials from burning tiles
    const newIgnitions: number[] = [];
    for (let bi = 0; bi < g.bCount; bi++) {
      const i = g.burning[bi];
      const c = indexToCoord(g, i);
      const baseF = fuel(g, i);
      for (const n of NEIGH) {
        const nx = c.x + n.dx; const nz = c.z + n.dz;
        if (nx < 0 || nz < 0 || nx >= g.width || nz >= g.height) continue;
        const j = coordToIndex(g, nx, nz);
        const tgt = g.tiles[j];
        if (tgt.state !== FireState.Unburned) continue;
        if (tgt.fuel === 'rock' || tgt.fuel === 'water') continue;

        const ros = effectiveROS(g, i, n.dx, n.dz, this.env);
        const adv = (ros * dt) / (g.params.cellSize * n.dist);
        // Convert fractional advance to probability via Poisson arrival
        // adv >= 1 -> ignite almost certainly, adv small -> small chance
        let p = 1 - Math.exp(-clamp(adv, 0, 10));
        p *= moistGate(tgt.wetness, tgt.retardant, baseF);
        p *= barrierFactor(tgt.lineStrength);
        p = clamp(p, 0, 1);
        // Deterministic hash as RNG; compare to probability
        const h = rand01((j + (g.time * 997) | 0) ^ (g.seed ^ 0x51f15e));
        // chaos retained via hashed RNG input above; no extra thresholding needed
        if (h < p) newIgnitions.push(j);
      }
      // spotting (very simplified): occasional downwind leap within range
      if (g.params.spotting.enabled && this.env.windSpeed > 0) {
        const rate = g.params.spotting.baseRate * g.tiles[i].heat;
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
            const tgt = g.tiles[j];
            if (tgt.state === 0 && tgt.fuel !== 'rock' && tgt.fuel !== 'water') newIgnitions.push(j);
          }
        }
      }
    }

    // 3) combustion advance
    const nextBurning: number[] = [];
    const nextSmolder: number[] = [];
    for (let bi = 0; bi < g.bCount; bi++) {
      const i = g.burning[bi];
      const t = g.tiles[i];
      const F = fuel(g, i);
      const rise = dt / Math.max(1, F.flameDur * 0.5);
      t.heat = clamp(t.heat + rise * (1 - t.heat), 0, 1);
      t.progress += dt / Math.max(1e-3, F.flameDur + F.smolderDur);
      if (t.progress >= F.flameDur / (F.flameDur + F.smolderDur)) {
        t.state = FireState.Smoldering;
        nextSmolder.push(i);
      } else {
        nextBurning.push(i);
      }
    }
    for (let si = 0; si < g.sCount; si++) {
      const i = g.smoldering[si];
      const t = g.tiles[i];
      const F = fuel(g, i);
      t.heat = clamp(t.heat - dt / Math.max(1, F.smolderDur), 0, 1);
      t.progress += dt / Math.max(1e-3, F.flameDur + F.smolderDur);
      if (t.progress >= 1) {
        t.state = FireState.Burned;
      } else {
        nextSmolder.push(i);
      }
    }

    // apply new ignitions
    for (const j of newIgnitions) {
      const t = g.tiles[j];
      if (t.state === FireState.Unburned) {
        t.state = FireState.Burning;
        t.heat = Math.max(t.heat, 0.6);
        t.progress = 0.01;
        nextBurning.push(j);
      }
    }

    // 4) write frontier lists
    g.bCount = nextBurning.length;
    g.sCount = 0;
    for (let k = 0; k < g.bCount; k++) g.burning[k] = nextBurning[k];
    for (const j of nextSmolder) g.smoldering[g.sCount++] = j;
  }
}
