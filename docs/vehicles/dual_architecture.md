# Dual Vehicle Architecture Overview

This project maintains two complementary vehicle controllers:

- **PathFollower (Frenet)** – the **primary player-facing runtime**. All vehicles spawned from the menubar are PathFollower instances. Each follower owns a dedicated `Object3D`, rides a smoothed `Path2D`, handles leader-follow spacing, grade-aware speed, terrain-conforming pose, payload/fuel tracking, and suppression logic. Intersection control is provided by `IntersectionManager` (dedicated to PathFollower, not shared with VehiclesManager).
- **VehiclesManager (Instanced)** – mainly shared FX / legacy / demo infrastructure. Uses instanced meshes for performance with many vehicles. Owns particle/light FX emitters, hydrant-aware abilities, and the FX bridge. Currently used for regression tests and special scenarios; not the primary player-facing system.

## When to Use Each System

| Scenario | Recommended Controller |
| --- | --- |
| Player spawns from the menubar / UI demos | `PathFollower`
| Suppression, dispatch, return-to-base | `PathFollower` + `updateFollowerSuppression/Logistics`
| Mass-agent stress tests, particle FX demos, hydrant ability validation | `VehiclesManager`
| Unit tests exercising vehicle abilities, sprays, or instancing | `VehiclesManager`
| Future authored missions where a few hero vehicles require high fidelity | `PathFollower`

`PathFollower` vehicles are the primary runtime for all interactive gameplay. `VehiclesManager` is retained for its FX bridge, particle emitters, and test infrastructure.

## FX & Ability Bridge

`main.ts` keeps the two systems synchronized:

1. Each frame, followers decompose their transform into a reusable `VehicleFxState` (`pos`, `forward`, `up`, `right`, `speed`, `type`, `sprayingWater`, `siren`).
2. `sprayingWater` is controlled by `updateFollowerSuppression()` — only true when a unit is actively applying water to an engaged incident.
3. The array of `VehicleFxState` records is passed to `vehicles.updateExternalFx(dt, states)`.
4. `VehiclesManager` reuses its instanced headlights, turn signals, emergency flashers, dust, and water emitters to render effects for the Frenet vehicles.

## Intersection Responsibilities

- `IntersectionManager` is the authoritative controller for player-visible `PathFollower` traffic and provides deterministic batch arbitration, braking/approach caps, full-stop FIFO service, exclusive occupancy, and closed-loop-safe clearance.
- A `canEnterProbe` callback (set in `main.ts`) applies a spillback check: a follower cannot enter an intersection if the exit space on its current path is occupied by another unit within `CLEAR_ZONE` (8 m).
- `VehiclesManager` grid agents do not have an active intersection queue. The disconnected private queue prototype was removed; mixed grid/Frenet traffic is not a supported coordinated traffic model.

## Suppression Loop (as of 2026-04-18)

The suppression loop in `main.ts` closes the dispatch-to-resolve cycle:

1. `syncFollowerAssignments()` — mirrors `assignedFollowerIds` from incident registry into each `ActiveFollower.assignedIncidentId`.
2. `updateFollowerSuppression(dt)` — for each engaged unit within 10 m of its incident: draws water via `consumeWater`, applies `applyWaterAoEWithHydrants` to wet/cool tiles, sets `fxState.sprayingWater = true`. Empty-tank units call `sendFollowerHome()`.
3. `sendFollowerHome()` — calls `reopen(incidentId)` on the registry so the incident re-enters detected state, then issues a move order to the vehicle's `homePos`.
4. `updateFollowerLogistics(dt)` — ticks fuel, watches `needsReturnToBase`, and clears busy/assignment when a returning unit reaches home within 6 m and calls `refuel`/`refill`.

## Current Limitations

- PathFollower units follow their current road path to the nearest projected incident position; cross-path routing requires a road connectivity graph (post-MVP).
- HUD bars (fuel %, water %) per vehicle are not yet rendered.
- The legacy grid-agent layer in `VehiclesManager` is still present for focused tests/testbeds, but it has no intersection arbitration and should not be described as production traffic.
- Frenet queue/phase telemetry is exposed through the browser test/debug surface; per-vehicle HUD instrumentation is still limited.

## Next Steps

1. HUD bars per vehicle (fuel + water).
2. Retire or sharply isolate the legacy grid-agent movement layer; add a single shared traffic model only if mixed fleets become a real requirement.
3. Road connectivity graph for cross-path routing.
4. Move hydrant/ability calls behind a common service so both systems can activate sprays.
