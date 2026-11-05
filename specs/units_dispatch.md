# Units, Dispatch, and Hydrants

## Status

Implemented: five-unit home fleet plus up to three mutual-aid units, road movement with exact step-size-independent path following, off-road dozer movement with fire avoidance, direct air flight, water/retardant/fireline abilities, tank limits, station/hydrant/helipad refills, helicopter lake dips, hydrant feed, reach-aware engine attack positions, player-drawn dozer lines, burnover exposure and out-of-service time, incident tracking, lookout spot-fire detection, per-unit auto dispatch, manual dispatch, direct attack orders, manual refill orders, hydrant refill visuals, aircraft head targeting, UI snapshots. Outstanding: collision avoidance, persistent lane graph, hand crews, hydrant damage, fire-aware engine routing.

## Fleet

| Unit | Kind | Speed | Payload | Role |
| --- | --- | --- | --- | --- |
| Engine 7 | firetruck | 7.2 m/s | 4,000 L | Road-bound water attack, hydrant feed |
| Engine 12 | firetruck | 7.2 m/s | 4,000 L | Road-bound water attack, hydrant feed |
| Dozer 3 | dozer | 3.3 m/s | — | Off-road fireline cuts |
| Helicopter 1 | helicopter | 18 m/s | 1,400 L | Water drop at downwind head, lake dips |
| Tanker 9 | tanker | 26 m/s | 6,000 L | Perpendicular retardant line |

Per-kind numbers live in `UNIT_SPECS` (`src/sim/units.ts`). Ground units park nose to tail along the kerb of the station street, in the lane on the station side, and square up to the kerb once home (`homeHeading`). The first helicopter sits on the helipad; later ones park beside it, away from the station. The air tanker is too large for a town helipad (22 m wingspan), so it works from an **air-tanker base just past the nearest map edge** (`tankerBase`, 18 units out) and is hidden while parked there; its statuses read "tanker base". All units start full and become available to dispatch when idle.

### Models

Vehicles are modelled at the world prop scale (1 unit ≈ 3 m, see `world.md`) with `ModelBuilder`, one merged vertex-coloured mesh per vehicle plus glass/glow layers, separate meshes only for parts that move or flash:

- **Engine**: Type 3 wildland engine on a conventional 4×4 crew cab: hood and grille, bumper turret, white cab roof, windscreen and door glass, mirrors, chrome pump panel, compartment body with roll-up doors, reflective stripe, hose bed, ladder, rear hose reel, chevrons, head/tail lamps, and flashing red/blue light bars front and rear. 8.5 m × 2.5 m.
- **Dozer**: crawler tracks with grousers, rollers and a raised sprocket, engine hood with grille and stack, ROPS cab, angled blade on push arms with lift cylinders, rear ripper, amber beacon.
- **Helicopter**: medium utility helicopter on skids: lofted fuselage and tail boom, cockpit glazing, cabin windows, cowling and exhausts, belly tank with snorkel, fin, stabiliser, nav lights; four-blade main rotor and tail rotor spin, with a faint rotor disc in flight. 16 m rotor.
- **Air tanker**: twin-turboprop high-wing tanker: lofted fuselage, cockpit and cabin windows, red cheat line, belly retardant tank with door seams, tapered wing with dihedral and red tips, nacelles with spinners and four-blade propellers (spinning, with prop discs), main and nose gear, swept fin and tailplane, nav lights. 22 m span.
- Each vehicle has an invisible pick box so the smaller, true-scale models stay easy to click; the selection ring scales per kind.

### Attitude

- Ground vehicles sit on the terrain: pitch comes from the ground height under the front and back of the vehicle and roll from its left and right (`applyTransform`), eased so terrace edges do not jitter. They climb ramps nose-up and lean on cross-slopes, and ride on whichever of the centre or the axle average is higher so wheels never sink at crests.
- Aircraft bank into turns (the tanker up to 0.7 rad, the helicopter 0.4) from their heading rate, and helicopters pitch nose-down with forward speed. Visual only.

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

- Fire engines use the road graph (`RoadNetwork.findPath`) and drive in the right-hand lane, 0.48 world units right of the centreline (a road tile is two one-unit lanes). Earlier code offset to the left of travel; fixed. The lane offset of each waypoint comes from the path segment that leads into it, never from the unit's position.
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
- Both return to base (helipad, or the off-map tanker base), refill, and re-attack if the incident is still unresolved.

## Dozer lines

- **Automatic** (auto-dispatch or incident assignment): the line is centred 3.5 world units downwind of the wildfire head, perpendicular to wind, with a half-length of `11 + severity * 0.28` clamped to 24. The cut follows an off-road A* path between the endpoints, so it bends around water and structures. The dozer returns home afterwards.
- **Player-drawn** (Dozer line tool, `L`): `Fleet.orderLine(selectedId, start, end)` uses the selected dozer if it is one, otherwise the nearest in-service dozer (busy dozers are penalised). The cut path avoids burning tiles and is limited to 60 tiles. The dozer drives off-road to the start, cuts to the end, and holds there ("Line complete — holding") ready for the next order.
- Cutting clears a ~2-world-unit-radius band every 0.18 s at 85% of travel speed. Cleared tiles are permanent firebreaks.

## Crew safety: burnovers

Ground units standing on a burning or igniting tile accumulate `exposure` at `0.85 × (0.5 + heat)` per second and recover at 0.3/s elsewhere. At 1.0 the crew pulls out: the unit drops its task, returns home, and is out of service for 25 s (no orders, not eligible for dispatch). Aircraft are immune. The HUD shows heat stress on the selected unit and flags units above 25%.

## Refilling and hydrants

- Engines spray 62 L/s. Hydrant-fed engines do not drain their tank and get 1.15× suppression power.
- When empty, an engine chooses the nearest of the six closest hydrants that has a valid road path from its current road tile. If it finishes its route without reaching the hydrant, it falls back to the station.
- **Refill** on the selected-unit panel (`Fleet.orderRefill`) sends a unit to top up now: engines to the nearest reachable hydrant (else the station), helicopters to the lake or pad, tankers to the pad. A manual engine that fills at a hydrant holds there ("Full — holding at hydrant"); an auto engine returns to the station as before.
- Making the loop visible: every hydrant has a faint cyan ground ring that brightens while an engine is selected or any engine is below 30%; the hydrant an engine is driving to gets a pulsing ring; an engine filling at a hydrant, or fed by one while it sprays, shows a hose from the hydrant to the truck (pooled meshes, no per-step allocation). The minimap draws hydrants and a dashed line from each refilling engine to its hydrant; the fleet row's water bar pulses cyan while filling. The first two hydrant refills of a shift raise a toast naming the sector (`FleetEvent 'hydrantRefill'`).
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

### Auto or manual, per unit

Every unit carries an `auto` flag (default on), shown as an **AUTO / MANUAL** chip on its fleet row. Auto-dispatch only ever claims units whose flag is on; manual units move only on the player's orders.

- The **ALL AUTO** switch in the fleet panel heading sets every unit, and becomes the default for mutual aid that arrives later (`Fleet.setAllAuto`, `Fleet.autoDefault`). It shows as indeterminate when the fleet is mixed (`Fleet.autoMode`).
- Any direct order (right-click move or attack, **Attack nearest**, **Hold**, **Return to base**, **Refill**, or a player-drawn dozer line) switches that unit to manual, with a toast, so the dispatcher never undoes the order. Flip the chip to hand it back.
- The incident card's **DISPATCH** button is the player choosing "send someone": it uses the same best-available policy over idle units whatever their flag, and does not change any flag.
- An auto unit counts as free when it is `idle`, or `holding` (it was switched back to auto after a manual order left it parked).

Auto dispatch runs every 1.15 s:

1. Sort unresolved incidents by severity.
2. Empty incident: send a reachable engine if one exists, otherwise an aircraft.
3. No engine on a severity ≥ 6 incident: try to add one.
4. No aircraft on a severity ≥ 12 incident: try to add one.
5. No dozer on a severity ≥ 28 incident: try to add one.
6. No engine assigned and none can reach the fire by road: add aircraft until two are on it (severity ≥ 3), and the dozer at severity ≥ 10. These fires are air and dozer work.
7. Cap at four units per incident.

Eligibility: on auto, free (above), in service, sufficient payload, and (for engines) a road connection (`RoadNetwork.connected`) to a tile within hose reach of the fire. Step 6 asks whether an auto engine can reach the fire, so a fire that only manual engines could reach still gets aircraft. Manual dispatch (the card button) forces the same best-available policy over idle units regardless of the flag.

## UI actions

- Select a unit in the world or in the fleet list; `Tab` cycles units and clicking a selected unit's card again centres the camera on it.
- Right click to move; right click a burning tile to attack.
- Incident card **DISPATCH** adds a unit.
- Selected unit panel: **Attack nearest** (dozers: **Draw line**), **Refill** (units with a tank), **Return to base**, **Hold**.
- Fleet list: per-unit **AUTO / MANUAL** chip and **ALL AUTO** master switch.
- Fleet panel: **Mutual aid** buttons with cost, remaining count, and pending ETAs.

## Events

`Fleet.onEvent(event, x, z, unitId?)` reports `waterDrop`, `retardant`, `dip`, `burnover`, `lineDone`, and `hydrantRefill` so the game can play sound, shake the camera, or explain what a unit is doing.

## Outstanding

- No inter-vehicle collision avoidance or queuing; units can pass through each other.
- No persistent lane graph or multi-intersection civilian traffic.
- No unit health beyond burnover exposure, no crew fatigue, no hydrant damage.
- Engines do not route around burning roadside fuel; dozers do.
