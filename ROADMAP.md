# Wildfire-RTS Roadmap

Living tracking document for major initiatives. Audit dated **2026-04-18** (updated). Test count: **165 passing**.

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

- [x] Scaffold `src/dispatch/incident.ts` — `Incident` type, registry, lifecycle (`detected → assigned → engaged → resolved`). Added `reopen()` for unit-leaves-to-refill flow. Landed 2026-04-18; extended with `reopen` same sprint.
- [x] Scaffold `src/dispatch/stations.ts` — station registry with `nearest()` lookup. Landed 2026-04-18.
- [x] Scaffold `src/dispatch/assignment.ts` — `assignNearestIdle()` greedy heuristic, suppression-type filter. Landed 2026-04-18.
- [x] Tests in `src/dispatch/__tests__/` — 9 tests, lifecycle + heuristic. Landed 2026-04-18.
- [x] Wire fire-loop in `src/main.ts`: detect new burning tiles → spawn incidents (call `registry.detectFromFireGrid()` periodically, e.g. every 1s) — **Done 2026-04-18 via `src/systems/dispatchLoop.ts`**
- [x] Wire follower-loop: when assignment lands, push goal into `PathFollower` and mark unit busy until `Incident.status === 'resolved'` — Done. Dispatch now uses same-path projection (no cross-path teleporting).
- [x] Add `src/ui/dispatchPanel.ts` — list incidents, available units, current assignments — **Done 2026-04-18**
- [x] Auto-dispatch toggle + manual override — panel shows per-incident "Assign selected" button; `DispatchPanelCallbacks` includes `getSelectedFollowerId` + `onManualDispatch`. Wired in `main.ts`.
- [x] Promote `Incident.status === 'engaged'` when assigned unit reaches the incident tile (distance check) — Done.
- [x] Real suppression: engaged followers call `consumeWater` + `applyWaterAoEWithHydrants` each frame. Empty-tank units reopen the incident and return to base. Refill/refuel at home restores payload.
- [ ] Replace greedy heuristic with cost-based assignment (factor in unit type, water remaining, response distance)

### 2. Unify intersection control across both vehicle systems (M)

`src/vehicles/intersectionManager.ts` (just landed) only serves PathFollower. Share queue/token state with `VehiclesManager` grid agents so the two fleets co-exist without colliding.

- [ ] Extract queue/token state from `intersectionManager.ts` into shared module
- [ ] Wire grid agents in `vehicles.ts` to consult the same queue lookup
- [ ] Add spatial collision query usable by both systems
- [ ] Test: mixed PathFollower + grid agents at the same four-way stop

### 3. Vehicle payload + fuel model (M)

Makes choices matter. Vehicles must return to base when empty.

- [x] Pure payload module `src/vehicles/payload.ts` — `createPayload`, `tickFuel`, `consumeWater`, `refuel`, `refill`, `status`, `needsReturnToBase`. 7 tests. Landed 2026-04-18.
- [x] Attach `PayloadState` to `ActiveFollower` entries in `main.ts` — `createPayload()` per spawn, `tickFuel` during motion, `consumeWater` per suppression frame, empty-tank units return home and refuel/refill on arrival. Done.
- [ ] Update speed model for grade + load
- [~] Call `consumeWater` from suppression loop; stop spraying when empty — **done in `updateFollowerSuppression()`**
- [~] "Return to base" autopilot triggered by `needsReturnToBase` — **done in `sendFollowerHome()` + `updateFollowerLogistics()`**
- [ ] HUD bars per vehicle (fuel + water)

### 4. Fire-aware pathing (L)

Vehicles route around active fires; re-plan when planned route becomes hot.

- [ ] Add fire-heat cost layer in `src/roads/cost.ts`
- [ ] Merge cost sources (terrain + fire + vehicle density) in `src/roads/astar.ts`
- [ ] Re-path trigger in PathFollower / VehiclesManager when path cost spikes
- [ ] Tunable: avoidance weight, re-path threshold

### 5. Road midline spatial index (M)

Fixes drift and yaw glitches. `src/roads/visual.ts` already exposes `getMidlinesXZ()` (~line 97).

- [x] `src/roads/midlineIndex.ts` — uniform-grid index, `nearest(x,z) → { pathIdx, segIdx, t, point, distance, tangent, normal }`. 6 tests including brute-force parity check. Landed 2026-04-18.
- [x] Wire `RoadsVisual` to build/refresh the index when paths change — `addPath()` rebuilds `midlineIndex` after each path is added; `clear()` resets it.
- [x] `projectToMidline()` and `findNearestPathIndex()` now use `midlineIndex.nearest()` — no more coarse scan. Done.
- [ ] Use projected tangent for yaw smoothing in `frenet.ts`
- [ ] Bench: query latency vs previous brute-force

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
