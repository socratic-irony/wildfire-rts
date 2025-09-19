# Dual Vehicle Architecture Overview

This project maintains two complementary vehicle controllers:

- **PathFollower (Frenet)** – used for player-facing vehicles spawned from the menubar. Each follower owns a dedicated `Object3D`, rides a smoothed `Path2D`, and handles leader-follow spacing, grade-aware speed, and terrain-conforming pose.
- **VehiclesManager (Instanced)** – simulates large numbers of grid-follow vehicles using instanced meshes. It owns the particle/light FX emitters, hydrant-aware abilities, and the four-way-stop intersection queues.

Keeping both systems allows rapid iteration on the Frenet experience without losing the instanced manager that powers particles, water spray, and regression tests.

## When to Use Each System

| Scenario | Recommended Controller |
| --- | --- |
| Player spawns from the menubar / UI demos | `PathFollower`
| Mass-agent stress tests, particle FX demos, hydrant ability validation | `VehiclesManager`
| Unit tests exercising vehicle abilities, sprays, or instancing | `VehiclesManager`
| Future authored missions where a few hero vehicles require high fidelity | `PathFollower`

`PathFollower` vehicles should be favored for any interactive tooling because they offer smooth motion, lane offsets, and per-vehicle mesh customization. Reach for `VehiclesManager` when you need instancing efficiency, shared particle systems, or access to the intersection manager.

## FX & Ability Bridge

`main.ts` keeps the two systems synchronized:

1. Each frame, followers decompose their transform into a reusable `VehicleFxState` (`pos`, `forward`, `up`, `right`, `speed`, `type`, `sprayingWater`, `siren`).
2. The array of `VehicleFxState` records is passed to `vehicles.updateExternalFx(dt, states)`.
3. `VehiclesManager` reuses its instanced headlights, turn signals, emergency flashers, dust, and water emitters to render effects for the Frenet vehicles.

This bridge lets one particle/light implementation serve both controllers. Any new FX should be implemented in `VehiclesManager.updateExternalFx` and driven through the shared state payload.

## Intersection Responsibilities

- The **VehiclesManager** layer currently owns all intersection logic: queue bookkeeping, stop timers, and occupant tracking.
- Frenet followers **do not yet** consult those queues; they only perform leader-follow spacing along a `Path2D`.

Until the controllers are unified, treat `VehiclesManager` as the source of truth for intersection behavior. When adding new gating rules, expose the relevant state so followers can participate in the same queues.

## Current Limitations

- PathFollower vehicles ignore the instanced intersection queues and can still overlap at crossings.
- The Frenet layer lacks hydrant/ability plumbing; all sprays still flow through `VehiclesManager`.
- Diagnostic overlays (queue depth, active emitters) exist only in the manager; followers need mirrored instrumentation.

## Next Steps

1. Share intersection queue state (`waitingFor`, `stopTimer`, occupant IDs) with PathFollower controllers.
2. Move hydrant/ability calls behind a common service so both systems can activate sprays.
3. Extract FX emitters into a standalone module if additional controllers are added.
