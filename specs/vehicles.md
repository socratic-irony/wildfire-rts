# Vehicles Spec (v0.3) - Behaviors & Abilities

## Status

### ✅ Implemented
- Dual vehicle architecture: Frenet `PathFollower` vehicles for player spawns plus instanced `VehiclesManager` agents for mass simulation, particles, and abilities
- `VehiclesManager` four-way-stop intersection queues, particle/light FX, and water spray integration (`updateExternalFx`)
- Menubar and debug tooling to spawn/clear followers, toggle move modes, and sync spacing parameters
- Per-type instanced meshes, vehicle counts, and ability hooks (spray water, landing zones)

### ⏳ Outstanding
- Share intersection/spacing logic with `PathFollower` controllers and reconcile duplicate movement stacks
- Reintroduce robust road-midline projection with spatial indexing and curvature-aware steering
- Expand geometry/visual polish for helicopter/airplane/firefighter models and siren/lighting fidelity

> See `docs/vehicles/dual_architecture.md` for how the Frenet followers and `VehiclesManager` exchange FX data.

## Completed Milestones

### ✅ v0.3 Feature Highlights
- Vehicle-specific speed/handling (bulldozers slower, aircraft faster with obstacle-free flight)
- Firetruck water spraying that wets and cools nearby fire tiles
- Optional landing zones for aircraft via `addLandingZone`
- Particle effects for dust and water spray, now driven for PathFollower vehicles via `VehiclesManager.updateExternalFx`

### ✅ v0.2 Foundation
- Six vehicle types (car, firetruck, bulldozer, helicopter, airplane, firefighter) with per-type instanced meshes and colors
- Random vehicle spawning with type variety and per-type counts
- Extended API for explicit vehicle type selection

## Runtime Snapshot

- Instanced vehicles with grid-follow fallback constrained to road tiles, terrain-aligned pose (pitch/roll from terrain normal, yaw from path direction)
- Auto-seeded demo loops at startup plus menubar hooks to spawn/move/clear vehicles
- Four-way-stop intersection management to avoid collisions
- Road visuals: smoothed ribbon with dashed center stripe, dusty shoulders, polygon offset to avoid z-fighting
- Road building: cost field includes slope penalty and hard blocks for steep tiles; turn penalty biases A* to reduce sharp curves
- Unit tests cover road A* pathfinding, terrain cost normalization, and vehicle ability plumbing


Goals

- Fun, readable vehicle motion that follows player-drawn roads while aircraft can traverse freely.
- Stable performance on long roads and many agents; no frame hitches on spawn or movement.
- Clear hooks for future unit abilities (spray water, drop retardant, etc.).

Coord System & Timing

- World XZ plane in meters; height from heightmap sample in meters.
- Grid-based roads on tile centers, optionally with diagonal connections.
- Fixed simulation loop runs per-frame; vehicles update with `dt` from render loop.

Data Model

- Agent
  - **vehicleType: VehicleType** — enum specifying vehicle appearance/behavior
  - pos: world position (Vector3)
  - grid: current grid cell (x, z)
  - path: array of grid cells to follow
  - pathIdx: current segment index
  - speedTilesPerSec: speed in tiles/s
  - autoFollowRoad: boolean (walks connected road neighbors)
  - prev?: previous grid cell (to avoid immediate backtrack)
  - altitude?: height offset for airborne vehicles
- Manager
  - hm: Heightmap, roadMask: RoadMask, terrain: TerrainCost
  - **vehicleInstances: Map<VehicleType, InstancedMesh>** — separate mesh per vehicle type
  - **vehicleCounts: Map<VehicleType, number>** — tracking instances per type
  - landingZones: array of grid locations available for aircraft
  - methods: spawnAt, setDestination, setDestinationAll, update, sprayWater, addLandingZone, clear, **updateExternalFx** (hooks PathFollower vehicles into particle/light FX)
- `VehicleFxState` (PathFollower bridge)
  - id: unique per vehicle, reused while active
  - pos/forward/up/right: world-frame basis vectors copied from follower matrix
  - speed: current forward speed (m/s)
  - type: VehicleType (drives headlights/sirens)
  - sprayingWater?: boolean flag enabling hose particles
  - siren?: boolean flag to toggle roof flashers

API Surface (Engine ↔ Game)

- `new VehiclesManager(hm, terrainCost, roadMask, maxAgents, roadsVis?, fireGrid?)`
- `spawnAt(gx, gz, vehicleType?)` — spawn near nearest road cell (aircraft ignore roads)
- `setDestination(i, gx, gz)` — road A* for ground vehicles, direct flight for aircraft
- `setDestinationAll(gx, gz)` — broadcast destination
- `sprayWater(i, radius?, intensity?)` — firetruck water suppression
- `addLandingZone(gx, gz)` — register aircraft landing spot
- `update(dt)` — move agents and update instance transforms
- `updateExternalFx(dt, states, opts?)` — per-frame particle/light sync for Frenet PathFollower vehicles using `VehicleFxState`
- `clear()` — remove all agents
- `group` — Three.js object to add to scene

Movement & Orientation

- Modes
  - Auto-follow: if no explicit destination, step to a connected road neighbor, preferring straight-through options.
  - Path mode: follow road-only A* path from start road tile to goal road tile.
  - Aircraft: direct flight between current location and destination/landing zone.
- Step integration
  - Interpolate from current to next grid center at `speedTilesPerSec * dt`.
  - Y altitude = `heightmap.sample(x, z)` + offset + `altitude` for aircraft.
- Pose
  - Up vector = terrain normal at (x, z); aircraft use world up.
  - Forward = direction from current path segment (grid neighbor delta).
  - Right = cross(forward, up); forward reprojected to terrain plane.

Roads (Visual + Mask)

- Visual
  - Smoothed ribbon with adaptive resampling (shorter segments on sharper curves), 3-column cross-section (L/M/R).
  - Shoulders: translucent dusty bands outside road.
  - Center stripe: dashed gray quads along midline.
  - Vertices offset along terrain normal; polygon offset to avoid z-fighting.
- Mask
  - Rasterized grid mask marks road tiles; used by vehicles A* and can integrate with fire grid (e.g., set urban fuel).

Path Planning (Road Building)

- Cost field = base + elevation (WE) + slope (WS) − valley (WV) + turn penalty.
- Hard block: tiles above slope threshold (e.g., tanθ > ~0.7, ~35°).
- Turn penalty biases straighter solutions; diagonals allowed for connectivity.

UI

- Debug controls:
  - Roads: toggle placement On/Off; Clear roads.
  - Vehicles: Spawn at camera vicinity; Move mode On/Off (click sets shared destination); Clear.

Performance Targets

- ≤ 0.5 ms/update for 100 vehicles on typical roads.
- No stutters on first spawn or after long road placement.

## Outstanding Focus Areas

- PathFollower vehicles do not yet consume the `VehiclesManager` intersection queues; share gating logic so both controllers obey the same four-way-stop rules.
- Reintroduce road-midline projection with spatial indexing to keep followers pinned to centerlines and smooth yaw through tight curves.
- Expand the speed model to factor in grade, curvature, and road class, and add lane/offset support for wider roads.
- Improve collision spacing for long convoys (lane-based offsets, platooning heuristics) beyond the current leader-follow spacing.
- Upgrade geometry and VFX fidelity for helicopter/airplane/firefighter meshes, siren lights, and dust/water emitters.
- Extend telemetry/debug overlays with per-frame timings, path visualizations, and intersection queue state.

Acceptance Criteria (v0.3)

**✅ COMPLETED**:
- Firetrucks can spray water to increase wetness on nearby tiles
- Helicopters and airplanes travel directly to destinations and honor optional landing zones
- Vehicle types move at distinct speeds (e.g., bulldozers slower, aircraft faster)

Acceptance Criteria (v0.2)

**✅ COMPLETED**:
- Multiple vehicle types spawn with distinct appearances (colors, sizes)
- Each vehicle type uses separate InstancedMesh for optimal performance
- Random vehicle type selection distributes variety across road network
- All vehicle types follow roads correctly and maintain original movement behavior
- No performance degradation with multiple vehicle types active

**Previous v0.1 Criteria (also maintained)**:
- Spawned vehicle appears immediately and follows connected road tiles without freezing.
- Explicit destination along the same road results in movement that remains on road tiles only.
- Vehicle pose tilts with terrain; yaw aligns with the road segment direction.
- Drawing roads over steep terrain yields fewer sharp kinks (turn penalty) and avoids very steep tiles.
- Smooth frame time with 20–50 vehicles on 1–3 long roads; no long stalls on spawn.

Roadmap (next for handoff agents)

**Ready for parallel development**: The core multi-vehicle architecture is stable and supports independent work on:

1) **Enhanced Geometries**: Improve helicopter (sphere+rotor), airplane (wings), firefighter (stick figure)
2) **Visual Effects**: Animations, particles, lights, trails
3) **Advanced Features**: Safe midline projector, spacing/avoidance, speed modulation
