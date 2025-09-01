# Particles: Fire, Smoke, Smoldering

This document proposes a particle system to visualize wildfire combustion across fuels (trees/forest canopy, shrubs/chaparral, grass) with Three.js. It integrates with the existing fire grid (`src/fire/grid.ts`) and simulator (`src/fire/sim.ts`) while staying performant on the web.

## Goals

- Convey combustion intensity and lifecycle: ignition → open flame → smolder → burnout.
- Differentiate fuels (forest vs. chaparral vs. grass) with distinct emission, color, and scale.
- Respect environment: wind advection, basic slope uplift, wetness/retardant suppression.
- Performant: target ≤ 2–4 draw calls for particles, adjustable budgets, distance-based LOD/culling.
- Deterministic-enough per tile given the simulator’s time progression (stable look, not identical every run).

## Inputs

- `FireGrid` frontier arrays per tick: `igniting[]`, `burning[]`, `smoldering[]` and their counts.
- Tile data: `state`, `heat`, `progress`, `fuel`, `wetness`, `retardant`.
- World info: `Heightmap.sample(x,z)` to place particles at terrain surface; `Env windDirRad/windSpeed` from `FireSim`.

## Visual States & Fuels

We render three particle systems:

- Flames: short-lived, bright, rising, with slight turbulence. Driven by `state=Burning`, `heat` and `fuel`.
- Smoke (thick): lives longer, grows and fades, strongly wind-advected. Mostly `Burning` (hot/blackish → gray) and early `Smoldering` (gray → light).
- Smolder (thin): small puffs close to ground, slow expansion and fade, `Smoldering` tiles only.

Fuel presets (relative multipliers):

- Forest: flame size 1.4×, flame rate 1.3×, smoke 1.6×, smolder 1.2×, longer lifetimes.
- Chaparral: flame 1.0×, smoke 1.2×, smolder 1.0×.
- Grass: flame 0.8× (faster but smaller), smoke 0.7×, smolder 0.6×, shorter lifetimes.
- Rock/Water: no emission.

Wetness/retardant gates reduce rates and sizes: multiply rates by `exp(-2.0 * (wetness + 0.6*retardant))`.

## Emission Model

Per active tile we maintain an emitter accumulator to convert continuous rates to discrete particle spawns.

- Per-tile emission rate `R` for flames/smoke as a function of `heat` and `fuel`:
  - `R_flame = base_flame[fuel] * (0.3 + 0.9 * heat)`
  - `R_smoke = base_smoke[fuel] * (0.4 + 1.1 * heat)`
  - For `Smoldering`: `R_smolder = base_smolder[fuel] * clamp(1 - heat, 0.3, 1.0)`
- Random jitter per tile via hashed index + time to avoid lockstep.
- Distance LOD: scale `R` by LOD factor, e.g. near: 1.0, mid: 0.5, far: 0.1, beyond cutoff: culled.
- Maximum total particle budget enforced globally per system; if over, reduce spawns with a global throttle.

## Particle Attributes (per-instance)

- Position (world x,y,z) seeded at tile center with small random offset within the cell.
- Velocity (vx, vy, vz): upward base + wind advection `(wx,wz)`; slight curl noise or random jitter.
- Age + Lifetime: seconds; size and color ramp over age.
- Size: start/end; larger for forest, smaller for grass; flames shrink over life; smoke grows.
- Color ramp:
  - Flames: from deep orange `(1.0, 0.4, 0.05)` to yellow/orange `(1.0, 0.7, 0.2)`, multiplicatively modulated by `heat`.
  - Smoke (thick): from dark brown/black `(0.15, 0.12, 0.10, alpha 0.7)` to gray `(0.6, 0.6, 0.6, alpha 0.0)`.
  - Smolder: light gray `(0.7, 0.7, 0.7, alpha 0.5)` to near transparent.
- Optional: per-instance “spin” or “frame” for atlas-based sprite variation.

## Rendering Approach

- Single InstancedBufferGeometry per system (flames, smoke, smolder) to keep draw calls low.
- Billboard quads constructed in vertex shader from per-instance center/size, facing camera.
- Simple alpha-blended materials; set `depthWrite: false`, sorted renderOrder after terrain; consider soft-particle depth fade later.
- Texturing: start with a simple circular falloff in shader (no texture). Upgrade path: small sprite atlas (2–4 variants) for detail.

## CPU Update Loop

We use a pooled particle system with SoA arrays per system:

- Capacity: e.g. Flames 8k, Smoke 12k, Smolder 6k (tunable). Quality presets will scale these.
- Arrays for `pos, vel, age, life, size0, size1, color0, color1`.
- Update `age += dt`; kill when `age >= life`; compact with free-list or ring buffer.
- Spawn pass: traverse `burning` and `smoldering` frontier arrays, update each emitter’s accumulator, spawn particles (writing into free slots) until budget reached.

Wind/slope advection:

- Wind vector `(wx, wz)` from `FireSim.env`; add to horizontal velocity scaled by `(0.4 + 0.6*heat)` for smoke.
- Vertical velocity base: flames `(1.2..2.0)`, smoke `(0.6..1.4)`, smolder `(0.2..0.5)`; add small uphill lift proportional to `slopeTan`.

## LOD & Performance

- Camera distance to tile center: define Near < 80m, Mid < 180m (same thresholds as terrain LOD), Far < 300m, Beyond culled.
- LOD multipliers for emission rate and max living particles per tile.
- Global clamp: if alive_count > capacity × 0.9, scale new spawns down.
- Optionally skip updates for offscreen or occluded tiles (future improvement).

## API (proposed)

```ts
// src/particles/fireParticles.ts
export type ParticleQuality = 'low' | 'med' | 'high';
export function createFireParticles(hm: Heightmap) {
  const flames = createSystem({ kind: 'flame' });
  const smoke = createSystem({ kind: 'smoke' });
  const smold = createSystem({ kind: 'smolder' });
  const group = new Group(); group.add(flames.mesh, smoke.mesh, smold.mesh);
  let quality: ParticleQuality = 'med';
  let enabled = { flames: true, smoke: true, smolder: true };

  function setQuality(q: ParticleQuality) { quality = q; resizePools(q); }
  function setEnabled(part: Partial<typeof enabled>) { Object.assign(enabled, part); }

  function update(grid: FireGrid, env: Env, dt: number, camera: THREE.Camera) {
    // Decide LOD per tile, compute emission rates, spawn into pools, then integrate particles.
    if (enabled.flames) flames.update(grid, env, dt, camera);
    if (enabled.smoke) smoke.update(grid, env, dt, camera);
    if (enabled.smolder) smold.update(grid, env, dt, camera);
  }

  return { group, update, setQuality, setEnabled };
}
```

Integration points:

- Construct once in `main.ts` after `createFireViz`; `scene.add(particles.group)`.
- In the main loop, call `particles.update(fireGrid, simEnv, dt, rig.camera)`.
- On world regenerate, dispose meshes and recreate with the new `Heightmap`.
- Debug UI: add toggles (flames/smoke/smolder), quality selector, and a “max particles” slider.

## Suggested Defaults

Base rates (particles per second per burning tile at `heat=1`):

- Flames: forest 18, chaparral 14, grass 10
- Smoke: forest 10, chaparral 8, grass 6
- Smolder: forest 4, chaparral 3, grass 2

Lifetimes (seconds): flames 0.5–0.9, smoke 3–6, smolder 1.5–3.5.

Sizes (meters at start/end):

- Flames: start 0.4..0.8, end 0.1..0.2
- Smoke: start 0.6..1.2, end 2.0..4.0
- Smolder: start 0.3..0.6, end 1.0..1.8

Quality presets (total pooled capacity across all systems):

- Low: flames 3k, smoke 4k, smolder 2k
- Med: flames 6k, smoke 8k, smolder 4k
- High: flames 10k, smoke 12k, smolder 6k

## Shaders (outline)

Vertex shader (billboard):

- Take instance attributes: center, age, life, size0, size1.
- Compute size = mix(size0, size1, t), where t = age/life.
- Build quad in view-space facing camera (two axes from camera right/up).
- Optionally add subtle per-instance rotation.

Fragment shader:

- For flames: radial falloff + blackbody-like gradient based on t and heat.
- For smoke/smolder: soft circular falloff; color ramps to transparent; premultiplied alpha.

We can start with untextured quads (math falloff) and later switch to small atlases for detail.

## Determinism & Randomness

- Use a simple hash per tile index and an emitter-local counter to derive pseudo-random offsets/velocities so visuals are stable frame-to-frame.
- Seeding: combine `grid.seed`, tile index, and a local step to vary patterns across runs with different `grid.seed` or time.

## Implementation Plan

1) Scaffolding
   - `src/particles/fireParticles.ts`: container + three systems.
   - `src/particles/system.ts`: shared pool (add/remove/compact, instanced attributes, simple shaders).
2) CPU integration
   - Read `grid.burning/smoldering`; for each active tile, accumulate spawn; emit per fuel and state.
   - Wind advection + slope lift in velocity.
3) Debug UI
   - Add toggles + quality select in `src/ui/debug.ts` under a new “Particles” section.
4) World regen wiring
   - Recreate particle container on regenerate.
5) Optimizations (later)
   - Depth-softening near terrain, sprite atlas, optional GPU update path.

## Testing

- Determinism test with fixed `grid.seed` and `sim` wind: ensure number of live particles and rough AABB stable within tolerance.
- Performance sanity: verify frame time under target with medium quality on typical hardware; assert pool never overflows in load tests.

---

If this direction looks good, next step is to scaffold `src/particles/` with a pooled instanced system and wire it into `main.ts` with a minimal flame-only pass, then expand to smoke and smolder.

