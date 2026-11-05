# Units, Dispatch, and Hydrants

## Status

Implemented: five-unit home fleet plus up to three mutual-aid units, road movement with exact step-size-independent path following, off-road dozer movement with fire avoidance, direct air flight, water/retardant/fireline abilities, tank limits, station/hydrant/helipad refills, helicopter lake dips, hydrant feed, reach-aware engine attack positions, player-drawn dozer lines, burnover exposure and out-of-service time, incident tracking, lookout spot-fire detection, auto dispatch, manual dispatch, direct attack orders, aircraft head targeting, UI snapshots. Outstanding: collision avoidance, persistent lane graph, hand crews, hydrant damage, fire-aware engine routing.

## Fleet

| Unit | Kind | Speed | Payload | Role |
| --- | --- | --- | --- | --- |
| Engine 7 | firetruck | 7.2 m/s | 4,000 L | Road-bound water attack, hydrant feed |
| Engine 12 | firetruck | 7.2 m/s | 4,000 L | Road-bound water attack, hydrant feed |
| Dozer 3 | dozer | 3.3 m/s | — | Off-road fireline cuts |
| Helicopter 1 | helicopter | 18 m/s | 1,400 L | Water drop at downwind head, lake dips |
| Tanker 9 | tanker | 26 m/s | 6,000 L | Perpendicular retardant line |

Per-kind numbers live in `UNIT_SPECS` (`src/sim/units.ts`). Ground units spawn on the station road. Air units spawn above the helipad. All units start full and become available to dispatch when idle.

### Mutual aid

The fleet panel offers mutual-aid units for budget (`MUTUAL_AID_COST`: engine $320, dozer $240, helicopter $420), at most `MUTUAL_AID_LIMIT = 3` per shift. A unit arrives `MUTUAL_AID_ETA = 20 s` after the request. Call signs are reserved at request time (`Engine 21`, `Engine 33`, `Dozer 8`, `Helicopter 4`, …). `Fleet.addUnit` parks ground units on the first road tile at least two steps from the station tile that no other ground unit uses, and aircraft in the next helipad slot.

## Unit states

`idle | moving | holding | toIncident | attacking | refilling | returning | cutting`

- `idle` — at home or a safe position; auto-dispatch may claim it if payload is sufficient and it is in service.
- `moving` / `holding` — manual order; auto-dispatch does not claim holding units.
- `toIncident` — routing toward the assigned incident.
- `attacking` — engine spraying water at wildfire within hose reach.
- `refilling` — hydrant, station, helipad, or (helicopter) lake refill.
- `returning` — returning home, or the fallback when an incident is resolved.
- `cutting` — dozer driving to, or cutting, a line.

## Ground movement

- Fire engines use the road graph (`RoadNetwork.findPath`) and a right-side lane offset of 0.24 world units. The lane offset of each waypoint comes from the path segment that leads into it, never from the unit's position.
- Each step spends the unit's full travel distance (`speed * dt`) and passes through as many waypoints as it covers, so arrival is exact at any step size. (An earlier rule advanced only within 0.18 units of a position-dependent target, which trapped engines orbiting a waypoint at 2×/4× speed.)
- Dozers use an off-road A* plan (`World.findOffroadPath`) that avoids water, buildings, and burning tiles when a clear route exists. While moving off-road on a manual order they clear a narrow line under themselves.
- Returns route to the unit's spawn/home point. Engines use the road graph; dozers plan off-road home, avoiding burning tiles when possible. Planning starts from the nearest dry tile if the unit is standing in water. If no route exists, the unit shows "No route home" and retries every 2 s.
- Idle ground units glide the last stretch onto their exact parking spot.
- Units with no tank (dozers) never enter `refilling`; arriving home makes them `idle`.

### Engine attack positions

`attackPositions` scans road tiles within 26 tiles of the incident. A tile qualifies if wildfire lies within hose reach (`HOSE_RANGE = 12.5` world units, measured from the tile centre with a small lane margin). Candidates are ranked by distance to the flames, burning before smoldering (+3 for smoldering), a hydrant alongside (−2.5), flames within 6 tiles of the downwind head (−1.5), and drive distance (×0.08 per tile). The unit-independent ranking is cached per incident for one simulated second. The engine routes to the best reachable candidate and switches to `attacking` as soon as wildfire is within hose reach. If no road tile reaches the fire, the engine reports "no road within hose reach" and returns home. `canReach` uses the same test, so auto-dispatch does not send engines to fires they cannot touch (falling back to plain road access within 6 tiles only while nothing is burning near the incident).

## Air movement

- Aircraft fly directly in XZ at a cruise offset above the sampled terrain (13 m heli, 19 m tanker).
- Aircraft target the incident's downwind wildfire head, not just the nearest flame.
- Helicopter: one drop per sortie, 6.6-tile radius water application. After the drop it refills at the nearest open water if that is closer than 90% of the helipad distance: it flies there, sinks to 2.6 m above the lake, and fills at 700 L/s before re-attacking.
- Tanker: lays a 24-tile long, 5.2-world-unit wide retardant line perpendicular to wind through the head.
- Both return to the helipad, refill, and re-attack if the incident is still unresolved.

## Dozer lines

- **Automatic** (auto-dispatch or incident assignment): the line is centred 3.5 world units downwind of the wildfire head, perpendicular to wind, with a half-length of `11 + severity * 0.28` clamped to 24. The cut follows an off-road A* path between the endpoints, so it bends around water and structures. The dozer returns home afterwards.
- **Player-drawn** (Dozer line tool, `L`): `Fleet.orderLine(selectedId, start, end)` uses the selected dozer if it is one, otherwise the nearest in-service dozer (busy dozers are penalised). The cut path avoids burning tiles and is limited to 60 tiles. The dozer drives off-road to the start, cuts to the end, and holds there ("Line complete — holding") ready for the next order.
- Cutting clears a ~2-world-unit-radius band every 0.18 s at 85% of travel speed. Cleared tiles are permanent firebreaks.

## Crew safety: burnovers

Ground units standing on a burning or igniting tile accumulate `exposure` at `0.85 × (0.5 + heat)` per second and recover at 0.3/s elsewhere. At 1.0 the crew pulls out: the unit drops its task, returns home, and is out of service for 25 s (no orders, not eligible for dispatch). Aircraft are immune. The HUD shows heat stress on the selected unit and flags units above 25%.

## Refilling and hydrants

- Engines spray 62 L/s. Hydrant-fed engines do not drain their tank and get 1.15× suppression power.
- When empty, an engine chooses the nearest of the six closest hydrants that has a valid road path from its current road tile. If it finishes its route without reaching the hydrant, it falls back to the station.
- Hydrant refill rate: 620 L/s. Station refill uses the same pool.
- Aircraft refill at the helipad (heli 900 L/s, tanker 1,200 L/s); helicopters may dip from the lake instead (above).
- The selected-unit HUD reports hydrant feed; a cyan line connects the unit to the source.

## Incidents

- `IncidentSystem.createAt(tx, tz, source)` merges ignitions within 16 world units. Sources: `lightning`, `manual`, `spot`.
- Five times a second, active incidents track the nearest burning or smoldering wildfire within 18 tiles (controlled backburns are ignored), severity (`activeCountNear(..., 11, QUERY_WILD)`), assigned ids, and a quiet timer.
- An incident resolves after 6 s with no wildfire within 18 tiles, then releases its assigned units and calls `onResolved` (the game pays the containment bonus and names the sector).
- **Lookout:** every 2 s the system looks for a burning wildfire tile that no active incident is within 18 tiles of, and opens a `spot` incident there (`onSpotDetected`). This catches escaped embers and backburns that ran past their control budget.
- Manual ignition and scripted lightning create incidents. Direct attack orders reuse or create an incident.
- Assigned-unit bookkeeping prunes in place each step (no per-step allocation).

## Dispatch

Auto dispatch runs every 1.15 s while enabled:

1. Sort unresolved incidents by severity.
2. Empty incident: send a reachable engine if one exists, otherwise an aircraft.
3. No engine on a severity ≥ 6 incident: try to add one.
4. No aircraft on a severity ≥ 12 incident: try to add one.
5. No dozer on a severity ≥ 28 incident: try to add one.
6. No engine assigned and none can reach the fire by road: add aircraft until two are on it (severity ≥ 3), and the dozer at severity ≥ 10. These fires are air and dozer work.
7. Cap at four units per incident.

Eligibility: idle, in service, sufficient payload, and (for engines) a road connection (`RoadNetwork.connected`) to a tile within hose reach of the fire. Manual dispatch forces the same best-available policy. Direct orders bypass auto dispatch until the incident resolves or the unit is recalled.

## UI actions

- Select a unit in the world or in the fleet list; `Tab` cycles units and clicking a selected unit's card again centres the camera on it.
- Right click to move; right click a burning tile to attack.
- Incident card **DISPATCH** adds a unit.
- Selected unit panel: **Attack nearest** (dozers: **Draw line**), **Return to base**, **Hold**.
- Fleet panel: **Mutual aid** buttons with cost, remaining count, and pending ETAs.

## Events

`Fleet.onEvent(event, x, z)` reports `waterDrop`, `retardant`, `dip`, `burnover`, and `lineDone` so the game can play sound and shake the camera.

## Outstanding

- No inter-vehicle collision avoidance or queuing; units can pass through each other.
- No persistent lane graph or multi-intersection civilian traffic.
- No unit health beyond burnover exposure, no crew fatigue, no hydrant damage.
- Engines do not route around burning roadside fuel; dozers do.
