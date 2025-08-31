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
- Testbed: `vehicles-test.html` + `src/vehicles_test.ts` — a minimal, isolated page for vehicle/road experiments on a small flat map with preset road layouts (loop / figure‑8). Does not affect the main app.
- Core: `src/core/`
  - `renderer.ts`: WebGL renderer factory and resize logic.
  - `scene.ts`: Three.js scene creation; minimal global lights.
  - `camera.ts`: camera rig (node hierarchy for tilt/yaw/zoom) and resize.
  - `rtsOrbit.ts`: RTS-style orbit/pan controller (input handling inside class). Camera stays at a fixed world Y; scroll zoom adjusts horizontal radius (not altitude); WASD pans along XZ without height sensitivity; left-drag yaws and adjusts pitch within a narrow clamp; rotation does not snap pivot to cursor (no initial jump).
  - `loop.ts`: frame loop with callback list; provides `dt` to subsystems.
- Terrain: `src/terrain/`
  - `heightmap.ts`: procedural map generator + bilinear `sample(wx,wz)` API.
  - `mesh.ts`, `material.ts`: low-poly tri mesh + flat-shaded material with grid overlay support.
  - `biomes.ts`: biome masks (rock/forest/chaparral) + vertex tinting.
  - `chunks.ts`: chunked LOD terrain with visibility toggle and base/hi geometry; per-chunk edge skirts to hide LOD cracks; bounding spheres for distance tests.
- Fire System: `src/fire/`
  - `grid.ts`: grid state (tiles, indices), ignition helpers, suppression hooks, containment heuristic.
  - `params.ts`: tuning constants and fuel tables.
  - `sim.ts`: fixed-step fire simulation with accumulator; slope/wind ROS; ignition/wetness/retardant; smoldering.
  - `viz.ts`, `overlay.ts`, `perimeter.ts`: visualization (overlay quads, vertex tint; thin perimeter outline). Also exports `computePerimeter(grid)` for analytics/UI.
  - `stats.ts`: compute active counts, burned tiles/area, and perimeter length (`computeFireStats`).
- Roads: `src/roads/`
  - `cost.ts`: per-tile elevation/slope/valley fields for road A* cost.
  - `astar.ts`: grid A* (4/8-neigh), cost callback, with diag support.
  - `visual.ts`: smoothed ribbon mesh (adaptive Catmull–Rom), normal-offset to hug terrain, dusty shoulders, dashed center stripe.
  - `state.ts`: rasterization of road paths to a road mask; integration hooks (e.g., fire grid fuel adjustments).
- Vehicles: `src/vehicles/vehicles.ts`: instanced agents, road-only pathing, terrain-aligned pose. Simple and stable baseline.
- UI/Debug: `src/ui/debug.ts`: floating stats; toggles for fire viz, roads, vehicles (spawn/move/clear).
- Specs: `specs/` contains domain specs (terrain, fire_behavior, vehicles, architecture).
- Root docs: `AGENTS.md` (guidelines, commit hygiene).

Runtime Model

- Init sequence in `main.ts`:
  1) Create scene/renderer/camera rig and heightmap.
  2) Build chunked terrain, material, and apply biome colors.
  3) Instantiate fire grid/sim/viz and attach viz nodes to scene.
  4) Build road cost field, visualization group, and road mask.
  5) Create vehicles manager and add to scene.
  6) Install debug UI and input handlers for ignite, road draw, and vehicle modes.
  - Branch `features/vehicles`: after wiring, seed a rectangular road loop on a small (32×32) mostly-flat test map and auto-spawn a few vehicles on the loop for immediate interaction.
- Frame loop (`Loop`):
  - Per-frame: update camera controller; LOD updates; `FireSim.step(dt)` with fixed sub-steps; `fireViz.update(grid, dt)`; `vehicles.update(dt)`; render; stats.
  - Fixed fire dt: 0.25 s with 6-step cap per frame.

Key Abstractions & Data

- Heightmap: `{ width,height,scale,data[], sample(wx,wz) }` — source of truth for elevation.
- Terrain chunks: Mesh nodes grouped; each chunk stores `baseColors` for quick vertex recolor.
- Fire
  - FireGrid: `{ width,height,params,tiles[], burning[], smoldering[], bCount,sCount,time,seed }`.
  - Tile: AoS object including `state,heat,progress,wetness,retardant,lineStrength,fuel,slopeTan,downX,downZ` (fuelMoisture early adoption planned).
  - FireSim: neighbor ignition via ROS and Poisson arrival; spotting (simple); combustion progressions; early extinguish; moisture decay.
  - FireViz: overlay instances and vertex tint; perimeter overlay hugging terrain; analytics via `computePerimeter` + `computeFireStats`.
- Roads
  - CostField: elevation/slope/valley; slope-block threshold; turn penalty in `main.ts` when planning player roads.
  - Visual: adaptive midline resampling; 3-lane (L/M/R) cross-section; normal-offset; shoulders; dashed stripe.
  - Mask: `Uint8Array` marking road tiles; consumed by vehicles pathing and fire integration.
- Vehicles
  - Agent: `{ pos, grid, path[], pathIdx, speedTilesPerSec, autoFollowRoad, prev? }`.
  - Movement: interpolate along grid path; altitude from heightmap; orientation from terrain normal + path direction.
  - Pathing: A* restricted to road tiles; auto-follow advances along connected road neighbors.

Event Flow & Input

- Click handling in `main.ts` branches by mode:
  - Roads On: raycast to terrain → grid cell → A* builds road path → visualize + rasterize mask.
  - Vehicles Move On: raycast → grid → set shared destination on road network.
  - Otherwise: ignite tile for fire demo if ignite mode is active.

Performance Principles

- Prefer InstancedMesh for repeated quads (fire overlays) and agents.
- Avoid per-frame allocations where possible; reuse Vectors/Matrix4 in hot loops.
- Restrict fixed-step sub-steps; clamp to avoid spiraling on stalls.
- Minimize per-frame scanning over large arrays (e.g., keep frontier lists for fire; in vehicles, use grid-path interpolation, not dense projections).
- For visuals that must hug terrain, sample normal + normal-offset and use polygon offset for z-ordering.

Error Handling & Determinism

- FireSim retains a seed for deterministic `rand01` hashing; call orders should be stable within a tick.
- Clamp and guard divisions with small epsilons (e.g., distances, dot products) to avoid NaNs.

Extensibility Hooks

- Fire suppression: `applyWaterAoE`, `applyRetardantLine`, `writeFirelineEdges`; tile fields (`wetness,retardant,lineStrength`).
- Fire queries: `isContained`, `sampleTile` (and planned perimeter polyline export).
- Vehicles: future “water/retardant” actions will call FireGrid APIs; laneing/speed modifiers are straightforward extensions to `update()`.
- Roads: attach metadata (class/type) and vary width/material; expose midline for more advanced AI.

Testing Strategy (planned)

- Unit tests around math-heavy pieces:
  - Heightmap sampling, normal estimation.
  - FireSim tick transitions and ignition probabilities (deterministic seeds).
  - A* path validity and slope/turn costs.
- Headless update tests to validate determinism (e.g., same perimeter length after N ticks).

Contribution & Spec Hygiene

- Before committing, update the relevant spec(s) in `specs/` (what works vs not yet; API changes). See AGENTS.md.
- Keep runtime and data shapes consistent with docs; if you diverge, document the deviation and why.

LLM Orientation Checklist

- Start: read `AGENTS.md`, then skim `specs/*.md` (terrain, fire_behavior, vehicles, architecture).
- Follow `src/main.ts` to see wiring order and active flags.
- When changing behavior:
  - Identify the tight-loop code paths (viz updates, sim ticks); measure allocations.
  - Prefer small, reversible edits; build after each change.
  - Update the corresponding spec file section.

Open Opportunities / Next Items

- Fire: edge-based line strength; crown behavior; UI paint tools; wire stats into UI.
- Roads: adaptive planning using curvature + slope fields; optional lane metadata; intersections routing.
- Vehicles: safe road midline projector with spatial index; yaw smoothing; spacing/collision; speed model by grade/curvature.
- Persistence: save/load scenarios (terrain seed, fire seed, roads, vehicles).
- Telemetry: per-subsystem timings in stats overlay; debug draws (normals, probability arrows).

Glossary

- world units: meters (1 tile = `heightmap.scale`).
- grid cell: integer tile coordinates used by fire/roads/vehicles.
- normal-offset: elevation along surface normal to layer visuals just above terrain.
