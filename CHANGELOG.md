# Changelog

Session-level history of landed changes. Forward-looking plans live in [ROADMAP.md](ROADMAP.md). Per-subsystem status lives in [specs/](specs/).

Each entry is dated and, when relevant, notes the `audit:game` / `npm test` state at the time.

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
