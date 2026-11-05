# Gameplay and Scenario

## Status

Implemented: seeded single shift, three difficulty presets, briefing with difficulty picker and personal best, scripted lightning with storm countdown, forecast wind shifts with warnings, objectives, win/loss, grades and scoring, command budget, dozer line / road / backburn tools, mutual aid, threatened-structure warnings, head-of-fire arrows, lookout spot-fire incidents, one-time coaching hints, procedural audio, lightning flash and camera shake, pause/speed, HUD/minimap, help, end screen with replay, test API. Outstanding: additional scenarios and a campaign, save/load, replay log, full accessibility pass, touch controls.

## Shift

- Length: 8:00 simulated minutes (`SHIFT_SECONDS`).
- Seed: URL `?seed=123456`; otherwise random per load. `?difficulty=calm|standard|redflag` preselects a preset; otherwise the last choice is remembered in local storage.
- World: 96×96 terraced tiles with a central town, lake, forest/brush/rock, roads, hydrants, and ~19 structures including the fire station.
- Fleet: two engines, one dozer, one helicopter, one air tanker, plus up to three mutual-aid units.

## Difficulty

Presets live in `src/sim/difficulty.ts`.

| | Calm | Standard | Red Flag |
| --- | --- | --- | --- |
| Lightning strikes (s) | 30, 120, 230 | 26, 94, 172, 266 | 20, 72, 128, 190, 255, 325 |
| Wind shifts (s) | 90, 210, 340 | 70, 190, 310, 420 | 60, 150, 240, 330, 410 |
| Start wind / shift range (m/s) | 4.2 / 3.2–6.6 | 5.4 / 4.2–9.4 | 7.2 / 6.2–11.2 |
| Spread × / spotting × | 0.82 / 0.6 | 1 / 1 | 1.25 / 1.7 |
| Budget start / income / containment bonus | $450 / 2.2/s / $150 | $320 / 1.6/s / $120 | $260 / 1.3/s / $110 |
| Loss: burned area / structures lost | 2.2 ha / 12 | 1.6 ha / 10 | 1.4 ha / 8 |
| Corralled at the bell (burning tiles) | 40 | 15 | 6 |
| Score multiplier | ×0.8 | ×1 | ×1.5 |

## Ignition schedule

Each scripted strike ignites a cluster of up to ~5 tiles and creates an incident, with a lightning bolt, screen flash, thunder (delayed by distance from the camera), and camera shake. Candidate sites are biased toward dry forest/brush, 13–50 tiles from town, upwind of the town for the starting wind. The top bar counts down to the next strike ("strike in 00:21") until the storm has passed.

Manual test fires remain available through the test API only (`ignite`); the player's fire tool is the backburn torch.

## Wind forecast

The wind schedule is generated when the difficulty is chosen, from the seed (`Scenario.windForecast`). The top bar shows the next shift's direction, speed, and countdown; the minimap shows a forecast arrow next to the current wind. Fifteen seconds before a shift a warning toast announces it. Shifts ease in along the shortest rotation.

## Objectives and outcome

Wildfire means fire that is not a controlled backburn (see `fire_behavior.md`).

- **Win**: all scheduled strikes have occurred, all incidents are resolved, and no wildfire has been burning or igniting for 7 seconds.
- **Win at time**: the shift timer expires with no wildfire burning.
- **Corralled at time**: the timer expires with no more wildfire tiles burning than the preset allows (Calm 40, Standard 15, Red Flag 6) and no standing structure burning or within 7 tiles of burning wildfire. The night crew mops up; the grade is capped at B (C with more than three losses).
- **Lose**: the preset's structure-loss limit is reached; wildfire-burned area exceeds the preset's limit; or the timer expires with wildfire burning.
- Structures count as standing until destroyed.

## Scoring and grade

```text
(standing * 120
 - destroyed * 240
 + contained incidents * 200
 + remaining seconds * 4 (on win)
 - wildfire hectares * 180
 - backburned hectares * 60) × difficulty multiplier
```

Grade (corralled wins excepted, see above): **S** won with no losses and under 0.4 ha burned; **A** won with ≤1 loss and under 0.9 ha; **B** won with ≤3 losses; **C** any other win; **D** lost after 80% of the shift; **F** lost earlier. The best score per seed and difficulty is stored locally, shown on the briefing screen, and flagged on the end screen when beaten. The end screen shows structures standing, lost, and saved, wildfire and backburned area, time, score with its multiplier, and the grade, and offers **Replay this map** (same seed and difficulty) and **New Shift**.

## Command budget

`Budget` (`src/sim/budget.ts`) starts at the preset amount, accrues income every simulated second, and pays the containment bonus whenever an incident resolves and $40 for every structure that was threatened and came through (no wildfire within 12 tiles).

| Spend | Cost |
| --- | --- |
| Road | $4 per new asphalt tile (existing road tiles are free) |
| Backburn strip | $20 |
| Mutual-aid engine / dozer / helicopter | $320 / $240 / $420 |
| Dozer line | free (costs dozer time) |

## Player tools

- **Command** (`V`) — click units, empty ground, incidents, or burning tiles. Right-click moves the selected unit or attacks a fire.
- **Dozer line** (`L`) — click a start, then an end. A preview shows the off-road cut path and length. The selected dozer (or the nearest one) drives there and cuts a permanent firebreak, then holds.
- **Road** (`B`) — click a start, then a destination. The preview shows tile count and cost and turns red when unaffordable. New asphalt is a firebreak and refreshes hydrants/vegetation. Crews will not pave through active fire.
- **Backburn** (`T`, also `I`) — click unburned fuel within 2 tiles of a road, cleared line, water, rock, or burned ground, within ~38 tiles of an active incident. Lights up to three tiles across the wind as a controlled burn.
- `Tab` / `Shift+Tab` cycle units; `Esc` cancels a pending start point, then leaves the tool, then deselects.

## HUD

- Top bar: directive, shift timer with storm countdown, active fires, standing structures with "N at risk", budget with income, burned hectares against the limit, wind with the next forecast shift, pause, speed, sound, help.
- Incident board: severity, cell count, source (lightning/spot), structures it threatens, assigned units, dispatch and focus.
- Fleet list: status, payload, heat stress, out-of-service and mutual-aid tags; mutual-aid buttons with cost and ETAs.
- Selected unit panel (right of the fleet list): payload meter, heat-stress meter for ground units, hydrant/incident/burnover flags, actions, and a one-line tip.
- Minimap: terrain, roads, structures (threatened ones pulse red), wildfire vs backburn colours, incidents, units, camera rectangle, current and forecast wind.
- In the world: pulsing red rings under threatened structures and an arrow at each sizeable fire's head pointing downwind.
- Toasts for strikes, wind forecasts and shifts, dispatches, spot fires, building losses, burnovers, budget events, and resolution. Coaching hints appear once per browser, at most one every 22 s.
- A structure is "at risk" when burning wildfire is within 7 tiles or the structure itself is burning. Threats, saves, and firebreak reports are computed on the simulation clock every 0.5 s (`Game.updateSituation`), so they are deterministic.
- When wildfire pushes downwind into a dozer line or a road the player paved, a toast reports that the line is holding (at most every 25 simulated seconds) with a chime.
- Road and dozer-line plans show a translucent overlay on exactly the tiles they will occupy (red when the road is unaffordable), plus a thin centre line.
- The light runs from late afternoon to golden hour over the shift: the sun lowers and warms, and sky, fog, and light take on smoke as more tiles burn (`fx/atmosphere.ts`).
- Hidden overlays (briefing, end screen, help) stop taking pointer input as soon as they start to fade, so the first map click after Start Shift is never swallowed.

## Audio

`SoundEngine` (`src/audio/sound.ts`) synthesises everything with WebAudio: wind and fire-crackle beds driven by wind speed and burning tiles near the camera, a hose hiss while engines spray, and cues for clicks, dispatch yelps, thunder, collapse, drops, retardant, wind shifts, containment, burnovers, alerts, and win/lose stingers. Audio starts on the Start Shift click; `M` or the speaker button mutes, and the choice is remembered.

## Input and camera

- Orthographic diorama camera; yaw/pitch orbit with Q/E and R/F, WASD/arrow pan, wheel zoom-to-cursor, middle-drag pan.
- Briefing screen slowly rotates the camera; all simulation is stopped.
- Simulation speed 1×/2×/4×; Space toggles pause. Outcomes do not depend on the speed setting.

## Test API

`window.__cinderline` exposes deterministic QA helpers:

- `getState()` — seed, difficulty, funds, pending reinforcements, scenario/result, fire stats, units, incidents, buildings, hydrants, roads, vegetation.
- `start()`, `setSpeed()`, `setAutoDispatch()`, `setDifficulty(id)`, `advanceTime(ms)`, `setRealtime(enabled)`. The first `advanceTime` freezes the real-time loop so scripted runs are deterministic.
- `ignite(tx, tz)`, `torch(tx, tz)`, `findBurnableNear(tx, tz, radius)`.
- `selectUnit()`, `dispatch()`, `orderLine(sx, sz, gx, gz)`, `requestMutualAid(kind)`, `buildRoad()` (free, for QA), `focusTile()`, `focusIncident()`.
- `screenPosition()`, `unitScreenPosition()`, `debugPick()`.
- `roadFuelMismatches()` — integration assertion for road firebreaks.

- `getState().plan` — tile count and visibility of the road/dozer-line plan overlay.

These helpers are used by `scripts/smoke.mjs`, `scripts/stability.mjs`, and `scripts/balance.mjs`. The smoke test also plans a road through real mouse input (and checks the overlay), orders a dozer line, lights a backburn, buys a mutual-aid dozer and waits for it to arrive, and checks the result has a grade.

## Acceptance criteria

- A seeded boot produces terrain, roads, ~19 structures, 20+ hydrants, and 1,000+ vegetation instances.
- Strikes show a bolt and flash, and fires show smoke, embers, and building damage.
- Auto dispatch sends at least one capable unit per incident and does not deadlock; no unit stays stationary in a moving state (`npm run balance`).
- Engines exhaust water and refill at a hydrant or station; aircraft refill at the helipad or (helicopter) the lake.
- Dozers leave persistent cleared lines; tankers leave retardant; roads are firebreaks; backburns consume fuel and turn wild if they run too far.
- A full shift reaches win or loss and displays the graded result screen.
- `npm run check`, `npm run smoke`, and `npm run stability` pass without browser errors.

## Outstanding

- Save/load, scenario selection, and a campaign wrapper.
- Keyboard focus management for every HUD control; colour-blind palette option.
- Touch-first controls; the layout is desktop-first.
- A "backing fire" spread rate specific to backburns.
