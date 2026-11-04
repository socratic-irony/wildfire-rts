# Fire Behavior

## Status

Implemented: tile ignition/spread, wind and slope, moisture, wetness/retardant, spotting, combustion, smoldering, water suppression, retardant lines, cleared firelines, road fuel barriers, head selection, statistics. Outstanding: crown fire, edge-based line strength, hand crews, fire-aware pathing, detailed smoke/ember weather coupling.

## Grid model

`Wildfire` keeps parallel typed arrays over the 96×96 grid:

- `state: Uint8Array` (unburned, igniting, burning, smoldering, burned, cleared)
- `heat`, `progress`, `wetness`, `retardant`, `lineStrength`, `fuelMoisture`, `slopeTan`, `gradientX/Z`, `ignitionTimer`
- `fuel: Uint8Array` indexing `Fuel`
- `env: { windDirRad, windSpeed, humidity }`
- `simTime`, step counter, hashed seed

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
ros         = baseROS * (1 + kWind * windSpeed * max(0, windDot) * 1.25)
                     * (1 + kSlope * slopeTan * max(0, upslopeDot))
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

`clearLine(worldX, worldZ, radiusWorld)` writes `state = Cleared`, heat 0, progress 1, and full line strength. Dozers cut these along their path. Cleared tiles cannot ignite and tint tan on the terrain and vegetation.

## Queries

- `nearestActive(x, z, radiusTiles)` — nearest active tile for engine targeting.
- `headTileNear(x, z, radiusTiles)` — highest wind-projected active tile; used by aircraft and dozer line placement.
- `activeCountNear` — incident severity.
- `isActiveNear`, `centroid`, `stats`, `activeFireCount`.
- `refreshRoadMask(mask)` — integration hook after road edits.

## Tuning

Fuel profiles live in `FUELS` in `src/sim/fire.ts`. Flame/smolder durations, ignition delay, moisture damping, slope/wind factors, and spot chance are per fuel. The renderer and gameplay share the current constants; changes should be reflected here and in tests.

## Outstanding

- Edge-based fireline strength and crown-fire bypass.
- Multi-hop embers with angular/distance sampling and fuel-bed interactions.
- Firefighter hand crews and handline painting.
- Fire-aware vehicle routing and road closures.
- Diurnal humidity and live fuel moisture model.
- A dedicated spotfire incident UI and perimeter analytics.
