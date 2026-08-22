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
  - `environment.ts`: procedural Sky dome (`three/examples/jsm/objects/Sky.js`) plus fog/light retuning applied through the live scene — never edits `scene.ts`. Exports pure `computeSunVector(elevDeg, azDeg)` (unit vector toward the sun; elevation 90 → +Y, azimuth 0 → +Z) used to keep the dome's sun uniform aligned with the directional light's normalized position. `createEnvironment(scene, { sunLight?, hemiLight?, worldRadius?, retuneLights? })` replaces the boot FogExp2 with a horizon-matched color at density 0.0045, tints `scene.background` to the same warm haze, and nudges passed light intensities (sun 1.25, hemi 0.5) for a late-afternoon look. Dome half extent defaults to 900 world units and must stay inside the camera far plane (wiring raises camera.far to ≥2000). Covered by headless unit tests around `computeSunVector` and fog/uniform wiring.
  - `scene.ts`: Three.js scene creation; minimal global lights.
  - `camera.ts`: camera rig (node hierarchy for tilt/yaw/zoom) and resize.
  - `rtsOrbit.ts`: RTS-style orbit/pan controller (input handling inside class). Camera stays at a fixed world Y; scroll zoom adjusts horizontal radius (not altitude); WASD pans along XZ without height sensitivity; left-drag yaws and adjusts pitch within a narrow clamp; rotation does not snap pivot to cursor (no initial jump).
  - `loop.ts`: frame loop with callback list; provides `dt` to subsystems.
  - `input.ts`: lightweight keyboard/pointer state tracker shared by `main.ts`, the vehicle testbed, and the particle test page (normalizes keys to lowercase and exposes a `Set`).
  - `random.ts`: shared deterministic 32-bit linear-congruential generator used by actor scattering; preserves the established per-seed sequences.
- Terrain: `src/terrain/`
  - `heightmap.ts`: procedural map generator + bilinear `sample(wx,wz)` API.
  - `coordinates.ts`: nearest-cell world-to-grid conversion with map-bound clamping, shared by interaction and actor-placement call sites.
  - `mesh.ts`, `material.ts`: low-poly tri mesh + flat-shaded material with grid overlay support.
  - `biomes.ts`: biome masks (rock/forest/chaparral) + vertex tinting.
  - `chunks.ts`: chunked LOD terrain with visibility toggle and base/hi geometry; per-chunk edge skirts to hide LOD cracks; bounding spheres for distance tests.
- Fire System: `src/fire/`
  - `grid.ts`: grid state (tiles, indices), ignition helpers, suppression hooks, containment heuristic.
  - `params.ts`: tuning constants and fuel tables.
  - `sim.ts`: fixed-step fire simulation with accumulator; slope/wind ROS; ignition/wetness/retardant; smoldering.
  - `viz.ts`, `overlay.ts`, `perimeter.ts`: visualization (overlay quads, vertex tint; thin perimeter outline). Also exports `computePerimeter(grid)` for analytics/UI.
  - `stats.ts`: compute active counts, burned tiles/area, and perimeter length (`computeFireStats`).
- Events: `src/events/events.ts`: seeded random-event system (lightning ignitions via exponential inter-arrival, wind shifts eased into the live sim env). Disabled by default; opted in via the menubar fire-section checkbox or `__wildfireTestApi.setRandomEvents(on, seed)`. Deterministic per seed — covered by the `random-events` audit scenario.
- Buildings: `src/buildings/buildings.ts`: seeded procedural structures — houses/barns clustered 2–6 tiles off road tiles, cabins ≥12 tiles from any road preferring forest fuel. One tile each; latching state machine intact → burning (tile hot) → destroyed (tile burned through), with recovery to intact if suppressed in time. `computeStructureScore` = +10 per standing structure, −25 per loss; surfaced in `getScenarioResult().structures/score`. `visual.ts` renders instanced walls+roofs with per-state tinting (burning orange, destroyed charred stubs). Covered by the `buildings-protection` audit scenario.
- Roads: `src/roads/`
  - `cost.ts`: per-tile elevation/slope/valley fields for road A* cost.
  - `astar.ts`: grid A* (4/8-neigh), cost callback, with diag support.
  - `planner.ts`: shared player/testbed road planner combining terrain cost, slope blocking, grade penalty, curvature penalty, 4-neighbor A*, and angular path reduction.
  - `visual.ts`: one depth-tested smoothed asphalt ribbon (adaptive Catmull–Rom), normal-offset to hug terrain, dusty shoulders, dashed center stripe, and stable physical-intersection metadata. Duplicate segment hits merge by position, self-crossings retain both path arc occurrences under one intersection ID, and simple endpoint joins are excluded. Triangle lattice/midline diagnostics are hidden by default and exposed only through debug controls.
  - `procedural.ts`: procedural loop generator (oval/figure-8/rectangle) for boot/regenerate seeding.
  - `state.ts`: rasterization of road paths to a road mask; integration hooks (e.g., fire grid fuel adjustments).
- Vehicles: `src/vehicles/vehicles.ts`: instanced agents with road and air pathing, terrain-aligned pose, and fire-suppression hooks.
  - `src/vehicles/types.ts`: shared vehicle enums + FX state types.
  - `src/vehicles/vehicleFx.ts`: particle/light FX helpers for vehicles and external emitters.
  - `src/vehicles/followerOrders.ts`: selection + order utilities for Frenet followers (including off-road bulldozer orders).
  - `src/vehicles/intersectionManager.ts`: authoritative all-way-stop controller for visible Frenet followers; batch approach/queue/grant arbitration, full-stop timing, exclusive occupancy, closed-loop-safe clearance, spillback probe, and telemetry.
  - `src/vehicles/trafficSpacing.ts`: assigns same-path leaders including the virtual closed-loop seam leader.
  - `src/vehicles/menubarMapping.ts`: UI type mapping for spawn commands.
- **Fire Hydrants (HIGH PRIORITY)**: `src/fire/hydrants.ts`: automatic placement along roads (50m spacing, 100+ tiles min), coverage areas (~10m), integration with suppression system to enable firefighter deployment from road tiles within coverage.
- UI/Debug: `src/ui/debug.ts`: floating stats with memory usage; toggles for fire viz, roads, vehicles (spawn/move/clear). `src/ui/menubar.ts` owns the primary toolbar and detailed debug controls, including road lattice diagnostics and optional hydrant coverage rings. `src/ui/console.ts`: command console for introspection and debugging. `src/config/features.ts`: feature flag system for debug tools.
- Browser automation: `src/main.ts` exposes `window.render_game_to_text()`, `window.advanceTime(ms)`, and `window.__wildfireTestApi` so Playwright/browser audits can inspect live game state, fast-forward the loop, and exercise fire/road/vehicle flows deterministically without brittle pixel-only input. `advanceTime` keeps 50 ms simulation chunks but suppresses intermediate renders so software-WebGL audit runs stay bounded.
- Repo automation: `scripts/qa/playwright_audit.ts` powers `npm run audit:game`, which launches the local Vite app and verifies the current MVP loop (bootstrap, roads, vehicles, suppression, auto-dispatch, manual dispatch) against the live browser build.
- Specs: `specs/` contains domain specs (terrain, fire_behavior, vehicles, architecture).
- Root docs: `AGENTS.md` (guidelines, commit hygiene).

Runtime Model

- Init sequence in `main.ts`:
  1) Initialize feature flags and configuration system.
  2) Create scene/renderer/camera rig and heightmap.
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
- Terrain chunks: Mesh nodes grouped; each chunk stores `baseColors` for quick vertex recolor.
- Fire
  - FireGrid: `{ width,height,params,tiles[], burning[], smoldering[], bCount,sCount,time,seed }`.
  - Tile: AoS object including `state,heat,progress,wetness,retardant,lineStrength,fuel,slopeTan,downX,downZ` (fuelMoisture early adoption planned).
  - FireSim: neighbor ignition via ROS and Poisson arrival; spotting (simple); combustion progressions; early extinguish; moisture decay.
  - FireViz: overlay instances and vertex tint; perimeter overlay hugging terrain; analytics via `computePerimeter` + `computeFireStats`.
- Roads
  - CostField/planner: elevation/slope/valley; slope-block threshold; grade and curvature penalties live in `src/roads/planner.ts` so the main game and vehicle testbed share identical player-road planning.
  - Visual: Catmull–Rom smoothed midlines resampled to uniform spacing (~2 tile asphalt width) with a 3-column cross-section; one normal-offset, depth-tested, double-sided asphalt mesh so terrain and vehicles occlude it correctly; dusty shoulders blended back into terrain; dashed center stripe polygon-offset above the surface. The production group must not stack a second filled baseline ribbon because the separation reads as variable road thickness on hills. Optional diagnostic wireframe and midline render under a hidden-by-default debug group.
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

- Prefer InstancedMesh for repeated quads (fire overlays) and agents.
- Avoid per-frame allocations where possible; reuse Vectors/Matrix4 in hot loops.
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
- `npm run audit:game` is the current end-to-end browser verification entry point and should be rerun after changes that touch movement, UI actions, dispatch, or fire suppression flows.
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
