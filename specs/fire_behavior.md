specs/fire_behavior.md

Status (current)

- Implemented in code: FireGrid build with per-tile slope and downslope direction, fuels (grass/chaparral/forest/rock/water/urban) with tunable params, ignition API (`ignite`) and fixed-step simulation (`FireSim.step`) at 4 Hz, neighbor ignition probability based on fractional advance with wind/slope and moisture damping, simple spotting, Igniting→Burning promotion timer, combustion/heat progression (Burning→Smoldering→Burned), wetness/retardant fields with exponential decay, suppression hooks (`applyWaterAoE`, `applyRetardantLine`, `writeFirelineEdges`), tile-based `lineStrength` barriering, and a containment heuristic (`isContained`). Visuals: instanced overlay and vertex‑tint fire viz modes, thin perimeter outline render. Analytics: perimeter extraction (`computePerimeter`) and `computeFireStats` (active counts, burned tiles/area, perimeter length).
- Not yet (high level): edge‑based firelines, crown fire mode, particle flames/smoke, burned‑ground decals, water/retardant/handline paint UI, wind tuning UI.

Outstanding Work (v0.1 audit)

- Core engine:
  - Igniting stage: tuned timings/UX (baseline implemented with `tIgnite` and `lastIgnitedAt`).
  - Early extinguish: rule to push Burning → Smoldering when `heat < thresholds.extinguishHeat` and isolated.
  - Moisture gating: hard gate on ignition when effective moisture is very high (e.g., `fuelMoistureEff < 0.9`) — currently only soft damping.
  - Fuel moisture & humidity: per‑tile `fuelMoisture` and slow drift toward `Env.humidity` not applied.
  - Line barriers: edge‑based line field (separate from tile `lineStrength`) and crown‑threshold bypass behavior.
  - Crown fire: behavior switches tied to `thresholds.crownHeat`.
  - Perimeter: visualization polish (thickness, color ramp) and optional smoothing; UI counters wired to stats.
  - Data layout: current AoS objects; optional SoA typed arrays if/when perf dictates.
- Spread/probability:
  - Head/elliptical bias based on wind/slope azimuth (current model uses Poisson from fractional advance without an extra head bias).
  - Spotting details: angular jitter, distance sampling and moisture check as described; current version is a simplified single hop.
- Suppression:
  - Water knockdown: immediate heat reduction on application (in addition to wetness field).
  - Retardant gel “knockback”: short‑term increase to `retardant` (e.g., +0.15) for ~10 s after drops.
  - Handline/Cleared: writing along edges and optional tile clearing (state=5) with fuel reduction.
- Visuals:
  - Particles (flames/smoke) and burned‑ground/wetness/retardant decals.
  - Perimeter line visualization.
  - Vegetation burn tint: trees and shrubs darken → brown → near‑black based on tile state (Burning/Smoldering/Burned), updated ~2 Hz.
- UI/Debug:
  - Wind controls (speed/direction sliders), water/retardant/handline paint tools.
  - Stats UI: burning count, burned area, perimeter length shown in debug overlay (monospace). Mean ROS and contained/not‑contained badge pending.
  - Overlays: slope/wind vectors, wetness/retardant.

0) Purpose & Scope

Design a performant, tile-based wildfire model that feels plausible (slope/wind-driven, fuel dependent) and is fun to interact with. This v0.1 spec targets gameplay-consistent behavior, not scientific fidelity. It must:
	•	Run in real time on a 128–256² grid.
	•	Expose clear hooks for suppression units (trucks, crews, dozers, aircraft).
	•	Drive readable visuals (flames, smoke, heat/retardant overlays).
	•	Be deterministic per seed (unless “chaos” noise is enabled).

⸻

1) Coordinate System & Timing
	•	Grid: square tiles; side length CELL_M world units (default: 2 m).
	•	Resolution: NX × NZ cells (128–256 typical).
	•	Time step: fixed dt = 0.25 s (simulate at 4 Hz). Clamp accumulator so no more than 6 steps/frame.
	•	Directions: Moore neighborhood (8 neighbors). For directionality (wind/slope), use the unit vector from center cell c to neighbor n, d̂ = normalize(p_n - p_c).

⸻

2) Tile Data Model

// One struct per tile (packed / SoA for perf where possible)
type FireState = 0 | 1 | 2 | 3 | 4 | 5; 
// 0 Unburned, 1 Igniting, 2 Burning, 3 Smoldering, 4 Burned, 5 Cleared/Fireline

interface Tile {
  // Static (precomputed)
  height: number;            // meters
  slopeDeg: number;          // 0..90
  slopeDir: number;          // radians, downslope azimuth (for aspect effects)
  fuelType: FuelType;        // enum
  fuelLoad: number;          // kg/m² (varies per fuel, scaled by density mask)
  fuelMoisture: number;      // 0..1 (higher = wetter)
  roadMask: 0|1;             // roads reduce fuelLoad and affect units

  // Dynamic (per tick)
  state: FireState;
  heat: number;              // 0..1 normalized intensity
  burnProgress: number;      // 0..1 fraction of fuel consumed
  wetness: number;           // 0..1 temporary water; decays by tauWet
  retardant: number;         // 0..1 persistent effect; decays by tauRet
  lineStrength: number;      // 0..1 (crews/dozers write this); reduces spread across edges
  lastIgnitedAt: number;     // seconds
}

Data is stored in structure-of-arrays (SoA) for JS/TS perf: Float32Array/Uint8Array per field.

⸻

3) Fuel Types & Parameters

type FuelType = "grass" | "chaparral" | "forest" | "rock" | "water" | "urban";

Defaults (tune-friendly, gameplay first):

Fuel	baseROS (m/s)	fuelLoad (kg/m²)	flameDur (s)	smolderDur (s)	moistureDamp k_m	slopeFactor k_s	windFactor k_w
grass	0.30	0.8	15	10	0.50	0.90	0.09
chaparral	0.15	2.0	35	25	0.60	1.20	0.07
forest	0.07	3.5	60	40	0.65	1.40	0.05
rock	0.00	0.0	0	0	—	—	—
water	0.00	0.0	0	0	—	—	—
urban	0.04	1.0	25	10	0.55	0.80	0.05

Notes
	•	baseROS = calm, flat, dry rate-of-spread along head direction.
	•	moistureDamp k_m: multiplier M_moist = clamp(1 - k_m * fuelMoistureEff, 0, 1).
	•	slopeFactor k_s: used with tan(slope).
	•	windFactor k_w: per m/s tailwind contribution.

⸻

4) Environment Fields

interface Env {
  windVec: [number, number]; // m/s in world XZ (positive X = east), magnitude = speed
  humidity: number;          // 0..1 (affects moisture recovery)
  tempC: number;             // (optional) modulates baseROS slightly
  chaos: number;             // 0..1 noise weight for stochasticity
}

	•	Effective fuel moisture each step:
fuelMoistureEff = clamp(tile.fuelMoisture + tile.wetness + 0.6*tile.retardant, 0, 1).
Recovery: tile.wetness *= exp(-dt / tauWet), tile.retardant *= exp(-dt / tauRet).
Defaults: tauWet = 60 s, tauRet = 600 s.
	•	Ambient humidity slowly nudges fuelMoisture toward humidity with long time constant (minutes).

⸻

5) State Machine

Unburned
  -> Igniting (if ignition test passes)
Igniting
  -> Burning after tIgnite (default 1.0 s)
Burning
  heat rises to 1, consumes fuel; when burnProgress >= 1 -> Smoldering
Smoldering
  heat decays to 0 over smolderDur -> Burned
Cleared/Fireline
  passive; cannot ignite unless intensity across edge overwhelms line
Burned
  inert; cannot reignite

Special rules:
	•	Wetness/Retardant delay or block ignition; can push Burning → Smoldering if heat is forced < extinguish threshold (see §7.5).
	•	LineStrength lives on a tile and/or edge (optional edge field). If lineStrength on edge ≥ 0.8, block cross-edge spread unless intensity is “crown-level.”

⸻

6) Directional Rate-of-Spread (ROS)

Compute an effective ROS from c to neighbor n:
	1.	Base: ros = baseROS[fuelType(c)].
	2.	Wind multiplier:
	•	u = |windVec|
	•	dir = dot( normalize(windVec), d̂ )  // −1..1 (headwind negative)
	•	M_wind = 1 + k_w * u * max(0, dir)  // tailwind boosts; headwind no boost (simple)
	•	Optionally: small headwind penalty, e.g., * (1 - 0.2 * max(0, -dir))
	3.	Slope multiplier:
	•	tanθ = tan( slopeDeg(c) * π/180 )
	•	sdir = cos( (downslopeAzimuth(c) - azimuth(d̂)) )  // +1 uphill, −1 downhill
	•	M_slope = 1 + k_s * tanθ * max(0, sdir)  // spreads faster uphill
	4.	Moisture/Retardant:
	•	M_moist = clamp(1 - k_m * fuelMoistureEff(c), 0.05, 1)
	5.	Crowding (fuelLoad):
	•	Optional density effect: M_load = clamp(0.6 + 0.4 * (fuelLoad / fuelLoadRef), 0.6, 1.3)
	6.	Temperature (optional):
	•	M_temp = 1 + 0.01 * (tempC - 25)
	7.	Final:
	•	ros_eff = ros * M_wind * M_slope * M_moist * M_load * M_temp

⸻

7) Ignition & Spread Probability

7.1 Neighbor ignition probability
	•	Concept: if the flame front travels distance L = CELL_M toward neighbor in time dt, ignite with probability linked to front advance.
	•	advance = ros_eff * dt
	•	p_base = clamp(advance / CELL_M, 0, 1)
	•	Angle falloff (elliptical head vs flanks vs rear):
	•	headBias = clamp(0.25 + 0.75 * (wind-aligned + uphill-aligned), 0.25, 1.0)
	•	Implement as p = p_base * headBias
	•	Chaos noise:
	•	p = mix(p, randomHash(c,t), env.chaos * 0.15) (use blue-noise or hashed jitter)

If state[n] ∈ {Unburned} and rand() < p * barrierFactor(c,n), set n.state = Igniting and n.lastIgnitedAt = time.

7.2 Barrier factor & line crossing
	•	Without line: barrierFactor = 1.
	•	With line on either tile (or edge field edgeLine[c→n]):
	•	barrierFactor = clamp(1 - lineStrengthEdge, 0, 1).
	•	If heat(c) > crownThreshold (e.g., 0.85) and fuelType(n) ≠ rock/water, allow partial bypass:
	•	barrierFactor = max(barrierFactor, 0.15) (embers & spotting possibility).

7.3 Spotting (embers)

Low-cost approximation:
	•	For each burning tile c, with probability pSpot = 0.02 * dt * heat(c) * (1 + 0.1*u), cast a spot:
	•	Draw distance r ∈ [0.5, rMax] with rMax = clamp(8 + 0.8*u, 8, 20) tiles.
	•	Direction along wind with ±20° jitter.
	•	Land tile s: if s is Unburned and not water/rock, run an ignition test with p_spot = 0.5 * (1 - fuelMoistureEff(s)).

7.4 Heat & Fuel Consumption

For Burning tile c:
	•	Rise curve to peak:
	•	heat += (1 - heat) * dt / tRise, with tRise = min(4, 0.3 * flameDur).
	•	Consume fuel:
	•	burnProgress += (heat * dt) / flameDur
	•	If burnProgress ≥ 1: state = Smoldering
	•	Smoldering: heat *= exp(-dt / smolderDur), on near-zero switch to Burned.

7.5 Extinguishment
	•	Water/retardant effects (from units) reduce heat directly:
	•	When water applied at rate Q, do heat -= k_ext * Q * dt / (1 + burnProgress) (harder to put out fully involved cells). Clamp heat ≥ 0.
	•	If heat < extinguishThreshold (default 0.12) and no burning neighbors within 1 tile, transition:
	•	Burning → Smoldering early.
	•	Wet ignition gating: At ignition test time, require fuelMoistureEff < 0.9.

⸻

8) Unit Interactions (Suppression Hooks)

8.1 Firetrucks (road-bound)
	•	Movement on road graph only; hose reach R = 4 tiles.
	•	Action: Spray Water (cone/arc)
	•	Apply water field to affected tiles: addWetness(tile, volumePerSec * dt) and instant heat reduction: heat *= (1 - 0.25 * coverage).
	•	Tank size & refill at hydrant/tender; cooldown between bursts optional.

8.2 Helicopters (bucket/bambi)
	•	Action: Bucket Drop (line/oval along flight path)
	•	Footprint: capsule with radius rw = 2 tiles and length by speed × contact time.
	•	Effect: wetness += k_drop, heat -= k_quench (higher than truck momentarily).
	•	Small knockback on ignition chance next 10 s: set retardant += 0.15 if configured as gel.

8.3 Airtankers (retardant)
	•	Action: Retardant Line
	•	Writes retardant = max(retardant, 0.8) along a long, thin swath (width ~2–3 tiles).
	•	Strongly reduces spread probability across that path for several minutes (tauRet).

8.4 Hand Crews
	•	Action: Cut Handline
	•	Paints edge-based lineStrength on walked path: increase edge to 0.7–1.0 at a rate v_cut = tilesPerSecond slowed by slope.
	•	Also sets target tiles to Cleared (state=5) where appropriate: fuelLoad *= 0.05, fuelType="rock" visual tint.

8.5 Bulldozers
	•	As hand crew but wider & faster; cannot traverse slopeDeg > 35 or dense forest (unless “push” mode enabled).
	•	Writes wider lineStrength and reduces fuelLoad more aggressively.

8.6 Backburn (later)
	•	Optional: crews can ignite a line upwind of main fire; write immediate Burning with low intensity and high controllability.

⸻

9) Visual Mapping
	•	State → Color overlay (multiplicative):
	•	Burning: orange/yellow flicker, emissive.
	•	Smoldering: dark gray; low smoke.
	•	Burned: charcoal; desaturated.
	•	Cleared/Fireline: pale soil stripe.
	•	Heatmap debug: HSV (red = high heat).
	•	Smoke: particle sheets intensity ∝ heat * fuelLoad. Direction follows wind.
	•	Wetness/Retardant: blue/red translucent decals with timed fade.
	•	Perimeter: marching squares around Burning ∪ Smoldering.
	•	Vegetation (trees/shrubs): per‑instance color multiply by state —
	   •	Unburned: white (no change)
	   •	Burning: slight dark/ashy multiplier (≈ [0.75, 0.65, 0.55])
	   •	Smoldering: brown multiplier (≈ [0.60, 0.40, 0.25])
	   •	Burned: near‑black multiplier (≈ [0.08, 0.08, 0.08])
	   Update cadence ~0.5 s to reduce churn.

⸻

10) Parameters & Tuning (JSON)

interface FireParams {
  cellSize: number;            // meters
  dt: number;                  // seconds
  fuels: Record<FuelType, {
    baseROS: number;           // m/s
    fuelLoad: number;          // kg/m²
    flameDur: number;          // s
    smolderDur: number;        // s
    k_m: number;               // moisture damp
    k_s: number;               // slope factor
    k_w: number;               // wind factor
  }>;
  thresholds: {
    extinguishHeat: number;    // default 0.12
    crownHeat: number;         // default 0.85
  };
  timeConstants: {
    tauWet: number;            // s
    tauRet: number;            // s
  };
  spotting: {
    enabled: boolean;
    baseRate: number;          // events per burning tile per second at heat=1
    maxDistanceTiles: number;  // base, scaled by wind
  };
  chaos: number;               // 0..1
}


⸻

11) API Surface (Engine ↔ Game)

// Initialize once per map
function buildFireGrid(terrain: Terrain, biomes: BiomeMask, params: FireParams): FireGrid;

// Start a fire at tile(s)
function ignite(grid: FireGrid, cells: Array<{x:number,z:number}>, intensity?: number): void;

// Step simulation
function simulate(grid: FireGrid, env: Env, dt: number): void;

// Apply suppression effects (called by unit systems)
function applyWaterAoE(grid: FireGrid, center:Vec2, radius:number, intensity:number): void;
function applyRetardantLine(grid: FireGrid, polyline: Vec2[], width:number, strength:number): void;
function writeFirelineEdges(grid: FireGrid, edgePath: Edge[], strength:number): void;

// Perimeter & Stats
function computePerimeter(grid: FireGrid): Polyline[]; // grid-space polyline(s) on half-integer edges
function computeFireStats(grid: FireGrid): {
  burning:number; smoldering:number; active:number; burnedTiles:number;
  burnedAreaWorld:number; perimeterTile:number; perimeterWorld:number; polylines: Polyline[];
};

// Queries for UI/logic
function isContained(grid: FireGrid): boolean;
function computePerimeter(grid: FireGrid): Polyline;
function sampleTile(grid: FireGrid, x:number, z:number): Readonly<Tile>;


⸻

12) Update Order (Per Tick)
	1.	Decay fields: wetness, retardant (exponential).
	2.	Ignition phase: for each Burning tile c, test neighbors for ignition (§7.1–7.3).
	3.	Combustion: update heat, burnProgress, transition Burning↔Smoldering/Burned (§7.4).
	4.	Extinguish: apply queued suppression deltas; check early transition rules (§7.5).
	5.	Bookkeeping: recompute activeCount, “isContained”, perimeter every 0.5–1.0 s (not every tick).

Performance: iterate only frontier lists:
	•	Maintain arrays of indices for Burning and Smoldering.
	•	Promote/demote indices as states change; avoid scanning entire grid.

⸻

13) Pseudocode

function step(grid: FireGrid, env: Env, dt: number) {
  // 1) decay
  decayWetRet(grid, dt);

  // 2) ignition trials from current burning tiles
  for (const i of grid.burning) {
    const c = idxToCoord(i);
    const base = grid.tiles[i];
    const rosBase = P.fuels[base.fuelType].baseROS;
    for (const n of neighbors8(c)) {
      const j = coordToIdx(n);
      const t = grid.tiles[j];
      if (t.state !== 0) continue; // not Unburned
      const ros = effectiveROS(base, c, n, env, P);       // §6
      const advance = ros * dt;
      let p = clamp(advance / P.cellSize, 0, 1);
      p *= headBias(c, n, env, base);                     // wind+slope facing
      p *= barrierFactor(c, n, grid);                     // lines
      p *= moistGate(t);                                  // wetness/retardant
      p = mix(p, randomHash(j, grid.time), env.chaos*0.15);

      if (rand() < p) igniteTile(t, grid.time);
    }
    // spotting
    if (P.spotting.enabled) trySpot(grid, i, env, dt);
  }

  // 3) combustion & transitions
  advanceCombustion(grid, dt);

  // 4) apply queued suppression (already written by units during frame)
  applySuppressionAndCheckExtinguish(grid, dt);

  // 5) housekeeping (less frequent)
  grid.accumTime += dt;
  if (grid.accumTime > 0.5) {
    grid.accumTime = 0;
    recomputePerimeter(grid);
    updateFrontierLists(grid);
  }
}


⸻

14) Debug & QA
	•	Overlays:
	•	Heatmap (H), Spread probability arrows from hovered tile (P), Wetness/retardant (R).
	•	Slope and wind vectors toggle.
	•	Counters: burning count, perimeter length, area burned (ha), spread rate sample.
	•	Repro: seedable RNG; print seed on start.
	•	Determinism test: run headless 1000 ticks twice → identical perimeter lengths.

⸻

15) Acceptance Criteria (v0.1)
	•	Fire started on lee side of a ridge spreads uphill and downwind faster than cross/upwind.
	•	Retardant line with strength ≥ 0.8 halts flank fire; head fire may breach only with spotting at high wind.
	•	Water drop on active flame knocks heat down immediately and can flip Burning → Smoldering if repeated.
	•	Handline drawn around a small ignition plus light helicopter support contains in < 2 minutes of sim time on 128² grass/chaparral mix.
	•	256² grid at 4 Hz with ~1–3% burning tiles runs ≥ 60 FPS (frontier iteration).


16) Roadmap Beyond v0.1
	•	v0.2: Edge-based lineStrength (separate from tile), crown fire mode, diurnal wind shift preset, structure protection (assets with HP, defensible space).
	•	v0.3: Backburn system, spotfire detection UI, embers that accumulate on roofs/leaf litter (urban WUI).
          •       v2.0+: Scenario persistence and multiplayer co-op (out of scope for v1).

⸻

17) Default Constants (quick copy block)

export const DEFAULT_FIRE_PARAMS: FireParams = {
  cellSize: 2,
  dt: 0.25,
  fuels: {
    grass:     { baseROS:0.30, fuelLoad:0.8, flameDur:15, smolderDur:10, k_m:0.50, k_s:0.90, k_w:0.09 },
    chaparral: { baseROS:0.15, fuelLoad:2.0, flameDur:35, smolderDur:25, k_m:0.60, k_s:1.20, k_w:0.07 },
    forest:    { baseROS:0.07, fuelLoad:3.5, flameDur:60, smolderDur:40, k_m:0.65, k_s:1.40, k_w:0.05 },
    rock:      { baseROS:0.00, fuelLoad:0.0, flameDur:0,  smolderDur:0,  k_m:0,    k_s:0,    k_w:0    },
    water:     { baseROS:0.00, fuelLoad:0.0, flameDur:0,  smolderDur:0,  k_m:0,    k_s:0,    k_w:0    },
    urban:     { baseROS:0.04, fuelLoad:1.0, flameDur:25, smolderDur:10, k_m:0.55, k_s:0.80, k_w:0.05 },
  },
  thresholds: { extinguishHeat: 0.12, crownHeat: 0.85 },
  timeConstants: { tauWet: 60, tauRet: 600 },
  spotting: { enabled: true, baseRate: 0.02, maxDistanceTiles: 16 },
  chaos: 0.05
};


⸻

18) Implementation Notes
	•	Keep neighbor loops branch-light; use lookup tables for neighbor d̂, azimuth, and distance (1 for orthogonal, √2 for diagonal if you want distance-weighted advances).
	•	Consider precomputing tanSlope, upslopeDir per tile.
	•	Frontier lists: burning[], smoldering[], igniting[]. Avoid removing by splice; mark-dead and compact periodically.
	•	For visuals, decouple particle budget from burning count (e.g., sample N representative tiles per frame).

⸻

20) Minimal Working Example (MWE) Checklist
	•	[x] Grid overlay + terrain already running.
	•	[x] Fire grid built; click to ignite a tile.
	•	[ ] Wind slider (speed, direction) visibly changes head spread (engine supports wind; UI pending).
	•	[ ] Wet/retardant debug tools paint into the grid (APIs exist; UI pending).
	•	[ ] Handline paint tool that increases lineStrength along a polyline (API exists: `writeFirelineEdges`; UI pending).
	•	[ ] Perimeter display + contained/not-contained badge (heuristic exists; perimeter pending).
	•	[ ] Stats: active tiles, area burned (tiles × cell area), mean ROS (computed from perimeter growth).

---

Buildout Plan (Stages A–N)

A — Fire Grid Bootstrap
	•	Goal: Data structures + ticking loop.
	•	Tasks: Implement FireGrid, SoA arrays, neighbor lookup tables, fixed-step integrator.
	•	UI Hooks: Seed control, tick/pausetoggle, ignite-on-click.
	•	Exit: Ignite 1 tile; states advance Igniting → Burning → Smoldering → Burned with time.

B — Static Fields & Precompute
	•	Goal: Terrain → fire fields.
	•	Tasks: From terrain: compute slopeDeg, downslopeAzimuth, fuelType map, fuelLoad, roadMask.
	•	UI Hooks: Overlay toggles for slope, fuelType.
	•	Exit: Hovering shows tile stats; overlays match terrain features.

C — Deterministic RNG & Chaos
	•	Goal: Reproducibility with optional variability.
	•	Tasks: Seeded hash RNG; env.chaos weighting.
	•	Exit: Same seed → same burn perimeter; increasing chaos changes shape while keeping directionality.

D — Directional ROS (Wind & Slope)
	•	Goal: Plausible spread rates.
	•	Tasks: Implement §6 multipliers (wind, slope, moisture, load, temp).
	•	UI Hooks: Wind speed/dir slider; moisture slider.
	•	Exit: Downwind/uphill spread visibly faster than crosswind/downhill.

E — Neighbor Ignition Model
	•	Goal: Head/flank/rear behavior.
	•	Tasks: advance/CELL_M ignition probability + headBias; diagonals allowed.
	•	UI Hooks: Debug “probability rays” from selected burning tile.
	•	Exit: Rays show highest p along wind+upslope; model stable at 4 Hz.

F — Combustion & Heat Curves
	•	Goal: Time-varying intensity.
	•	Tasks: Heat rise/decay, fuel consumption, burnProgress, state transitions.
	•	UI Hooks: Heatmap overlay; per-tile sparkline (optional).
	•	Exit: Heat peaks mid-flameDur; tiles become Burned after smoldering.

G — Wetness & Retardant Fields
	•	Goal: Suppression scaffolding.
	•	Tasks: Add wetness, retardant with exponential decay; gate ignition and reduce ROS.
	•	UI Hooks: Paint tools for wet/retardant; decay sliders.
	•	Exit: Painted areas resist ignition; effect fades over time.

H — Barriers & Firelines
	•	Goal: Containment mechanics.
	•	Tasks: lineStrength on tiles (and edge field later); barrier factor in ignition.
	•	UI Hooks: “Draw line” tool; line width/strength controls.
	•	Exit: Closed loop line arrests advance unless heat is very high.

I — Spotting (Embers)
	•	Goal: Leapfrog ignitions in wind.
	•	Tasks: Probabilistic spot throws along wind; moisture gate on landing.
	•	UI Hooks: Toggle spotting; visualize spot paths (debug).
	•	Exit: At higher wind, occasional downwind spotfires appear; respects moisture/retardant.

J — Frontier Lists & Performance
	•	Goal: Scale to 256²+.
	•	Tasks: Maintain burning[], smoldering[] sets; compact periodically; skip inert tiles.
	•	Metrics: ≥60 FPS at 256² with 1–3% active tiles.
	•	Exit: Profiling shows stable frame times; no full-grid loops per tick.

K — Perimeter, Area & Containment
	•	Goal: Game logic outputs.
	•	Tasks: Marching-squares perimeter of Burning∪Smoldering; compute area; contained test.
	•	UI Hooks: Perimeter polyline render; HUD: area burned, active tiles, contained badge.
	•	Exit: Stats update ≤2×/s; perimeter corresponds to visible fire edge.

L — Visual FX Pass
	•	Goal: Readable, cheap visuals.
	•	Tasks: Fire sheet particles (batched), smoke aligned to wind, emissive tint, burned-ground decal; wet/retardant decals.
	•	Budget: Cap particles to N per frame; sample representative tiles.
	•	Exit: Fire reads clearly at zoomed-out camera; perf stays within budget.

M — Suppression API & Tools
	•	Goal: Integrate with units (present/future).
	•	Tasks: Implement applyWaterAoE, applyRetardantLine, writeFirelineEdges; instant heat knockdown behavior.
	•	UI Hooks: Mouse tools that call these APIs (stand-ins for trucks/helos/crews).
	•	Exit: Player can knock down flames, lay retardant, and cut line to contain a small ignition.

N — Tuning & Acceptance Suite
	•	Goal: Lock gameplay feel.
	•	Tasks: JSON params; preset scenarios (grass wind test, chaparral ridge, forest canyon); automated assertions (directional spread ratios, containment tests).
	•	Exit: Passes acceptance: uphill/downwind speed > crosswind; retardant ≥0.8 halts flanks; small fire contained within set time with basic tools.

Deliverables per Stage
	•	Minimal commits with: code, a short PERF note (ms/frame, active tiles), and a GIF/mp4.
	•	Update DEFAULT_FIRE_PARAMS as tuning evolves; keep a changelog of parameter tweaks.
