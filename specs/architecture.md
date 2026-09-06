# Architecture & Backend Spec (v0.1)

 Purpose

- Provide a quick, high-signal map of the repository for new contributors and tooling (incl. LLMs).
- Capture the core runtime model, modules, data flow, and extension points.
- List guiding principles and conventions to keep behavior predictable and performant.

Agent Adherence (Required)

- Treat this document as the source of truth for repository structure, abstractions, and performance practices.
- Before coding, skim this file end‑to‑end and the domain spec(s) you will touch.
- If an implementation needs to deviate, update this spec first (or in the same commit) and explain why.
- Do not land changes that alter module responsibilities, hot‑path patterns, or data shapes without aligning the spec.

Repository Topology

- Entry: `src/main.ts` wires all systems (terrain, camera, fire, roads, vehicles, UI) and owns the frame loop.
- Testbed: `vehicles-test.html` + `src/vehicles_test.ts` — a minimal, isolated page for vehicle/road experiments on a small flat map with preset road layouts (loop / figure-8). Does not affect the main app.
- Core: `src/core/`
  - `renderer.ts`: WebGL renderer factory and resize logic; `createComposer(renderer, scene, camera)` builds the r160 post chain RenderPass → UnrealBloomPass(half internal res, strength 0.45, radius 0.4, threshold 0.85) → OutputPass (tone mapping + sRGB conversion live inside OutputPass since r155; ACESFilmic stays on the renderer). Returns null on missing WebGL2 or construction failure so callers fall back to plain `renderer.render`; `?nofx=1` skips composer creation for perf probes/software-GL audits. The menubar 🎨 Graphics section exposes a Bloom toggle that flips `bloomPass.enabled` live.
  - `environment.ts`: procedural Sky dome (`three/examples/jsm/objects/Sky.js`) plus fog/light retuning applied through the live scene — never edits `scene.ts`. Exports pure `computeSunVector(elevDeg, azDeg)` (unit vector toward the sun; elevation 90 → +Y, azimuth 0 → +Z) used to keep the dome's sun uniform aligned with the directional light's normalized position. `createEnvironment(scene, { sunLight?, hemiLight?, worldRadius?, retuneLights? })` replaces the boot FogExp2 with a horizon-matched color at density 0.0018, keeping haze distant enough for roads and units to remain readable, tints `scene.background` to the same warm haze, and nudges passed light intensities (sun 1.25, hemi 0.5) for a late-afternoon look. Dome half extent defaults to 900 world units and must stay inside the camera far plane (wiring raises camera.far to ≥2000). Covered by headless unit tests around `computeSunVector` and fog/uniform wiring.
  - `scene.ts`: Three.js scene creation; hemisphere fill + shadow-casting directional sun. `createScene({ worldCenter?, shadowExtent? })` positions the sun relative to the world center (default `{64,64}`), adds the sun target to the scene, and sizes the ortho shadow box to ±`shadowExtent` around it (default 96; `main.ts` passes half the play area × 0.75) so shadows cover the whole map instead of the ±5-unit default.
  - `cameraController.ts`: clean-room damped RTS camera controller (`CameraController`) owning a `PerspectiveCamera` directly. True spherical orbit around a ground target (`pos = target + (sin(yaw)·dist·cos(pitch), dist·sin(pitch), cos(yaw)·dist·cos(pitch))`, look-at at sampled ground height). All channels (yaw/pitch/dist/target-x/z) converge to goals via framerate-independent exponential damping (`v += (goal−v)·(1−exp(−λ·dt))`). Direct intent APIs (`rotate/panPixels/zoom`) are shared by the DOM adapter (pointer drag/wheel/two-finger pinch, bound only when `dom !== null` so headless unit tests construct it without DOM) and unit tests; zoom-to-cursor lerps the target goal toward the projected cursor point by the zoom fraction. Keyboard intents flow through `update(dt, move)` — WASD/arrows pan on the yaw basis with speed scaled by `clamp(dist/refDist, 0.25, 4)`; Q/E yaw; R/F pitch (all wired); Space resets yaw/pitch/dist goals. Hard clamps: target X/Z to bounds, pitch/dist to min/max; terrain clearance keeps the camera ≥2 units above sampled ground without moving the look-at target. `focus()` snaps goals AND currents instantly (deterministic framing for audits); `follow(provider)` snaps the target to a position provider each update while orbit angles stay user-controlled; `setInputLockCheck` suppresses rotate/pan/zoom during painting. Covered by headless unit tests in `src/core/__tests__/cameraController.test.ts`.
  - `loop.ts`: frame loop with callback list; provides `dt` to subsystems. Periodic perf metrics log every 300 frames but are only formatted when `Logger.isEnabled('debug')` passes, so the default `info` level skips payload construction entirely.
  - `input.ts`: lightweight keyboard/pointer state tracker shared by `main.ts`, the vehicle testbed, and the particle test page (normalizes keys to lowercase and exposes a `Set`).
  - `random.ts`: shared deterministic 32-bit linear-congruential generator used by actor scattering; preserves the established per-seed sequences.
- Terrain: `src/terrain/`
  - `heightmap.ts`: procedural map generator + bilinear `sample(wx,wz)` API.
  - `coordinates.ts`: nearest-cell world-to-grid conversion with map-bound clamping, shared by interaction and actor-placement call sites.
  - `mesh.ts`, `material.ts`: low-poly tri mesh + flat-shaded material with grid overlay support.
  - `biomes.ts`: biome masks (rock/forest/chaparral) + vertex tinting.
  - `chunks.ts`: chunked LOD terrain with visibility toggle and base/hi geometry; per-chunk edge skirts to hide LOD cracks; bounding spheres for distance tests. `dispose()` frees both LOD geometries (`geoHi`/`geoLo`) of every chunk; the shared terrain material intentionally stays alive across rebuilds.
- Fire System: `src/fire/`
  - `grid.ts`: grid state (tiles, indices), ignition helpers, suppression hooks, containment heuristic.
  - `params.ts`: tuning constants and fuel tables.
  - `sim.ts`: fixed-step fire simulation with accumulator; slope/wind ROS; ignition/wetness/retardant; smoldering. Its every-30-steps state log is gated behind `Logger.isEnabled('debug')` (startup `info` lines are unaffected).
  - `viz.ts`, `overlay.ts`, `perimeter.ts`: visualization (overlay quads, vertex tint; thin perimeter outline). Also exports `computePerimeter(grid)` for analytics/UI.
  - `stats.ts`: compute active counts, burned tiles/area, and perimeter length (`computeFireStats`).
- Events: `src/events/events.ts`: seeded random-event system (lightning ignitions via exponential inter-arrival, wind shifts eased into the live sim env). Disabled by default; opted in via the menubar fire-section checkbox or `__wildfireTestApi.setRandomEvents(on, seed)`. Deterministic per seed — covered by the `random-events` audit scenario.
- Buildings: `src/buildings/buildings.ts`: seeded procedural road-frontage lots for houses/barns plus isolated cabins ≥12 tiles from any road preferring forest fuel. Each building carries an oriented rectangular footprint, one-cell road/building clearance ring, deterministic variant, and driveway entrance/road contract. The latching state machine remains intact → burning (tile hot) → destroyed (tile burned through), with recovery to intact if suppressed in time. `computeStructureScore` = +10 per standing structure, −25 per loss; surfaced in `getScenarioResult().structures/score`. `visual.ts` renders separate instanced low-poly house/barn/cabin silhouettes with doors, windows, porches, chimneys and frontage driveways, with per-state tinting (burning orange, destroyed charred stubs). Covered by the `buildings-protection` audit scenario; detailed contracts live in `specs/buildings.md`.
- Roads: `src/roads/`
  - `cost.ts`: per-tile elevation/slope/valley fields for road A* cost.
  - `astar.ts`: grid A* (4/8-neigh), cost callback, with diag support.
  - `planner.ts`: shared player/testbed road planner combining terrain cost, slope blocking, grade penalty, curvature penalty, 4-neighbor A*, and angular path reduction.
  - `visual.ts`: one depth-tested smoothed asphalt ribbon (adaptive Catmull–Rom), normal-offset to hug terrain, deterministic low-frequency vertex-color asphalt variation, dusty shoulders, solid edge markings, and dashed warm center markings. Physical intersections receive a shared apron and suppress road markings through the conflict area. Stable intersection metadata drives one shared-resource, instanced octagonal STOP sign per actual incoming approach; endpoint joins remain excluded, while X/T/self-crossings derive 4/3/4 approaches respectively. Duplicate segment hits merge by position, self-crossings retain both path arc occurrences under one intersection ID. Triangle lattice/midline diagnostics are hidden by default and exposed only through debug controls.
  - `procedural.ts`: procedural loop generator (oval/figure-8/rectangle) for boot/regenerate seeding.
  - `state.ts`: rasterization of road paths to a road mask; integration hooks (e.g., fire grid fuel adjustments).
- Vehicles: `src/vehicles/vehicles.ts`: instanced agents with road and air pathing, terrain-aligned pose, and fire-suppression hooks. `dispose()` releases the manager's geometries/materials/instanced attributes across `group` and `particleGroup`; regeneration in `main.ts` removes + disposes the OLD manager's groups before creating the replacement (the old group is the one actually parented to the scene).
  - `src/vehicles/types.ts`: shared vehicle enums + FX state types.
  - `src/vehicles/vehicleFx.ts`: particle/light FX helpers for vehicles and external emitters.
  - `src/vehicles/followerOrders.ts`: selection + order utilities for Frenet followers (including off-road bulldozer orders).
  - `src/vehicles/intersectionManager.ts`: authoritative all-way-stop controller for visible Frenet followers; batch approach/queue/grant arbitration, full-stop timing, exclusive occupancy, closed-loop-safe clearance, spillback probe, and telemetry.
  - `src/vehicles/trafficSpacing.ts`: assigns same-path leaders including the virtual closed-loop seam leader.
  - `src/vehicles/menubarMapping.ts`: UI type mapping for spawn commands.
  - `src/vehicles/voxelMeshes.ts`: voxel vehicle builders; unreferenced decorative parts are merged at build time into a few multi-material meshes (transforms baked into cloned geometries, per-vertex color attribute, geometry groups per material bucket) while named hook parts (`ladder`, `blade`, `rotor`, `skid`, `wings`, `tailFin`, `helmet`, `lightbar`, `userData.mainRotor/yieldIndicator`) stay as separate meshes/groups per the `meshes.test.ts` contract.
- **Fire Hydrants (HIGH PRIORITY)**: `src/fire/hydrants.ts`: automatic placement along roads (50m spacing, 100+ tiles min), coverage areas (~10m), integration with suppression system to enable firefighter deployment from road tiles within coverage.
- UI/Debug: `src/ui/debug.ts`: floating stats with memory usage; toggles for fire viz, roads, vehicles (spawn/move/clear). `src/ui/menubar.ts` owns the primary toolbar and detailed debug controls, including road lattice diagnostics and optional hydrant coverage rings. `src/ui/console.ts`: command console for introspection and debugging. `src/config/features.ts`: feature flag system for debug tools.
- Browser automation: `src/main.ts` exposes `window.render_game_to_text()`, `window.advanceTime(ms)`, and `window.__wildfireTestApi` so Playwright/browser audits can inspect live game state, fast-forward the loop, and exercise fire/road/vehicle flows deterministically without brittle pixel-only input. `advanceTime` keeps 50 ms simulation chunks but suppresses intermediate renders so software-WebGL audit runs stay bounded.
- Repo automation: `scripts/qa/playwright_audit.ts` powers `npm run audit:game`, which launches the local Vite app and verifies the current MVP loop (bootstrap, roads, vehicles, suppression, auto-dispatch, manual dispatch) against the live browser build.
- Specs: `specs/` contains domain specs (terrain, fire_behavior, vehicles, architecture).
- Root docs: `AGENTS.md` (guidelines, commit hygiene).

Runtime Model

- Init sequence in `main.ts`:
  1) Initialize feature flags and configuration system.
  2) Create scene, renderer, and the damped `CameraController` (with its own `PerspectiveCamera`) plus heightmap.
  3) Build chunked terrain, material, and apply biome colors.
  4) Instantiate fire grid/sim/viz and attach viz nodes to scene.
  5) Build road cost field, visualization group, road mask, then seed procedural road loops.
  6) Create vehicles manager and add to scene.
  7) Install debug UI (if enabled) and console system with commands.
  8) Install input handlers for ignite, road draw, and vehicle modes.
  - Branch `features/vehicles`: after wiring, seed a rectangular road loop on a small (32×32) mostly-flat test map and auto-spawn a few vehicles on the loop for immediate interaction.
- Frame loop (`Loop`):
  - Per-frame: update camera controller; LOD updates; `FireSim.step(dt)` with fixed sub-steps; `fireViz.update(grid, dt)`; `vehicles.update(dt)`; render (via EffectComposer when available, else plain renderer); stats (including memory metrics if enabled).
  - Fixed fire dt: 0.25 s with 6-step cap per frame.

Key Abstractions & Data

- Heightmap: `{ width,height,scale,data[], sample(wx,wz) }` — source of truth for elevation. `worldToGridCell(heightmap, worldX, worldZ)` is the shared nearest-cell conversion for world points; callers that intentionally use floor-based occupancy or already-grid coordinates retain their distinct semantics.
- Terrain chunks: Mesh nodes grouped; each chunk stores `baseColors` for quick vertex recolor plus `geoHi`/`geoLo` LOD geometries released by `dispose()`. Regeneration paths in `main.ts` remove + dispose every replaced system (chunked terrain, forest, shrubs, rocks, roads visual, hydrant coverage rings, vehicles manager, buildings/hydrant visuals) so GPU resources do not leak across reseeds.
- Fire
  - FireGrid (SoA): `{ width,height,params, state:Uint8Array, heat/progress/wetness/retardant/lineStrength/fuelMoisture/lastIgnitedAt/slopeTan/downX/downZ:Float32Array, fuel:Uint8Array (FUEL_KEYS index), igniting/burning/smoldering:Uint32Array, iCount,bCount,sCount, time, seed }`. Tile access is `grid.<field>[idx]`; `sampleTile` returns an object snapshot.
  - Tile: AoS object including `state,heat,progress,wetness,retardant,lineStrength,fuel,slopeTan,downX,downZ` (fuelMoisture early adoption planned).
  - FireSim: neighbor ignition via ROS and Poisson arrival; spotting (simple); combustion progressions; early extinguish; moisture decay.
  - FireViz: overlay instances and vertex tint; perimeter overlay hugging terrain; analytics via `computePerimeter` + `computeFireStats`.
- Roads
  - CostField/planner: elevation/slope/valley; slope-block threshold; grade and curvature penalties live in `src/roads/planner.ts` so the main game and vehicle testbed share identical player-road planning.
  - Visual: Catmull–Rom smoothed midlines resampled to uniform spacing (~2 tile asphalt width) with a 3-column cross-section; one normal-offset, depth-tested, double-sided asphalt mesh with coherent vertex-color variation so terrain and vehicles occlude it correctly; dusty shoulders blended back into terrain; polygon-offset solid edge and dashed center markings measured in planar XZ arc length. Intersection aprons integrate with the asphalt and suppress markings inside their radius. Stop signs are generated from the same intersection occurrences: signs sit on the right side of each incoming approach, outside the shoulder, at the shared `INTERSECTION_STOP_DISTANCE` stop line, and use shared instanced board/border/glyph/pole resources. The production group must not stack a second filled baseline ribbon because the separation reads as variable road thickness on hills. Optional diagnostic wireframe and midline render under a hidden-by-default debug group.
  - Mask: `Uint8Array` marking road tiles; consumed by vehicles pathing and fire integration.
  - Procedural: road loops are generated in tile space on boot/regenerate and re-projected onto the current heightmap via `RoadsVisual`.
- Vehicles
  - Agent: `{ pos, grid, path[], pathIdx, speedTilesPerSec, autoFollowRoad, prev? }`.
  - Movement: interpolate along grid path; altitude from heightmap; orientation from terrain normal + path direction.
  - Pathing: A* restricted to road tiles; auto-follow advances along connected road neighbors.
  - Visible Frenet traffic: `Path2D` centerline motion with right-side lane offset and terrain-normal road clearance; `IntersectionManager` owns traffic phase and grants. Cars currently continue on their assigned centerline at crossings rather than switching directed edges.
- **Fire Hydrants (HIGH PRIORITY)**
  - System: `{ hydrants[], roadMask, minSpacingTiles, idealSpacingTiles }` with automatic placement and coverage calculation.
  - Placement: Auto-spawn every ~50m along roads with 100+ tile minimum spacing; dynamic updates on road changes.
  - Coverage: ~10m radius areas enabling firefighter deployment and unlimited water supply from road tiles.
  - Visualization: hydrant markers are visible by default; coverage radius rings start hidden and can be enabled from detailed debug controls.
  - Integration: Extends `applyWaterAoE` suppression system; complements firetruck capabilities.

Event Flow & Input

- Click handling in `main.ts` branches by mode:
  - Roads On: raycast to terrain → grid cell → shared road planner builds an A* road path → visualize + rasterize mask.
  - Vehicles Move On: raycast → grid → set shared destination on road network.
  - Otherwise: ignite tile for fire demo if ignite mode is active.
- Dispatch lifecycle: `dispatchLoop` promotes incidents from `detected` → `assigned` → `engaged`, and the registry resolves incidents once the source tile is no longer burning/igniting and any remaining smolder heat has fallen below the extinguish threshold.
- Manual dispatch UX: the dispatch panel only enables "Assign selected" when the currently selected follower can actually service the incident from its current road/path, using the same routeability rule as the dispatch logic.

Performance Principles

- Vegetation static lobes/branches are merged once per family/material by `actors/plantGeometry.ts`, then whole silhouettes are instanced (eight tree batches and three shrub batches on the default map). `actors/clearance.ts` builds a road/lot/driveway exclusion mask after edits; `main.ts` coalesces invalidations into one rebuild before the next frame, preserving visibility, fire tint, and seeded appearances.

- Prefer InstancedMesh for repeated quads (fire overlays) and agents.
- Avoid per-frame allocations where possible; reuse Vectors/Matrix4 in hot loops.
- The main loop in `main.ts` keeps persistent views over the follower fleet: the dispatch-loop ref array (`followerRefPool`, route/canRoute closures baked once) rebuilds only on membership change (spawn/clear set a dirty flag), mutable `busy`/`waterRemaining` fields sync per frame, and the intersection-manager input uses pooled slot objects plus a reused leader scratch array. Busy-count/selected-follower HUD lookups run in a single fleet pass.
- Restrict fixed-step sub-steps; clamp to avoid spiraling on stalls.
- Minimize per-frame scanning over large arrays (e.g., keep frontier lists for fire; in vehicles, use grid-path interpolation, not dense projections).
- For visuals that must hug terrain, sample normal + normal-offset and use polygon offset for z-ordering.

Error Handling & Determinism

- FireSim retains a seed for deterministic `rand01` hashing; call orders should be stable within a tick.
- Procedural actor scattering uses `createLcg(seed)` from `src/core/random.ts`; each generator owns independent state and retains the legacy LCG sequence for existing seeds.
- Clamp and guard divisions with small epsilons (e.g., distances, dot products) to avoid NaNs.

Extensibility Hooks

- Fire suppression: `applyWaterAoE`, `applyRetardantLine`, `writeFirelineEdges`; tile fields (`wetness,retardant,lineStrength`).
- Fire queries: `isContained`, `sampleTile` (and planned perimeter polyline export).
- **Fire hydrants**: `canSuppressAt`, `findNearestHydrant`, coverage calculation; automatic placement on road network changes.
- Vehicles: water/retardant actions can call FireGrid APIs; per-type speed and handling implemented; laneing and advanced spacing remain future work.
- Roads: attach metadata (class/type) and vary width/material; expose midline for more advanced AI.

Testing Strategy

- `npm run typecheck` enforces strict TypeScript compilation across application, tools, QA scripts, and Vite configuration, including zero unused locals and parameters.
- `npm run check` is the canonical local gate: type-check, complete Vitest suite, then production build.
- Local Vitest runs use at most two workers (minimum one) to limit CPU spikes while the editor/game is open. Coordinate browser audits one at a time, close task-owned browser tabs and preview servers in cleanup, and avoid concurrent full-suite runs across worktrees.
- `npm run build` invokes Vite bundling only; it does not run `tsc` and is not a replacement for either gate above.
- `src/__tests__/source_graph.test.ts` resolves relative TypeScript imports from documented application, testbed, script, test, configuration, and logging-demo roots, and fails when a maintained source module becomes unreachable. Explicit protected roots also preserve documented test-only compatibility surfaces (`tools/logger.ts`, `terrain/mesh.ts`, and legacy `particles/fireParticles.ts`) if their paired tests move or disappear. The abandoned, unreferenced dispatch station-registry prototype was removed when this gate was introduced.
- Unit tests around math-heavy pieces:
  - Heightmap sampling, normal estimation.
  - Pinned LCG sequences and independent generator state.
  - World-to-grid nearest-cell rounding, scale conversion, and boundary clamping.
  - FireSim tick transitions and ignition probabilities (deterministic seeds).
  - A* path validity and slope/turn costs.
- Browser audits use `render_game_to_text`, `advanceTime`, and `__wildfireTestApi` to verify live feature claims such as road placement, hydrant regeneration, vehicle spawning/dispatch, and suppression outcomes against the rendered scene.
- The `traffic-intersection` browser scenario creates two crossing roads and four cars, then verifies queue formation, deterministic all-way-stop service, exclusive occupancy, minimum spacing, non-overlap, progress, drained queues, and error-free WebGL rendering while capturing visible stopped-car contention.
- `npm run audit:game` is the current end-to-end browser verification entry point and should be rerun after changes that touch movement, UI actions, dispatch, or fire suppression flows. Audit hardening rules (enforced in the harness):
  - Audit pages load with `?nofx=1` so the post-processing composer is skipped — assertions read state, not pixels, and software-GL (SwiftShader) rendering makes bloom pure CPU cost.
  - The dev server spawns with `--strictPort`; a busy port fails loudly instead of silently auditing whatever stale server owns it.
  - Timing-sensitive scenarios pump simulated time via `window.advanceTime(ms)` instead of sleeping wall-clock: under SwiftShader the rAF loop advances only ~0.1 sim-s per wall second, so wall-clock deadlines race resolution nondeterministically (auto-dispatch and manual-dispatch use this; payload-round-trip drains and reads back inside a single evaluate for the same reason).
  - Wall-clock deadlines remain only as generous backstops.
- Headless update tests to validate determinism (e.g., same perimeter length after N ticks).

Contribution & Spec Hygiene

- Before committing, update the relevant spec(s) in `specs/` (what works vs not yet; API changes). See AGENTS.md.
- Keep runtime and data shapes consistent with docs; if you diverge, document the deviation and why.
- Project-local implementation worktrees live under the ignored `.worktrees/` directory.

LLM Orientation Checklist

- Start: read `AGENTS.md`, then skim `specs/*.md` (terrain, fire_behavior, vehicles, architecture).
- Follow `src/main.ts` to see wiring order and active flags.
- When changing behavior:
  - Identify the tight-loop code paths (viz updates, sim ticks); measure allocations.
  - Prefer small, reversible edits; build after each change.
  - Update the corresponding spec file section.

Open Opportunities / Next Items

- Fire: edge-based line strength; crown behavior; UI paint tools; wire stats into UI.
- Roads: directed lane graph, road-class metadata, turn splines, and cross-component intersection routing.
- Vehicles: turn selection across the future lane graph; compatible conflict-zone tokens/signals; retirement of the deprecated grid traffic stack.
- Repository maintenance: strict unused-code checking and the maintained-source graph are enforced. Shared deterministic random, coordinate conversion, and water-application helpers replace proven duplication. Continue reducing oversized orchestration modules only behind characterization tests while preserving documented app and testbed behavior. The approved implementation sequence is recorded in `docs/plans/2026-07-12-repository-cleanup.md`.
- (v2.0+) Scenario persistence (save/load) – out of scope for current milestone.
- Telemetry: per-subsystem timings in stats overlay; debug draws (normals, probability arrows).

Glossary

- world units: meters (1 tile = `heightmap.scale`).
- grid cell: integer tile coordinates used by fire/roads/vehicles.
- normal-offset: elevation along surface normal to layer visuals just above terrain.
