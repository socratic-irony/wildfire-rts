# Fire Behavior

## Status

Implemented: tile ignition/spread, wind and slope, moisture, wetness/retardant, spotting, combustion, smoldering, water suppression, retardant lines, cleared firelines, road fuel barriers, head selection, statistics, controlled backburn lineage, difficulty spread/spot multipliers, cached active-tile queries with wildfire/burning filters. Outstanding: crown fire, edge-based line strength, hand crews, fire-aware engine routing, detailed smoke/ember weather coupling.

## Grid model

`Wildfire` keeps parallel typed arrays over the 96×96 grid:

- `state: Uint8Array` (unburned, igniting, burning, smoldering, burned, cleared)
- `controlled: Uint8Array` — remaining backburn generations; 0 means wildfire (see Backburns)
- `heat`, `progress`, `wetness`, `retardant`, `lineStrength`, `fuelMoisture`, `slopeTan`, `gradientX/Z`, `ignitionTimer`
- `fuel: Uint8Array` indexing `Fuel`
- `env: { windDirRad, windSpeed, humidity }`
- `simTime`, step counter, hashed seed

Balance note: terrace banks now carry fuel (they used to be classed as rock and acted as free firebreaks), so `SPREAD_SCALE = 0.35` and `SPOT_SCALE = 0.3` trim spread and ember spotting. The difficulty preset multiplies both through `spreadMultiplier` and `spotMultiplier` (Calm 0.82/0.6, Standard 1/1, Red Flag 1.25/1.7). `npm run balance` reports hands-off outcomes per seed; active play (lines, roads, backburns, manual orders) is expected to make the difference. Hands-off results on the eight default seeds at the time of writing:

| Preset | Won | Structures lost (all seeds) | Typical loss |
| --- | --- | --- | --- |
| Calm | 5 / 8 | 2 | fire still burning at the bell |
| Standard | 3 / 8 | 0 | fire still burning at the bell |
| Red Flag | 2 / 8 | 14 | burn limit, structures, or the bell |

Buying mutual aid alone (`ASSIST=1`) does not change the Standard win count; it trims burned area on most seeds.

Fire ticks at 5 Hz (`FIXED_STEP = 0.2`) from the frame-driven accumulator, capped at 12 steps per call.

## State machine

```text
Unburned -> Igniting (ignition test)
Igniting -> Burning after fuel.ignitionDelay
Burning  -> Smoldering when progress >= 1
Smoldering -> Burned when heat <= 0.015
Cleared  -> inert fireline
Burned   -> inert
```

Heat rises toward 1 with time constant 1.7 s while burning. Fuel is consumed over each fuel's flame duration. Smoke/ember visuals are driven by the current heat and state.

## Spread

For every burning tile and its 8 neighbors:

```text
windDot     = dot(dir, normalizedWind)
upslopeDot  = dot(dir, normalizedHeightGradient)
slopeMult   = upslopeDot >= 0 ? 1 + kSlope * slopeTan * upslopeDot
                                : 1 / (1 + 0.9 * slopeTan * -upslopeDot)   // backing downhill
ros         = baseROS * SPREAD_SCALE(0.35) * (1 + kWind * windSpeed * max(0, windDot) * 1.25)
                     * slopeMult
                     * moistureDamp
p           = clamp(ros * dt / TILE_SIZE, 0, 1)
              * (0.55 + 0.45 * max(0, windDot))
              * barrier
              * wetness/retardant gate
```

Probability is capped at 0.55. Wetness over 0.5 suppresses almost all ignition; retardant contributes up to a 0.95 probability cut. Cleared tiles and inert fuels cannot ignite. Roads are inert fuel and therefore act as firebreaks.

Hashed RNG (`hash01_3(index, neighbor, step, seed)`) keeps spread deterministic. Identical seeds and step sequences produce identical state arrays (unit-tested).

## Spotting

Burning tiles may throw an ember downwind when wind is above 2.5 m/s. Distance is roughly 4–18 tiles depending on wind, with angular jitter. The landing tile must be unburned, burnable, and reasonably dry. Spot ignition events are exposed in the step return array for potential incident/UI use; v1 merges them into the existing incident.

## Suppression

### Water

`applyWater(worldX, worldZ, radiusWorld, power, dt)` applies falloff-weighted wetness and heat knockdown. Burning tiles below 0.1 heat transition to smoldering; igniting tiles above 0.5 wetness are reset. Engines, helicopters, and hydrants call this.

### Retardant

`applyRetardantLine(ax, az, bx, bz, width, strength)` paints a persistent field along a segment. The tanker lays a line perpendicular to the wind through the downwind head. Retardant decays with a 620 s time constant and cuts ignition probability.

### Firelines

`clearLine(worldX, worldZ, radiusWorld)` writes `state = Cleared`, heat 0, progress 1, and full line strength. Dozers cut these along their path. Cleared tiles cannot ignite and tint tan on the terrain and vegetation. Structure (urban), road, and water tiles are never cleared, so a line can pass beside a house without bulldozing it.

### Backburns

The player's drip torch calls `ignite(tx, tz, false, BACKBURN_GENERATIONS)` (10). Each tile a backburn spreads into inherits one fewer generation; when the count reaches 0 the new fire is ordinary wildfire. Embers thrown by a backburn are always wildfire. A backburn lit against a firebreak burns out the fuel between the break and the oncoming head; one lit carelessly runs past its budget and becomes a new wildfire that the lookout reports.

- Burned tiles keep their lineage, so `stats()` splits area into `burnedHectares` (wildfire) and `backburnHectares`.
- Loss thresholds and the win condition count wildfire only. Score charges backburned area at a third of the wildfire rate.
- Engines, aircraft targeting, incident tracking, and severity ignore controlled tiles.

## Queries

All spatial queries walk a cached list of active (igniting, burning, smoldering) tile indices that is rebuilt only after the fire state changes. Each takes optional flags: `QUERY_BURNING` skips smoldering tiles and `QUERY_WILD` skips controlled backburn tiles.

- `nearestActive(x, z, radiusTiles, flags)` — nearest active tile in a square window; engines use it for hose targets and attack positions.
- `headTileNear(x, z, radiusTiles, flags)` — highest wind-projected burning tile; aircraft, dozer lines, and head arrows.
- `activeCountNear(x, z, radius, flags)` — incident severity.
- `isActiveNear`, `forEachActive`, `centroid`.
- `stats()` — whole-grid counts, cached until the state changes. The returned object is shared; do not mutate it.
- `activeFireCount` — burning plus igniting tiles of any lineage.
- `refreshRoadMask(mask)` — integration hook after road edits.
- `takeBreakContacts()` — firebreak tiles (cleared lines, roads) that wildfire pushed against downwind since the last call, capped at 64 per drain; the game turns them into "line is holding" reports.

## Tuning

Fuel profiles live in `FUELS` in `src/sim/fire.ts`. Flame/smolder durations, ignition delay, moisture damping, slope/wind factors, and spot chance are per fuel. The renderer and gameplay share the current constants; changes should be reflected here and in tests.

## Outstanding

- Edge-based fireline strength and crown-fire bypass.
- Backburns currently spread with the same model as wildfire; a dedicated "backing fire" rate and burnout patterns along the line are not modelled.
- Multi-hop embers with angular/distance sampling and fuel-bed interactions.
- Firefighter hand crews and handline painting.
- Fire-aware vehicle routing and road closures.
- Diurnal humidity and live fuel moisture model.
- A dedicated spotfire incident UI and perimeter analytics.
