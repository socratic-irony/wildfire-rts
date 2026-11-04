# Units, Dispatch, and Hydrants

## Status

Implemented: five-unit fleet, road movement, off-road dozer movement, direct air flight, water/retardant/fireline abilities, tank limits, station and hydrant refills, hydrant feed, incident tracking, auto dispatch, manual dispatch, direct attack orders, aircraft head targeting, UI snapshots. Outstanding: collision avoidance, persistent lane graph, hand crews, hydrant damage, per-unit crew/health.

## Fleet

| Unit | Kind | Speed | Payload | Role |
| --- | --- | --- | --- | --- |
| Engine 7 | firetruck | 7.2 m/s | 4,000 L | Road-bound water attack, hydrant feed |
| Engine 12 | firetruck | 7.2 m/s | 4,000 L | Road-bound water attack, hydrant feed |
| Dozer 3 | dozer | 3.3 m/s | — | Off-road fireline cuts |
| Helicopter 1 | helicopter | 18 m/s | 1,400 L | Water drop at downwind head |
| Tanker 9 | tanker | 26 m/s | 6,000 L | Perpendicular retardant line |

Ground units spawn on the station road. Air units spawn above the helipad. All units start full and become available to dispatch when idle.

## Unit states

`idle | moving | holding | toIncident | attacking | refilling | returning | cutting`

- `idle` — at home or a safe position; auto-dispatch may claim it if payload is sufficient.
- `moving` / `holding` — manual order; auto-dispatch does not claim holding units.
- `toIncident` — routing toward the assigned incident.
- `attacking` — engine spraying water at the nearest active tile.
- `refilling` — hydrant or station/helipad refill.
- `returning` — returning home, or the fallback when an incident is resolved.
- `cutting` — dozer executing a line task.

## Ground movement

- Fire engines use the road graph (`RoadNetwork.findPath`) and a right-side lane offset of 0.24 world units.
- Engines select a road tile within 6 tiles of the fire, then attack when an active tile is within `HOSE_RANGE = 12.5` world units.
- Dozers use an off-road A* plan (`World.findOffroadPath`) that avoids water and buildings. While moving off-road they clear a line under themselves.
- Returns route to the unit's spawn/home tile.

## Air movement

- Aircraft fly directly in XZ at a cruise offset above the sampled terrain (13 m heli, 19 m tanker).
- Aircraft target the incident's downwind head, not just the nearest flame.
- Helicopter: one drop per sortie, 6.6-tile radius water application.
- Tanker: lays a 24-tile long, 5.2-world-unit wide retardant line perpendicular to wind through the head.
- Both return to the helipad, refill, and re-attack if the incident is still unresolved.

## Dozer fireline

- The dozer selects a line centered 3.5 world units downwind of the fire head, perpendicular to wind, with a half-length of `11 + severity * 0.28` clamped to 24.
- It plans an off-road route to the line start, then drives to the other endpoint clearing a 2.1-world-unit fireline and emitting dust.
- Manual off-road moves also cut line.
- Cleared tiles are permanent firebreaks.

## Refilling and hydrants

- Engines spray 62 L/s. Hydrant-fed engines do not drain their tank and get 1.15× suppression power.
- When empty, an engine chooses the nearest of the six closest hydrants that has a valid road path from its current road tile.
- Hydrant refill rate: 620 L/s. Station refill uses the same pool.
- Aircraft refill at the helipad (heli 900 L/s, tanker 1,200 L/s).
- The selected-unit HUD reports hydrant feed; a cyan line connects the unit to the source.

## Incidents

- `IncidentSystem.createAt(tx, tz, source)` merges ignitions within 16 world units.
- Active incidents track the nearest active fire, severity (`activeCountNear(..., 11)`), assigned ids, and a quiet timer.
- An incident resolves after 6 s with no active fire within 18 tiles, then releases its assigned units and notifies the scenario.
- Manual ignition and scripted lightning create incidents. Direct attack orders reuse or create an incident.

## Dispatch

Auto dispatch runs every 1.15 s while enabled:

1. Sort unresolved incidents by severity.
2. Empty incident: send a reachable engine if one exists, otherwise an aircraft.
3. No engine on a severity ≥ 6 incident: try to add one.
4. No aircraft on a severity ≥ 12 incident: try to add one.
5. No dozer on a severity ≥ 28 incident: try to add one.
6. Cap at three units per incident.

Eligibility: idle, sufficient payload, and (for engines) a connected road path to a road tile near the incident. Manual dispatch forces the same best-available policy. Direct orders bypass auto dispatch until the incident resolves or the unit is recalled.

## UI actions

- Select a unit in the world or in the fleet list.
- Right click to move; right click a burning tile to attack.
- Incident card **DISPATCH** adds a unit.
- Selected unit panel: **Attack nearest**, **Return to base**, **Hold**.

## Outstanding

- No inter-vehicle collision avoidance or queuing; units can pass through each other.
- No persistent lane graph or multi-intersection civilian traffic.
- No unit health, crew, fatigue, or hydrant damage.
- Fire-aware routing and road closure decisions are not implemented.
