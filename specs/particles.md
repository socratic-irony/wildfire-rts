# Particles: Flames, Smoke, Smolder — Flipbook + Ribbon

This spec captures the particle FX approach used to visualize wildfire combustion across fuels (forest, chaparral, grass) in Three.js. It aligns with the fire grid (`src/fire/grid.ts`) and simulator (`src/fire/sim.ts`) and focuses on batching, low overdraw, and simple control from the CPU.

## Status

- Implemented (feature/particles):
  - GPU‑instanced flipbook billboards for flames/smoke using a single atlas and one material (`src/particles/flipbook.ts`).
    - Per‑instance attributes: `iOffset(vec3)`, `iSize(float)`, `iAngle(float)`, `iF0(float)`, `iRate(float)`, `iFBase(float)`, `iFCount(float)`, `iColor(vec3)`, `iAspect(float)`, `iPhase(float)`, `iRise(float)`.
    - Billboarding done in vertex shader using camera right/up; simple size‑over‑life; placeholder atlas generated on the fly.
    - Distance LOD throttles emission; hard cap via `mesh.count`.
  - Perimeter ribbon strip (`src/particles/ribbon.ts`): expanded line rendered as one mesh with animated UV flow; UI exposes `visible/width/opacity/speed`.
  - Wired in `src/main.ts`: created once, updated every frame; ribbon controls in Debug UI Fire panel.
- Legacy (kept for reference): CPU‑pooled instanced spheres (`src/particles/system.ts` + `src/particles/fireParticles.ts`). Not used by `main.ts` anymore; useful as a baseline, for potential embers, and now configurable (wind/vertical response overrides) so other systems like vehicle FX can reuse it for dust/water sprays.

## Outstanding Work

- Flipbook
  - Replace placeholder DataTexture with a packed atlas (flames + smoke rows); keep single material/atlas to preserve batching.
  - Soft particles (depth‑fade) to hide terrain intersections; evaluate cost with depth texture.
  - Wind/slope drift directly in shader or via per‑instance offsets; currently only spawn placement considers heightmap.
  - Optional: separate FPS by distance (near 12–16, far 4–8) to reduce perceived repetition.
- Ribbon
  - Improve tangent/normal continuity and simplify contours before meshing (RDP or resample at even spacing) to reduce vertex count.
  - Intensity‑driven width/color from local heat.
- Embers (later)
  - GPU update path (WebGL2 Transform Feedback or texture ping‑pong) for 2–8k additive embers; render as points or tiny quads.
- Hero plumes (later)
  - Cross‑card or blob meshes with slow vertex noise for rare, dramatic events.

Tests: `src/__tests__/particles_flipbook.test.ts` covers basic capacity and update wiring.

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

## Rendering Approaches (chosen stack)

1) Flipbook‑instanced billboards (primary)
   - One `InstancedMesh` of a unit quad (`PlaneGeometry`) + one `ShaderMaterial` sampling a vertical frame stack (flipbook atlas).
   - Per‑instance attributes drive position, size, angle, color, initial frame and frame rate. `iAspect` and `iPhase` add taller flames and size‑over‑life variation without CPU state.
   - Vertex shader builds a camera‑facing quad from camera right/up; fragment samples the atlas slice. Depth write off; premultiplied alpha recommended for fire.

2) Fire‑edge ribbon (perimeter strip) (complement)
   - Marching‑squares perimeter → expanded polyline strip in world‑space; animated UV x to suggest flow/licking.
   - Replaces “sprites along the entire front” with one draw; hotspot flipbooks can still be sprinkled.

3) Embers via GPU update (planned)
   - Transform Feedback buffers for pos/vel update on GPU; render as additive points.

4) Hero plumes as mesh stacks (planned)
   - Cross‑cards or low‑poly blobs for rare large plumes.

## Update Model

- Flipbook: CPU only decides where/how many to spawn this frame (no per‑particle CPU lifetime). All animation (frame advance, size‑over‑life, aspect stretch, rotation) is shader‑driven.
  - Emission: traverse `burning` and `smoldering` frontier arrays; apply distance LOD; spawn at most 1–2 flames per hot tile + occasional smoke; clamp by a global cap; write attributes once per frame into the first `mesh.count` slots.
  - “Lifetime” look: `iPhase` and `iRate` modulate size‑over‑life and atlas frame; instances are ephemeral (rebuilt every frame), avoiding CPU GC pressure.
  - Camera basis: extract `cameraRight`/`cameraUp` from camera matrix each frame.
- Ribbon: rebuild geometry from `computePerimeter(grid)` each frame; small and cheap compared to many sprites; evolving width/opacity via uniforms.

## LOD & Performance

- Camera distance to tile center: define Near < 80m, Mid < 180m (same thresholds as terrain LOD), Far < 300m, Beyond culled.
- LOD multipliers for emission rate and max living particles per tile.
- Global clamp: if alive_count > capacity × 0.9, scale new spawns down.
- Optionally skip updates for offscreen or occluded tiles (future improvement).

## APIs (current)

- Flipbook sprites — `src/particles/flipbook.ts`
  - `createFlipbookParticles(hm)` → `{ group, update(grid, env, dt, camera), setQuality(q), setEnabled(part) }`.
  - Attributes written each frame: `iOffset, iSize, iAngle, iF0, iRate, iFBase, iFCount, iAspect, iPhase, iRise, iColor`.
  - Uniforms: `uTime, uFrames, uAtlas, cameraRight, cameraUp`.
  - Atlas layout: vertical stack with flames frames first, then smoke frames; per‑instance `iFBase/iFCount` select the sub‑range.
  - Quality presets map to total cap (default 8k). One atlas/material keeps batching to one draw.

- Ribbon — `src/particles/ribbon.ts`
  - `createFireRibbon(hm, { width, yOffset, speed, opacity, visible })` → `{ mesh, update(grid,time), setVisible(on), setOpacity(o), setWidth(w), setSpeed(v) }`.
  - Rebuilds geometry from `computePerimeter(grid)`; animated in `onBeforeCompile` via `uTime`/`uSpeed` uniforms.

Integration (main.ts)

- Construct once after fire viz: add `fireParticles.group` and `fireRibbon.mesh` to the scene.
- Per frame: call `fireParticles.update(grid, env, dt, camera)` and `fireRibbon.update(grid, time)`.
- On world regenerate: recreate both (already wired in `main.ts`).

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

## Flipbook Shader Notes

- Vertex: use `cameraRight/cameraUp` to face quads; rotate in plane by `iAngle`; compute size‑over‑life from `iPhase` + `uTime * iRate`; apply `iAspect` for taller flames; add vertical rise over life via `iRise`; pick frame within a per‑instance range via `iFBase/iFCount`.
- Fragment: sample vertical frame stack with `frame = iFBase + mod(iF0 + uTime * iRate, iFCount)`; prefer premultiplied alpha for additive fire.
- Depth: `depthWrite=false`; consider soft‑particle depth fade once a depth texture is available.

## Determinism & Randomness

- Use a simple hash per tile index and an emitter-local counter to derive pseudo-random offsets/velocities so visuals are stable frame-to-frame.
- Seeding: combine `grid.seed`, tile index, and a local step to vary patterns across runs with different `grid.seed` or time.

## Plan (incremental)

1) Flipbook foundations (done)
   - Instanced quad + shader flipbook; per‑tile LOD; placeholder atlas; UI wiring via main loop.
2) Perimeter ribbon (done)
   - Marching‑squares → strip mesh; flow UV; UI controls in Debug panel.
3) Atlas + material unification (next)
   - Replace placeholder with a 2k atlas containing flames/smoke rows; keep one material to batch both.
   - Add per‑instance state to select row range if needed.
4) Soft particles + wind (next)
   - Add optional depth‑fade; modulate offsets by wind to drift smoke.
5) Embers GPU update (later)
   - TF update + additive points for 2–8k embers.
6) Hero plumes (later)
   - Cross‑cards/blob meshes for rare events.

## Testing

- Flipbook: headless update exercises instanced count ≤ cap and >0 when burning tiles exist (`src/__tests__/particles_flipbook.test.ts`).
- Performance: verify frame time ≤ 3–4 ms for particles at medium quality on mid‑range laptop; check draw calls remain minimal (1–2 for sprites + 1 for ribbon).

## Budgets & Tuning

- Flipbook billboards: 6–10k visible (mixed flames/smoke) on iGPU; keep quads tight; clamp max screen size; throttle at distance.
- Ribbon: ~2–5k verts after simplification.
- Embers: 2–8k points if/when enabled.
- Atlas: start with 2048×2048; frame size 128–256px; animate 8–16 fps near, 4–8 fps far.

This spec now reflects the chosen approach (flipbook + ribbon) in the `feature/particles` branch and the current code. See “Outstanding Work” and “Plan” for next steps.
