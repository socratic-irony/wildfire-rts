# Architecture

## Status

Implemented in the v1.0 reboot. This document is the authoritative map of the current runtime. Domain behavior lives in the sibling specs.

## Purpose

Cinderline is a single-player, browser-based wildfire command RTS. It favors a rigid, readable diorama: a 96×96 tile world, integer terrace heights, an orthographic camera, deterministic simulation, and a compact HUD. The code is intentionally small enough for one developer to hold in their head; there is no save system, server, or multiplayer layer.

## Runtime topology

```text
main.ts
  -> Game (game.ts)
       -> World (terrain, biomes, roads, buildings, vegetation, hydrants)
       -> Wildfire
       -> ParticleSystem
       -> Fleet
       -> IncidentSystem
       -> Scenario (difficulty preset, wind forecast)
       -> Budget
       -> Effects (lightning, threat rings, head arrows, camera shake)
       -> SoundEngine
       -> Hints
       -> Hud
       -> CameraRig
       -> OrthographicCamera / WebGLRenderer
```

`Game` owns the frame loop, input, simulation stepping, HUD refresh cadence, and the test API. Gameplay advances in fixed `SIM_STEP = 1/30 s` steps, so the outcome of a seed does not depend on frame rate or the 1×/2×/4× speed setting. Visual particles use `Math.random` and are not part of gameplay determinism.

### Frame loop

1. Read camera keys and advance the camera rig (real time).
2. If the shift is running, not paused, and the test API is not driving the clock, simulate `dt * speed`.
3. Update incident markers and effects (real time).
4. At ~6 Hz: refresh the situation (threatened structures, fire-head arrows, audio ambience, coaching hints) and the HUD.
5. Render, with any camera-shake offset applied only for this frame.
6. On the briefing screen, slowly rotate the camera; simulation is stopped.

`Game.simulate(dt)` adds `dt` to an accumulator and runs `stepSimulation(SIM_STEP)` for each whole step (at most 24 per call; a larger backlog is dropped). Each step runs:

1. `Scenario.update(step)`, then `Budget.update(step)` and mutual-aid arrivals
2. `Wildfire.step(step)` (the fire keeps its own 0.2 s internal tick)
3. `IncidentSystem.update(step, fleet)`
4. `Fleet.update(step, incidentViews)`
5. `BuildingSystem.update(...)`

After the steps, `simulate` updates terrain and vegetation burn tint and `ParticleSystem` once with the full `dt`.

### Test clock

The first `__cinderline.advanceTime(ms)` call hands the clock to the test API: the frame loop keeps rendering but stops simulating, so scripted runs are reproducible. `__cinderline.setRealtime(true)` returns the clock to the frame loop.

## Modules

### `src/core/`

- `scene.ts` — renderer, sky dome, hemisphere/directional lights, fog, shadow camera, scene factory.
- `camera.ts` — damped orthographic RTS rig. Spherical yaw/pitch orbit, zoom-to-cursor, ground sampling, keyboard intents.
- `math.ts` — clamps, easing, angle wrapping, distance helpers.
- `rng.ts` — deterministic LCG plus hash/noise functions. World generation and fire spread use hashes/LCGs, never `Math.random`.
- `prefs.ts` — guarded local-storage helpers for remembered difficulty, mute, best scores, and seen hints. Storage failures are ignored.

### `src/world/`

- `heightmap.ts` — integer terrace levels at 97×97 vertices, town plateau, lake mask, slope limiter, bilinear height sampling.
- `biomes.ts` — terrain type classification (water, rock, forest, brush, grass, town, road lookup) and palette data.
- `terrainVisual.ts` — flat-shaded terrain mesh, per-tile vertex colors, burn/wet/retardant tint, lake surface, backdrop mountains.
- `roads.ts` — road mask, network graph, 4-neighbor A*, road planning A*, initial street layout. Both searches use a binary heap ordered by (priority, insertion order), which reproduces the original linear-scan tie-breaking exactly.
- `roadsVisual.ts` — conforming asphalt/shoulder/centerline geometry rebuilt after edits.
- `buildings.ts` — procedural lots, fire station, helipad, building meshes, damage/destroyed state, structure score.
- `vegetation.ts` — instanced pine/oak/shrub/rock families, baked low-poly geometry, per-instance burn tint.
- `hydrants.ts` — roadside placement, spacing, nearest-source queries, instanced visuals.
- `world.ts` — composition of the world systems and road editing transaction.
- `sectors.ts` — sector names and incident severity labels shared by UI and scenario.

### `src/sim/`

- `fire.ts` — structure-of-arrays wildfire model; spread, spotting, suppression, firelines, backburn lineage, cached active-tile queries, statistics.
- `particles.ts` — two pooled point-sprite systems (additive heat, normal-blended soft particles) for fire, smoke, water, retardant, steam, and dust.
- `units.ts` — fleet state machines, road/off-road movement, air movement, refills and lake dips, reach-aware attack positions, dozer lines, burnovers, mutual aid, aircraft drops, fleet events.
- `incidents.ts` — incident tracking, lookout spot-fire detection, and auto/manual dispatch.
- `scenario.ts` — difficulty preset, ignition schedule, wind forecast, objectives, win/loss, scoring, grade.
- `difficulty.ts` — Calm / Standard / Red Flag presets.
- `budget.ts` — command budget and tool/mutual-aid prices.
- `types.ts` — shared incident, notification, and unit-snapshot interfaces.
- `vehicleModels.ts` — procedural low-poly unit meshes.

### `src/fx/`, `src/audio/`

- `fx/effects.ts` — lightning bolts with a flash light, pulsing rings under threatened structures, downwind arrows at fire heads, camera-shake amount. Real-time only; never affects the simulation.
- `fx/planPreview.ts` — terrain-hugging tile overlay for planned roads and dozer lines.
- `fx/atmosphere.ts` — sunset progression over the shift and smoke haze from burning tiles (sun, hemisphere light, sky shader, fog).
- `audio/sound.ts` — procedural WebAudio beds and cues; created on the first user gesture.

### `src/ui/`

- `hud.ts` — all DOM UI: top bar, incident board, fleet list and mutual aid, selected unit panel, toolbar, minimap, toasts, tooltips, help, briefing (difficulty, best) and graded end screens, lightning flash overlay.
- `hints.ts` — one-time coaching toasts, rate-limited.
- `style.css` — HUD chrome and responsive layout.

## Key data

- `Heightmap.levels: Uint8Array` — terrace level per vertex.
- `BiomeMap.types: Uint8Array` — `Terrain` enum per tile.
- `RoadNetwork.mask: Uint8Array` — 1 for road tile.
- `Wildfire.state`, `heat`, `progress`, `wetness`, `retardant`, `fuel`, `lineStrength` — parallel arrays indexed by `tz * GRID_SIZE + tx`.
- `Building` — world footprint, rotation, front direction, fire state, damage, visual.
- `Incident` — center, severity, assigned unit ids, quiet timer, resolved flag.
- `Unit` — kind, position, heading, payload, state, assignment, route, refill source.

## Determinism and correctness

- World generation depends only on the URL seed.
- Fire spread and spotting use hashed RNG keyed by tile indices, step number, and seed. Two identical simulations produce identical state arrays (covered by unit tests).
- Gameplay RNG never uses wall-clock time. UI animation and particles may.
- Gameplay steps are fixed-size, and the test API freezes the real-time loop while it drives the clock. `npm run stability` replays its first seed and fails if the outcome differs.
- `Wildfire.refreshRoadMask` must run after road edits so new asphalt becomes non-fuel. `World.buildRoad` rebuilds the road mesh, hydrants, and vegetation; `Game` refreshes fire fuel.
- Building damage decays only when no footprint tile is actively burning. Damage reaching 100 transitions to destroyed exactly once and fires `onDestroyed`.

## Performance practices

- Vegetation is instanced per family; particle systems are pooled and capped (4,200 heat + 3,600 soft).
- Terrain is one non-indexed mesh; terrain tint updates at 2 Hz.
- Fire queries (nearest, head, counts, centroid) walk a cached list of active tiles that is rebuilt only after the fire changes; `stats()` is cached the same way. Particle emission scans the grid each frame but caps output.
- Road and off-road A* use a binary heap; route previews run on hover without stalls.
- `RoadNetwork.connected(a, b)` answers road reachability from connected-component labels recomputed only after the road mask changes; dispatch eligibility uses it instead of running A*.
- Incidents re-track their fire at 5 Hz, not every step. Engine attack positions scan only the small box within hose reach of each road tile and are cached per incident (bucketed position) for a simulated second.
- A headless profile of a full Red Flag shift (seed 12345, ~900 burning tiles at peak) costs about 5 ms of CPU per simulated second for scenario, fire, incidents, and fleet together.
- Road edits rebuild only affected systems; the initial world is built once.
- Shadows use one 2048 directional map. Real-GPU checks run well above 60 FPS at 1440×900; headless SwiftShader is intentionally not the performance target.

## Testing

- Vitest covers heightmap terrace constraints, town flatness, lake masks, biome classification, road connectivity/path blocking, hydrant spacing/rebuilds, fire lifecycle, suppression, firelines, road fuel updates, downwind spread, and determinism.
- `src/test/harness.ts` builds a headless world, fire, and fleet (no WebGL or DOM needed). `src/sim/units.test.ts` drives units through road moves and returns at several step sizes. `src/sim/mechanics.test.ts` covers backburn lineage, dozer lines, lake dips, burnovers, mutual aid, lookout detection, the wind forecast, lightning hooks, and the budget.
- `scripts/browser.mjs` launches headless Chromium; `CHROMIUM_PATH` overrides the binary and common system installs are used when Playwright's download is missing.
- `scripts/balance.mjs` (`npm run balance`) plays hands-off shifts across seeds, prints outcomes and a fire timeline, and fails if a unit stops moving while it still has a destination.
- `scripts/smoke.mjs` boots the real browser build, exercises input, dispatch, road building, pause/help/speed, fast-forwards to an outcome, and checks the end screen with no console/page errors.
- `scripts/stability.mjs` plays five seeded shifts to completion, checks outcomes, finite unit transforms, unresolved-incident consistency, and browser errors.
- `npm run check` is the canonical local gate.

## Outstanding / not in v1

- Save/load, additional scenarios, touch-first controls, full accessibility pass.
- Authored art and animation; all geometry is procedural.
- Multi-lane traffic, collision avoidance between emergency units, and persistent traffic simulation.
- Hand crews, crown fire, hydrant damage, and fire-aware engine routing.
- Full rebinding of particle pools on live terrain dimension changes (world regeneration currently restarts the page).
