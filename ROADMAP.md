# Wildfire-RTS Roadmap

Single forward-looking plan. For shipped history see [CHANGELOG.md](CHANGELOG.md). For contribution rules see [AGENTS.md](AGENTS.md). For agent entry-point see [CLAUDE.md](CLAUDE.md). Per-system domain state lives in each spec's `Status` / `⏳ Outstanding` section under [specs/](specs/).

---

## Status legend

- `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` deferred
- Scope: **S** ≤ half-day · **M** 1–3 days · **L** 1+ week

---

## MVP definition

A playthrough satisfies the MVP when, from a seeded boot, the audit can:

1. Bootstrap terrain + roads + hydrants + vehicles.
2. Ignite fires and resolve them via auto-dispatch **and** manual dispatch.
3. Exhaust and refill vehicle payloads without the loop stalling.
4. Run a multi-minute scenario to a deterministic win/loss outcome.

Acceptance gate: `npm test`, `npm run build`, and `npm run audit:game` all green.

As of 2026-04-19 items 1–2 are covered by `audit:game`. Items 3–4 are the focus of Phase 1–2 below.

---

## Phase 1 — Harden the audit loop (now)

Each item adds a new scenario to [scripts/qa/playwright_audit.ts](scripts/qa/playwright_audit.ts) *before* any fix, so the loop earns trust as coverage grows.

- [x] **Payload exhaustion round-trip** (S) — ignite multiple fires; watch a firetruck drain → `needsReturnToBase` → RTB → refill → redeploy. Exercises [src/vehicles/payload.ts](src/vehicles/payload.ts), `sendFollowerHome`, `updateFollowerLogistics` in [src/main.ts](src/main.ts). Likely surfaces orphaned `busy=true` states.
- [x] **Hydrant-fed suppression** (S) — park a unit inside hydrant coverage, ignite, verify suppression continues past the truck's tank capacity. Covers the currently-unasserted HIGH-PRIORITY hydrant integration in [src/fire/hydrants.ts](src/fire/hydrants.ts).
- [x] **Bulldozer fireline** (S) — issue an off-road order across a burning path, fast-forward, assert `lineStrength` written to the expected tiles and that ROS into them drops. Covers off-road path in [src/vehicles/followerOrders.ts](src/vehicles/followerOrders.ts).
- [x] **Long-run stability** (S) — `advanceTime(60_000)` with 5 fires + 3 units. Assert no NaN positions, no orphaned assignments, bounded incident count. Proves the `advanceTime` fast-forward is stable for scenario-length runs.
- [x] **Stress + contention** (S) — 10 simultaneous ignitions, 4 firetrucks. Assert dispatch does not deadlock; every incident reaches `resolved` or `reopened`. Stresses [src/dispatch/cost.ts](src/dispatch/cost.ts).

## Phase 2 — Give the MVP a shape

Currently there is no win/loss condition, so "MVP" has no objective gate.

- [x] **Scenarios + win/loss** (M) — add `src/scenarios/` with one seeded scenario ("contain fire within N tiles in M simulated minutes"). Expose `getScenarioResult()` on the test API. New audit scenario plays it to completion and asserts `result === 'win'`. This becomes the MVP acceptance test.
- [x] **Cost-based dispatch** (S, was ROADMAP §1 final item) — [src/dispatch/cost.ts](src/dispatch/cost.ts) `assignByCost` replaced the greedy heuristic, factoring unit type, water remaining, and response distance.

## Phase 2b — MVP gameplay breadth (2026-06-09)

Make the strategy loop real: varied threats, every vehicle class with a working role, structures worth protecting.

- [x] **Random events** (S) — seeded lightning ignitions + wind shifts in [src/events/events.ts](src/events/events.ts), menubar toggle, `random-events` audit scenario asserts occurrence + determinism. Seeded boots are now fully deterministic (procedural road seed derives from the world seed).
- [x] **Aircraft roles** (M) — helicopters/airplanes fly off-road to incidents at cruise altitude; helicopters drop water, airplanes drop retardant lines; both RTB to refill. Dispatch is routeability-aware so off-road fires go to aircraft. Audit scenario `aircraft-drops`.
- [x] **Hydrant refill** (S) — water-empty firetrucks reroute to the nearest on-path hydrant and refill at 400 L/s instead of driving home (low fuel still forces home RTB). Audit scenario `hydrant-refill`.
- [x] **Buildings + protect-homes scoring** (M) — seeded procedural structures in [src/buildings/buildings.ts](src/buildings/buildings.ts): houses/barns clustered near roads, cabins deep in the woods; latching intact → burning → destroyed states driven by the fire grid; `getScenarioResult()` reports structure outcomes and a protect-homes score (+10 standing / −25 lost). Audit scenario `buildings-protection`.
- [x] **Civilian traffic** (S) — four civilian styles (sedan, pickup, van, hatchback) with a seeded 8-color palette wander the road network; boot fleet is 1 firetruck + 1 bulldozer + 3 civilians per road loop. All vehicle meshes upgraded to multi-part voxel builds in [src/vehicles/voxelMeshes.ts](src/vehicles/voxelMeshes.ts) (light bars, ladder rungs, dozer tracks, spinning heli rotor, tanker wings). Audit scenario `civilian-traffic`.

## Phase 3 — Cleanup under audit protection

Lower-risk once Phase 1 lands.

- [x] **Road/hydrant render debug cleanup** (S) — hide the diagnostic road triangle lattice/midline and hydrant coverage rings by default, expose them through detailed debug controls, and centralize duplicated player-road planner logic in [src/roads/planner.ts](src/roads/planner.ts).
- [ ] **Decompose `src/main.ts`** (M, 1027 LOC) — extract `src/input/handlers.ts` and `src/systems/fireLoop.ts`.
- [ ] **Decompose `src/vehicles/vehicles.ts`** (M, 1010 LOC).
- [ ] **Decompose `src/ui/menubar.ts`** (M, 901 LOC) — split per-section.
- [ ] **Unify intersection control** (M) — share queue/token state from [src/vehicles/intersectionManager.ts](src/vehicles/intersectionManager.ts) with `VehiclesManager` grid agents. Needs a curvature/collision assertion added to the audit first.
- [ ] **Midline tangent yaw smoothing** (S) — use projected tangent from the `midlineIndex` for yaw in [src/vehicles/frenet.ts](src/vehicles/frenet.ts). Bench query latency vs previous brute-force.

## Deferred

Explicitly not in the MVP; revisit after Phase 2 ships.

- [-] **Fire-aware pathing** (L) — fire-heat cost layer in [src/roads/cost.ts](src/roads/cost.ts), merged cost field, re-path trigger.
- [-] **OSM road import** (L) — `src/osm/loader.ts`, projection, roadgraph, menubar picker, sample `.geojson`.
- [-] **Crown fire + edge-based firelines** — see [specs/fire_behavior.md](specs/fire_behavior.md) `⏳ Outstanding`.
- [-] **Hydrant damage states + manual placement UI** — see [specs/fire_hydrants.md](specs/fire_hydrants.md) `⏳ Outstanding`.
- [-] **Scenario persistence / multiplayer** — out of scope for v1.

---

## Workflow — how to add to this roadmap

1. New gameplay claim? Write the audit scenario in [scripts/qa/playwright_audit.ts](scripts/qa/playwright_audit.ts) *before* the implementation. Watch it fail.
2. Implement the minimum to make it pass. Keep commits focused per [AGENTS.md](AGENTS.md).
3. Update the relevant [specs/](specs/) `Status` section and tick the checkbox here.
4. Append a one-line entry to [CHANGELOG.md](CHANGELOG.md) with the date and `audit:game` state.
