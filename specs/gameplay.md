# Gameplay and Scenario

## Status

Implemented: seeded single shift, briefing, scheduled lightning, wind shifts, objectives, win/loss, scoring, pause/speed, manual ignition, road building, HUD/minimap, help, end screen, test API. Outstanding: additional scenarios, difficulty settings, save/load, replay log, accessibility pass, audio.

## Shift

- Length: 8:00 simulated minutes.
- Seed: URL `?seed=123456`; otherwise random per load. A new shift uses a fresh random seed.
- World: 96×96 terraced tiles with a central town, lake, forest/brush/rock, roads, hydrants, and 19 structures including the fire station.
- Fleet: two engines, one dozer, one helicopter, one air tanker.

## Ignition schedule

Scripted lightning strikes at **26 s, 94 s, 172 s, and 266 s**. Each strike ignites a cluster of up to ~5 tiles and creates an incident. Candidate sites are biased toward dry forest/brush, 13–50 tiles from town, upwind of the town for the current wind.

Wind starts at ~5.4 m/s and shifts at **70 s, 190 s, 310 s, and 420 s** to new seeded directions and speeds. Shifts are eased into the live fire environment and announced in the toast feed.

There is no limit on manual test fires from the Ignite tool.

## Objectives and outcome

- **Win**: all scheduled ignitions have occurred, all incidents are resolved, and no burning/igniting fire remains for 7 seconds.
- **Win at time**: if the shift timer expires with no active fire.
- **Lose**: 10 structures destroyed; burned area over 1.6 ha; or the timer expires with active fire.
- Structures count as standing until destroyed. Burning structures are still standing but losing health.
- Smoldering tiles must finish/resolve before the win triggers.

## Scoring

```text
standing * 120
- destroyed * 240
+ contained incidents * 200
+ remaining time * 4 (on win)
- burned hectares * 18
```

The final result is shown with structures saved/lost, burned hectares, incidents contained, elapsed/remaining time, and score.

## Player tools

- **Select** — click units, empty ground, incidents, or burning tiles.
- **Ignite** — start a test fire on any burnable tile (including a building footprint).
- **Road** — click a start tile, then a destination. A* preview line appears while hovering; the build becomes a firebreak and refreshes hydrants/vegetation.
- **Toolbar help** and `H` open the field manual.

## HUD

- Top bar: directive, shift timer/progress, active fires, standing structures, burned hectares, wind speed/direction, pause, speed, help.
- Incident board: severity, sector, active-cell count, assigned units, dispatch and focus.
- Fleet list: status and payload; click to select.
- Selected unit panel: payload meter, hydrant/incident flags, action buttons.
- Minimap: terrain, roads, structures, fire, incidents, units, camera rectangle, wind; click to pan.
- Toasts for new fires, wind shifts, dispatches, building losses, hydrant supply, and resolution.
- Hover tooltip: terrain/fuel/slope, building state, fire state, wetness/retardant.

## Input and camera

- Orthographic diorama camera; yaw/pitch orbit with Q/E and R/F, WASD/arrow pan, wheel zoom-to-cursor, middle-drag pan.
- Briefing screen slowly rotates the camera; all simulation is stopped.
- Simulation speed 1×/2×/4×; Space toggles pause.
- Escape cancels a road start, closes help, or deselects.

## Test API

`window.__cinderline` exposes deterministic QA helpers:

- `getState()` — seed, scenario/result, fire stats, units, incidents, buildings, hydrants, roads, vegetation.
- `start()`, `setSpeed()`, `setAutoDispatch()`, `advanceTime(ms)`.
- `ignite(tx, tz)`, `findBurnableNear(tx, tz, radius)`.
- `selectUnit()`, `dispatch()`, `buildRoad()`, `focusTile()`, `focusIncident()`.
- `screenPosition()`, `unitScreenPosition()`, `debugPick()`.
- `roadFuelMismatches()` — integration assertion for road firebreaks.

These helpers are used by `scripts/smoke.mjs`.

## Acceptance criteria (v1.0)

- A seeded boot produces terrain, roads, 19 structures, 20+ hydrants, and 1,000+ vegetation instances.
- Two finger-strikes can be observed with visible fire, smoke, embers, and building damage.
- Auto dispatch sends at least one capable unit per incident and does not deadlock.
- Engines exhaust water and refill at a hydrant or station; aircraft refill at the helipad.
- Dozers leave persistent cleared lines; tankers leave retardant; roads are firebreaks.
- A full shift reaches win or loss and displays the result screen.
- `npm run check`, `npm run smoke`, and `npm run stability` pass without browser errors.

## Outstanding

- Save/load and scenario selection.
- Difficulty scaling (fire weather, structure count, response time).
- Authoring more shifts and a campaign wrapper.
- Keyboard focus management and reduced-motion support.
- Audio mix and siren/ambience.
- Touch-first controls; the layout is desktop-first.
