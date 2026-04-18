# Wildfire-RTS Roadmap

Living tracking document for major initiatives. Audit dated **2026-04-18**.

The README's roadmap section is the high-level public view; this file is the working checklist with file-level pointers, scope estimates, and per-initiative subtasks.

---

## Status legend

- `[ ]` not started
- `[~]` in progress
- `[x]` done
- `[-]` deferred / superseded

Scope: **S** ≤ half-day · **M** 1–3 days · **L** 1+ week

---

## Quick wins (sprint 1)

- [x] **Extract `src/vehicles/typeDefaults.ts`** (S) — landed 2026-04-18. Centralizes speed, color, material props, behavior flags, and placeholder fuel/water capacities. `vehicles.ts:getDefaultSpeed()` and `main.ts:createFollowerMesh()` now read from it.
- [-] **Remove deprecated grid-mode blocks** — investigated 2026-04-18: the DEPRECATED markers in `vehicles.ts` and `src/ui/debug.ts` document _secondary_ code paths still consumed by `src/vehicles_test.ts` (demo entry) and ability tests. Not safe to remove without first migrating those consumers.
- [x] **Fleet stats in menubar** (S) — landed 2026-04-18. New `src/vehicles/stats.ts:computeFleetStats()`; menubar shows total/moving/idle counts, type breakdown, mean speed, total water capacity. Wired via `opts.followers` in `main.ts:1012`.

## Top initiatives (ordered by leverage × readiness)

### 1. Incident Dispatch System (L) — *unlocks RTS core loop*

Without this the game has no strategy layer. Fire detected → incident created → nearest idle vehicle dispatched → busy/idle state tracked → resolution.

- [x] Scaffold `src/dispatch/incident.ts` — `Incident` type, registry, lifecycle (`detected → assigned → engaged → resolved`). Landed 2026-04-18.
- [x] Scaffold `src/dispatch/stations.ts` — station registry with `nearest()` lookup. Landed 2026-04-18.
- [x] Scaffold `src/dispatch/assignment.ts` — `assignNearestIdle()` greedy heuristic, suppression-type filter. Landed 2026-04-18.
- [x] Tests in `src/dispatch/__tests__/` — 9 tests, lifecycle + heuristic. Landed 2026-04-18.
- [ ] Wire fire-loop in `src/main.ts`: detect new burning tiles → spawn incidents (call `registry.detectFromFireGrid()` periodically, e.g. every 1s)
- [ ] Wire follower-loop: when assignment lands, push goal into `PathFollower` and mark unit busy until `Incident.status === 'resolved'`
- [ ] Add `src/ui/dispatchPanel.ts` — list incidents, available units, current assignments
- [ ] Auto-dispatch toggle + manual override in menubar
- [ ] Promote `Incident.status === 'engaged'` when assigned unit reaches the incident tile (distance check)
- [ ] Replace greedy heuristic with cost-based assignment (factor in unit type, water remaining, response distance)

### 2. Unify intersection control across both vehicle systems (M)

`src/vehicles/intersectionManager.ts` (just landed) only serves PathFollower. Share queue/token state with `VehiclesManager` grid agents so the two fleets co-exist without colliding.

- [ ] Extract queue/token state from `intersectionManager.ts` into shared module
- [ ] Wire grid agents in `vehicles.ts` to consult the same queue lookup
- [ ] Add spatial collision query usable by both systems
- [ ] Test: mixed PathFollower + grid agents at the same four-way stop

### 3. Vehicle payload + fuel model (M)

Makes choices matter. Vehicles must return to base when empty.

- [ ] Extend `Agent` in `vehicles.ts` with `fuel`, `waterLoad`, `fuelBurnRate`
- [ ] Update speed model for grade + load
- [ ] Deplete water in `applyWaterAoE`; stop spraying when empty
- [ ] "Return to base" autopilot when fuel/water below threshold
- [ ] HUD bars per vehicle (fuel + water)

### 4. Fire-aware pathing (L)

Vehicles route around active fires; re-plan when planned route becomes hot.

- [ ] Add fire-heat cost layer in `src/roads/cost.ts`
- [ ] Merge cost sources (terrain + fire + vehicle density) in `src/roads/astar.ts`
- [ ] Re-path trigger in PathFollower / VehiclesManager when path cost spikes
- [ ] Tunable: avoidance weight, re-path threshold

### 5. Road midline spatial index (M)

Fixes drift and yaw glitches. `src/roads/visual.ts` already exposes `getMidlinesXZ()` (~line 97).

- [ ] Build kd-tree or uniform-grid index over midline segments in `RoadsVisual`
- [ ] `project(pos) → { segIdx, t, tangent, normal }` query
- [ ] Use projected tangent for yaw smoothing in `frenet.ts`
- [ ] Bench: query latency vs current `findNearestPathIndex`

### 6. OSM road import (L) — *defer until core loop is done*

Highest complexity, lowest dependency. Don't ship realistic geography with nothing happening on it.

- [ ] `src/osm/loader.ts` — GeoJSON parsing
- [ ] `src/osm/projection.ts` — Web Mercator / UTM lat-lon → grid
- [ ] `src/osm/roadgraph.ts` — polylines → road grid with speed limits + types
- [ ] File picker / URL loader in menubar
- [ ] Sample data: one small town `.geojson` checked into `examples/`

---

## Suggested sequencing

- **Sprint 1**: quick wins + dispatch scaffolding (incident registry only)
- **Sprint 2**: finish dispatch + auto-assignment; fuel/payload model
- **Sprint 3**: unify intersections + midline projection
- **Sprint 4+**: fire-aware pathing, then OSM

---

## Cross-cutting cleanup (opportunistic)

- [ ] Decompose `src/main.ts` (1027 LOC) — extract `src/input/handlers.ts` and `src/systems/fireLoop.ts`
- [ ] Decompose `src/vehicles/vehicles.ts` (1010 LOC) once typeDefaults extraction lands
- [ ] Audit `src/ui/menubar.ts` (901 LOC) — split per-section
