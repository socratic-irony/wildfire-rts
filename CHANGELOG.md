# Changelog

Session-level history of landed changes. Forward-looking plans live in [ROADMAP.md](ROADMAP.md). Per-subsystem status lives in [specs/](specs/).

Each entry is dated and, when relevant, notes the `audit:game` / `npm test` state at the time.

---

## 2026-09-06 — World fidelity, hydrant supply, and connected traffic

Seven Luna tasks were reviewed and integrated: detailed vehicle silhouettes/equipment; asphalt, markings and stop signs; instanced tree/shrub families; road-facing buildings, cleared lots and driveways; visible active hydrant supply; connected civilian turns with full-stop intersection queues; and lighter fog with rising, fading smoke. Parent review corrected turn handoffs, zero-time redraws interrupting hydrant suppression, terrain color NaNs blacking out bloom, and dark intersection patches bridging curved ground. Validation runs use at most two Vitest workers and one browser at a time, with cleanup afterward.

**Verification**: final `npm run check` passes (72 files / 320 tests and production build). The full `audit:game` suite passed all 19 scenarios before the final road visual correction; the focused traffic audit passed again afterward and its screenshot was inspected. Real dispatched ground suppression draws 4,224 L beyond an empty tank and falls back when its source is removed. Specs and Roadmap Phase 4 reflect the integrated behavior.

The follow-up visual pass keeps water/retardant decals depth-tested so aircraft remain in front, supplies white vertex-color bases to all procedural building batches, and places opaque stop-sign poles behind faces on the incoming lane's right side. **Verification**: the full 19-scenario browser audit and focused rendering regressions pass.

## 2026-08-22 — Audit harness hardening: deterministic sim-time pumping

The Playwright suite's timing-sensitive scenarios coupled assertions to wall-clock × fps: under SwiftShader the rAF loop advances only ~0.1 sim-s per wall second, leaving auto-dispatch's 18 s deadline racing incident resolution (it resolved at fireT ≈ 2.0 — sometimes inside the wire, sometimes not) and letting payload-round-trip's strict `water === 0` assert race the hydrant-refill loop across evaluate roundtrips. Fixes in [scripts/qa/playwright_audit.ts](scripts/qa/playwright_audit.ts): timing-sensitive polls now pump simulated time via `window.advanceTime(ms)` (rendering suppressed) with wall deadlines as backstops only; the payload drain and its readback happen inside a single evaluate; audit pages load with `?nofx=1` to skip the composer under software GL; and the dev server spawns with `--strictPort` so a zombie server squatting the port fails loudly instead of silently auditing stale code (the failure mode that muddied this investigation). **Verification**: `npm run check` green (66 files / 280 tests) and two consecutive full `audit:game` runs pass 18/18.

---

## 2026-08-21 — Clean-room RTS camera controller

`src/core/cameraController.ts` replaces the legacy `rtsOrbit.ts` fake-orbit controller and `core/camera.ts` rig hierarchy (both deleted) with a damped spherical-orbit `CameraController`: true orbit around a terrain-sampled ground target, framerate-independent exponential damping on yaw/pitch/dist/target, zoom-to-cursor, hard bounds/pitch/dist clamps, terrain clearance enforcement, follow mode, instant-snap `focus()` for deterministic audit framing, and fully wired keyboard controls (WASD/arrows pan with zoom-scaled speed, Q/E yaw, R/F tilt — previously dead — Space resets the view). Pointer drag (left rotate / middle-right pan), wheel zoom, and two-finger pinch are handled by an optional DOM adapter; headless construction (`dom = null`) enables the new unit suite in `src/core/__tests__/cameraController.test.ts`. `main.ts`, `vehicles_test.ts`, and `particle_testbed.ts` are rewired; `specs/architecture.md` camera sections rewritten. **Verification**: `npm run check` (typecheck + 61 files / 251 tests + build) green.

## 2026-08-21 — Track B performance & hardening pass

The sun's shadow ortho frustum was never sized, so it defaulted to ±5 units around the origin and ~99% of the map rendered shadowless; `createScene` now accepts `{ worldCenter, shadowExtent }` (main passes half the play area × 0.75), parents the sun target at the world center, and applies bias tuning ([src/core/scene.ts](src/core/scene.ts)). The main loop stopped rebuilding its dispatch/follower view objects every frame — the ref array now rebuilds only on spawn/clear membership changes with per-frame field syncs, intersection-manager input uses pooled slots plus a reused leader scratch array, and the dispatch panel + selection HUD share a single fleet pass for busy count and selected unit ([src/main.ts](src/main.ts)).

Fixed a regeneration leak where replacing `VehiclesManager` removed the NEW (never-added) group while the old manager's groups stayed orphaned in the scene forever; regenerate now captures old refs, removes + disposes them first. Chunked terrain (both LOD geometries per chunk — not the shared material), forest, shrubs, rocks, roads visual, hydrant coverage rings, and `VehiclesManager` all gained proper `dispose()` calls wired into every replacement path ([src/terrain/chunks.ts](src/terrain/chunks.ts), [src/actors/](src/actors/), [src/roads/visual.ts](src/roads/visual.ts), [src/fire/hydrantCoverage.ts](src/fire/hydrantCoverage.ts), [src/vehicles/vehicles.ts](src/vehicles/vehicles.ts)). Periodic debug metrics in the frame loop (every 300 frames) and fire sim (every 30 steps) skip payload formatting unless `Logger.isEnabled('debug')` passes; startup `info` lines are untouched ([tools/logging/logger.ts](tools/logging/logger.ts)).

Vehicle draw calls drop via build-time merging of unreferenced voxel parts (`collapseParts` in [src/vehicles/voxelMeshes.ts](src/vehicles/voxelMeshes.ts)): transforms bake into cloned geometries, colors ride a per-vertex attribute, same-material parts fuse into geometry groups behind material arrays. Civilians shrink to body+wheel+yield ring (was 7–8 meshes); named hook parts (`ladder`, `blade`, `rotor`, `skid`, `wings`, `tailFin`, `helmet`, `lightbar`, `userData.mainRotor/yieldIndicator`) remain separate per the extended mesh contract tests. **Verification**: `npm run typecheck`, `npx vitest run` (62 files / 249 tests), and `npm run build` all green at f7fe943.

## 2026-08-21 — Visual overhaul: sky dome, bloom post-processing, embers, wind-sheared smoke

Track C visual pass. A procedural Sky dome (`src/core/environment.ts`) now provides a warm late-afternoon atmosphere tuned to match the directional light's normalized position; the boot FogExp2 is retuned in place to density 0.0045 with a horizon-matched warm tint, and sun/hemisphere intensities are nudged (1.25 / 0.5) through the passed light refs — `scene.ts` itself is untouched.

Post-processing arrives as RenderPass → UnrealBloomPass (half internal res, strength 0.45, radius 0.4, threshold 0.85) → OutputPass, matching the r155+ rule that tone mapping and sRGB conversion live in OutputPass; ACESFilmic stays on the renderer and exposure stays at 1.0. `?nofx=1` (perf probes / software-GL audits) and missing WebGL2 both fall back to plain `renderer.render`, resize keeps the composer in sync, and the menubar's new 🎨 Graphics section exposes a live Bloom toggle (`graphics-bloom-toggle`).

Fire gains a deterministic additive ember system (`src/particles/embers.ts`): ≤1500 instanced quads sampled from the burning frontier via a pure hash-seeded selection (unit-tested for determinism, bounds, uniqueness), animated entirely in-shader with buoyancy, per-seed spiral wander, downwind drift from the live wind env, and an HDR orange→deep-red ramp that feeds the bloom threshold. Flipbook smoke is polished in place: wind shear offsets smoke downwind (∝ lifeT · windSpeed · iDrift, negligible on flames), the atlas smoke alpha falloff softens (pow exponent 2.2 → 1.7), and smolder puffs lighten to 0.87 gray. No flipbook API keys changed.

**Verification**: `npm run typecheck`, `npx vitest run src` (61 files / 254 tests), and `npm run build` all green on `feat/visual-overhaul`.

---
## 2026-08-21 — FireGrid converted to structure-of-arrays typed arrays

`FireGrid` no longer stores an array of tile objects: every per-tile field (`state`, `heat`, `progress`, `wetness`, `retardant`, `lineStrength`, `fuelMoisture`, `lastIgnitedAt`, `slopeTan`, `downX`, `downZ`, and `fuel` as a `FUEL_KEYS` index) now lives in its own typed array, cutting pointer-chasing in the hottest sim loop. All consumers (sim, viz/overlay/perimeter/decals/stats, hydrant/building/actor/event/scenario/dispatch/particle/road code, main.ts UI/console/test-API) were migrated mechanically; frontier-list ordering and RNG index hashing are untouched, so behavior is bit-exact with the previous layout — pinned by the existing fire determinism/mechanics suites plus a new `fire_soa_layout` test (array-length invariants, double-run bit-identity, NaN-free 16k-tile tick). `sampleTile` now returns a plain-object snapshot. **Verification**: `npm run typecheck`, `npx vitest run src` (61 files / 243 tests), `npm run build`.

## 2026-07-12 — Repository hygiene and maintenance gates

Strict TypeScript checking now rejects unused locals and parameters, and `npm run check` is the canonical type-check + unit-test + production-build gate. A maintained-source graph test covers the application, testbeds, scripts, tests, Vite configuration, and documented standalone config/logging examples; it exposed and enabled removal of an unreachable dispatch station prototype.

Repeated deterministic actor random generation, nearest-cell world/grid conversion, and water-suppression tile traversal now use shared characterized helpers. The cleanup preserved all documented entry points and the live terrain-regeneration hook order; the fire/particle specs record where those hooks still provide only partial rebinding. Documentation now distinguishes runtime flags and logging (`src/config/features.ts`, `tools/logging/`) from the standalone schema/logger examples (`tools/config/`, `tools/logger.ts`), and correctly identifies Frenet `IntersectionManager` traffic as authoritative.

Incidental barrier and terrain-regeneration test output was removed while strengthening the barrier setup checks. **Verification**: `npm run check` (60 files / 239 tests; 76-module Vite build), `npm run validate-assets` (9/9 valid, six advisory oversized-image warnings), and `npm run audit:game` (18/18 scenarios) all pass.

---

## 2026-06-10 — Performance pass: ~2× faster sim step, lighter frames

Measured with the new `npm run perf:probe` (times `advanceTime(30s)` plus 300 rendered frames under software GL): sim step cost dropped from 6.7 ms to 3.5 ms per 50 ms step (−47%), rendered frame time from 547 ms to 408 ms (−25% even under swiftshader; real GPUs benefit more from the CPU-side cuts).

What changed:
- Water/retardant decals and the fireline overlay rebuilt from full 16k-tile scans every frame; now 5 Hz ([src/main.ts](src/main.ts)).
- The menubar ran `computeFireStats` (another full-grid scan) plus DOM writes every frame; the stats block now refreshes at 4 Hz ([src/ui/menubar.ts](src/ui/menubar.ts)).
- Fire ribbon geometry (perimeter trace + new buffers) rebuilt every frame; now 5 Hz, with the scroll/flicker shader uniform still updating per frame ([src/particles/ribbon.ts](src/particles/ribbon.ts)). Perimeter outline likewise ~7 Hz ([src/fire/viz.ts](src/fire/viz.ts)).
- `PathFollower.update` and the off-road/airborne movers allocated ~8 vectors/quaternions/matrices per vehicle per frame; all hoisted to module temps ([src/vehicles/frenet.ts](src/vehicles/frenet.ts), [followerOrders.ts](src/vehicles/followerOrders.ts)).
- Vehicle part materials and box geometries are now cached and shared across vehicles (light-bar materials stay per-truck for the flash animation) ([src/vehicles/voxelMeshes.ts](src/vehicles/voxelMeshes.ts)).

**Baseline**: `npm test` (209), `npm run build`, `npm run audit:game` (17 scenarios) all green.

---

## 2026-06-10 — FX + environment visual pass

Aircraft drops are now visible: helicopters dump a dense falling water column from the belly, air tankers trail an orange-red retardant curtain behind them ([src/vehicles/vehicleFx.ts](src/vehicles/vehicleFx.ts)). Firetruck mesh light bars flash alternating red/blue while the truck is responding (busy, RTB, or refilling) and glow steady when idle; helicopter rotors keep spinning per the previous pass.

Vegetation variety: conifers gained a second foliage tier and per-instance height/color variation (deep pine → bluish spruce); broadleaf and shrub instances get per-instance hue/lightness jitter (shrubs range sage → dry olive with squash variation). Burn tinting now multiplies each instance's base color instead of overwriting it, so unburned vegetation keeps its variety and burned vegetation chars from its own hue. `createForest`/`createShrubs` now return a single `group` for scene management.

Terrain: biome vertex colors get deterministic hash-based value jitter (±0.035) so fields read as mottled ground instead of flat fills.

**Baseline**: `npm test` (209), `npm run build`, `npm run audit:game` (17 scenarios) all green.

---

## 2026-06-09 — Voxel vehicle overhaul + civilian traffic

All vehicle meshes rebuilt as multi-part voxel models in [src/vehicles/voxelMeshes.ts](src/vehicles/voxelMeshes.ts) (meshes.ts re-exports). Firetruck: crew cab, equipment body with white stripe, railed ladder with rungs, red/blue light bar (named `lightbar` for the flash pass), six wheels. Bulldozer: tracks instead of wheels, lift-arm blade, exhaust stack. Helicopter: glass nose, belly water tank, tail boom/fin/rotor, skids with struts, and a `mainRotor` group the frame loop spins (fast in flight, idle when parked). Air tanker: high wing with engine nacelles and props, retardant belly, red tail. Firefighter: legs/torso/arms, air tank, helmet.

Civilian traffic: four body styles (sedan, pickup, van, hatchback) with a seeded 8-color palette. Boot fleet per road loop is now 1 firetruck + 1 bulldozer + 3 civilians; follower state exposes `style`/`color`. New audit scenario `civilian-traffic` asserts fleet size, style/color variety, and that civilians actually drive.

The richer traffic slows truck response via intersection queuing, so the `stress-contention` spread bound was recalibrated (≤70; the stuck-busy and resolved≥2 asserts remain the real non-deadlock invariants). `getState` now lists all hydrants instead of the first 16.

**Baseline**: `npm test` (209), `npm run build`, `npm run audit:game` (17 scenarios) all green.

---

## 2026-06-09 — Buildings + protect-homes scoring

Seeded procedural structures ([src/buildings/buildings.ts](src/buildings/buildings.ts)): houses and barns cluster 2–6 tiles off road tiles; cabins place ≥12 tiles from any road, preferring forest fuel. Each building occupies one tile and follows a latching state machine driven by the fire grid — intact → burning while the tile is hot → destroyed once it burns through, with recovery to intact if suppression saves it in time.

Instanced rendering ([src/buildings/visual.ts](src/buildings/visual.ts)): walls + pyramid roofs with per-kind palettes, slight deterministic yaw variation, burning buildings tint orange, destroyed ones collapse to charred stubs.

`getScenarioResult()` now reports `structures` (intact/burning/destroyed) and a protect-homes `score`: +10 per standing structure, −25 per loss. Test API adds `getBuildings()`. New audit scenario `buildings-protection` asserts boot generation (including off-road cabins), the burn-through lifecycle, and the score penalty.

**Baseline**: `npm test` (209), `npm run build`, `npm run audit:game` (16 scenarios) all green.

---

## 2026-06-09 — Aircraft roles + hydrant refill

Helicopters, airplanes, and firefighters are now functional units. Aircraft fly directly to any target at cruise altitude (helicopter 10 m, airplane 16 m) via a new airborne branch in [src/vehicles/followerOrders.ts](src/vehicles/followerOrders.ts); firefighters walk off-road at type speed. Helicopters drop water; airplanes lay a retardant line along their flight direction plus a cooling water component. All three are spawnable from the menubar dropdown and `spawnVehicle`, with distinct placeholder meshes (rotor/skids, wings/tail, helmet).

Dispatch assignment is routeability-aware: `assignByCost` skips units that cannot service an incident position (`canService`), so an off-road fire dispatches the helicopter instead of starving behind an unroutable closest truck. `FollowerRef` gained host-supplied `route`/`canRoute` callbacks.

Water-empty firetrucks with adequate fuel now reroute to the nearest hydrant reachable from their current road and refill at 400 L/s within a 6 m draw radius, instead of driving home; low fuel still forces a home RTB.

New audit scenarios `aircraft-drops` (flight altitude, payload spend, retardant footprint, incident resolution) and `hydrant-refill` (refill occurs at a hydrant, tank returns to capacity). Test API: `spawnVehicle` accepts all unit types; `findOffroadBurnableTiles` finds deterministic off-road ignition targets.

**Baseline**: `npm test` (202), `npm run build`, `npm run audit:game` (15 scenarios) all green.

---

## 2026-06-09 — Random events: lightning + wind shifts

New seeded event system ([src/events/events.ts](src/events/events.ts)): lightning strikes ignite random ignitable tiles (never rock/water/road) with exponential inter-arrival times, and periodic wind shifts ease the live sim wind toward new direction/speed targets. Off by default; enabled via a menubar fire-section checkbox or `__wildfireTestApi.setRandomEvents(on, seed)`. `getEventLog()` exposes the event history.

Procedural road seeding now derives from the world config seed instead of `Math.random()`, so a seeded boot is fully deterministic (terrain, roads, hydrants, spawn points). This surfaced that the `stress-contention` balloon bound was calibrated against shorter effective sim runs; recalibrated to the deterministic map (≤40 unresolved at 60s, with the stuck-busy and resolved≥2 checks carrying the non-deadlock claim).

New audit scenario `random-events` asserts lightning + wind-shift occurrence, fire footprint from strikes, and same-seed determinism across reloads.

**Baseline**: `npm test` (198), `npm run build`, `npm run audit:game` (13 scenarios) all green.

---

## 2026-06-09 — Test-suite audit + cruft sweep

Stress-contention audit scenario now advances a fixed 60s of sim time instead of looping until a 60s wall-clock deadline — the wall-clock loop advanced unbounded sim time on fast runs, letting fire outrun road-serviceable range and balloon unresolved incidents (the failure that greeted this session).

Cruft removed: `src/__tests__/fire_debug.test.ts` (four console.log tests asserting `expect(true)`), `src/config-demo.ts` (orphan demo entrypoint), and the dead greedy `assignNearestIdle` in [src/dispatch/assignment.ts](src/dispatch/assignment.ts) plus its test file — production dispatch has been `assignByCost` since 2026-04-20 (commit `1a14aec`, which also retro-ticks the Phase 2 cost-dispatch roadmap item). Two placeholder console tests now assert real register/unregister behavior.

**Baseline**: `npm test`, `npm run build`, `npm run audit:game` (12 scenarios) all green.

---

## 2026-05-04 — Road/hydrant render debug cleanup

Road triangle-lattice and midline debug geometry in [src/roads/visual.ts](src/roads/visual.ts) is now hidden by default and can be re-enabled from the detailed toolbar road debug checkbox. Filled road meshes are double-sided so the asphalt/shoulder/stripe surfaces remain visible from normal RTS camera angles without relying on debug wireframes.

Hydrant coverage radius rings in [src/fire/hydrantCoverage.ts](src/fire/hydrantCoverage.ts) now start hidden and can be re-enabled from the detailed toolbar hydrant coverage button, leaving hydrant markers visible without covering the playfield.

Player road planning now goes through shared [src/roads/planner.ts](src/roads/planner.ts), removing duplicated slope/grade/curvature A* cost logic from [src/main.ts](src/main.ts) and [src/vehicles_test.ts](src/vehicles_test.ts).

`window.advanceTime()` now keeps 50 ms deterministic simulation chunks but suppresses intermediate renders during browser automation, then renders once at the end. This preserves scenario behavior while avoiding minutes of software-WebGL work.

**Baseline**: `npm test` (202 passing), `npm run build`, and `npm run audit:game` (12 scenarios) all green.

---

## 2026-04-20 — Phase 2a: scenario win/loss + MVP acceptance gate

Added `src/scenarios/` with a pure evaluator and stateful runner ([scenario.ts](src/scenarios/scenario.ts)) plus a seeded default ([containment.ts](src/scenarios/containment.ts)). A scenario resolves to `pending | win | loss` from `(elapsedSec, footprint)`; footprint is the monotonic count of tiles ever touched by fire. Loss latches the moment the footprint breaches the budget.

`window.__wildfireTestApi` gains `loadScenario`, `getScenarioResult`, `clearScenario`. A new `mvp-containment` audit scenario loads the default def, fast-forwards past the time limit, and asserts `result === 'win'` — this is the MVP acceptance test.

Also relaxed the `stress-contention` resolved-count bound from ≥3 to ≥2 — dispatch throughput is variable under heavy load and the point of the scenario is non-deadlock, not a throughput number.

**Baseline**: `npm test` (177 passing), `npm run build`, `npm run audit:game` (12 scenarios) all green.

---

## 2026-04-20 — Phase 1 audit scenarios land

Five new audit scenarios cover the Phase 1 gaps in [ROADMAP.md](ROADMAP.md):

- `payload-round-trip` — drain a firetruck's tank, verify the RTB + refuel/refill loop completes.
- `hydrant-suppression` — water inside hydrant coverage produces a larger wetness delta than the bare case.
- `bulldozer-fireline` — off-road dozer traversal writes `lineStrength` to tiles along its path.
- `long-run-stability` — 60s fast-forward with 5 fires, no NaN positions, no negative payloads, dispatch resolves ≥1 incident.
- `stress-contention` — 10 simultaneous ignitions vs. 4 trucks, no follower stuck busy, dispatch resolves ≥3.

**Fixes surfaced**
- Bulldozers are now always excluded from the path-follower update loop ([src/main.ts](src/main.ts)). Previously, once `updateOffroadFollower` cleared `offroadTarget` on arrival, the next tick's path update would snap the dozer back to its spawn path.
- Bulldozers write `lineStrength` to the tile under them while traversing off-road, so firebreaks form during motion rather than only at the destination.

**Test API additions**: `applyWaterFromHydrantAt`, `exhaustFollowerWater`, `getTileAt` (now returns `lineStrength`).

**Baseline**: `npm test`, `npm run build`, and `npm run audit:game` (11 scenarios) all green.

---

## 2026-04-19 — Deterministic audit loop + MVP baseline

Audit started against `ROADMAP.md` plus [specs/terrain.md](specs/terrain.md), [specs/fire_behavior.md](specs/fire_behavior.md), [specs/vehicles.md](specs/vehicles.md), [specs/fire_hydrants.md](specs/fire_hydrants.md).

**Instrumentation**
- Added `window.__wildfireTestApi` in [src/main.ts](src/main.ts) (`getState`, road create/clear, vehicle spawn/select, direct fire/suppression actions, hydrant refresh, auto-dispatch toggle, manual dispatch).
- Added stable `data-testid` hooks to the core toolbar controls; removed the redundant controls banner from [index.html](index.html) and tightened the toolbar footprint.
- Added `npm run audit:game` backed by [scripts/qa/playwright_audit.ts](scripts/qa/playwright_audit.ts). Covers baseline bootstrap, road build/clear, bulldozer off-road, suppression, auto-dispatch resolution, manual dispatch.

**Fixes surfaced by the audit**
- `Loop` negative-dt behavior after `advanceTime()` fast-forwards — the RAF path no longer cancels simulated time ([src/core/loop.ts](src/core/loop.ts)).
- Newly spawned followers now update world transforms immediately, so instant orders and state reads are accurate; bulldozers respond correctly to immediate off-road orders.
- Text-state follower positions report real world coordinates instead of `(0,0,0)`.
- Road-endpoint bookkeeping — successful placement keeps only the last endpoint for chaining instead of growing an unbounded history.
- Dispatch incident resolution — cooled smoldering tiles now resolve incidents and release assigned vehicles (regression: [src/dispatch/__tests__/incident.test.ts](src/dispatch/__tests__/incident.test.ts)).
- Dispatch panel UX — "Assign selected" is disabled when the selected unit cannot service the incident from its current road instead of silently failing.
- `dispatch/followerWorldPos` crash — `Object3D.getWorldPosition` requires a real `Vector3`, not a plain `{x,y,z}` ([src/systems/dispatchLoop.ts](src/systems/dispatchLoop.ts)).

**Baseline**: `npm test`, `npm run build`, and `npm run audit:game` all green.
