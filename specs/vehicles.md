# Vehicles Spec (v0.3) - Behaviors & Abilities

## 🎯 STATUS: HANDOFF READY 

**Core multi-vehicle type system with type-specific behaviors is complete and functional.** The architecture now supports 6 vehicle types with per-type speed/handling, airborne movement for aircraft, and fire suppression abilities.

### ✅ COMPLETED v0.3 Features:
- Vehicle-specific speed/handling (bulldozers slower, aircraft faster with obstacle-free flight)
- Firetruck water spraying that wets and cools nearby fire tiles
- Optional landing zones for aircraft via `addLandingZone`

### ✅ COMPLETED v0.2 Features:
- **6 Vehicle Types**: CAR, FIRETRUCK, BULLDOZER, HELICOPTER, AIRPLANE, FIREFIGHTER
- **Separate InstancedMesh per type** for optimal performance
- **Random vehicle spawning** with type variety
- **Distinct colors and basic geometries** for each vehicle type
- **Vehicle type tracking** in manager with counts per type
- **Extended API** to support optional vehicle type specification

---

Status (current - v0.1 base features)

- Implemented: instanced vehicles with a simple grid-follow model constrained to road tiles, terrain-aligned pose (pitch/roll from terrain normal, yaw from path direction), spawn near nearest road, road-only A* for explicit destinations, and an auto-follow mode that advances along connected road tiles. UI hooks to spawn/move/clear. Vehicles render reliably after rollback to terrain-only alignment.
- Demo seeding (vehicles branch): at startup, the main app auto-seeds 1–2 random rectangular road loops and spawns a few vehicles on them so behavior is visible immediately. Clear via debug UI to draw your own roads.
- Update: baseline road-follow now prefers 4-neighbor (N/E/S/W) turns, considering diagonals only when needed, for clearer cornering. Added a small heading “weathervane” debug marker per agent for quick orientation diagnostics.
- Intersection routing: auto-follow uses the road midline tangent to pick the correct branch at crossings, keeping vehicles on their intended road.
- Intersections behave as four-way stops: vehicles queue, pause briefly, and proceed one at a time to avoid collisions.
- Road visuals: adaptive smoothed ribbon that hugs terrain via normal offset, dusty shoulders, dashed center stripe; polygon offset to avoid z-fighting.
- Road building: cost field includes slope penalty and hard block for steep tiles; turn penalty biases A* to reduce sharp curves; rasterized road mask integrates with fire grid.
- Reverted (pending rework): projecting vehicle position/orientation directly to road midline each frame (caused freezes under some conditions).
- Unit tests cover road A* pathfinding (obstacle avoidance and turn penalties) and terrain cost normalization (elevation, slope, valley).
- Testbed page: `vehicles-test.html` runs `src/vehicles_test.ts` with a 32×32 mostly-flat terrain and preset roads:
  - Variants: rectangular loop and figure‑8 (switchable in the debug UI).
  - Behavior: vehicles auto-spawn on the road, immediately moving; yaw aligns with segment direction; pitch/roll align to terrain normal.
  - Purpose: quick manual validation without touching the main app wiring.

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
  - methods: spawnAt, setDestination, setDestinationAll, update, sprayWater, addLandingZone, clear

API Surface (Engine ↔ Game)

- `new VehiclesManager(hm, terrainCost, roadMask, maxAgents, roadsVis?, fireGrid?)`
- `spawnAt(gx, gz, vehicleType?)` — spawn near nearest road cell (aircraft ignore roads)
- `setDestination(i, gx, gz)` — road A* for ground vehicles, direct flight for aircraft
- `setDestinationAll(gx, gz)` — broadcast destination
- `sprayWater(i, radius?, intensity?)` — firetruck water suppression
- `addLandingZone(gx, gz)` — register aircraft landing spot
- `update(dt)` — move agents and update instance transforms
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

 Known Issues / Outstanding Work

## 🎯 HANDOFF READY: Multi-Vehicle System Complete (v0.2)

The foundational multi-vehicle type system is complete and ready for handoff. Future agents can work on:

### Next Chunk 1: Enhanced Vehicle Geometries
- Improve HELICOPTER: sphere body + rotor disk + tail boom
- Improve AIRPLANE: T-shape fuselage with wings and tail
- Improve FIREFIGHTER: three stick figure (head/torso/legs) with visibility outline

### Next Chunk 3: Visual Polish
- Animated rotors for helicopters, smoke trails for aircraft
- Turn signals, headlights, emergency flashers
- Particle effects for dust, water spray, etc.

---

## Previous Outstanding Work (v0.1):

- Midline projection (safe): Reintroduce vehicle projection/orientation to road midline using a spatial index (grid or BVH) per road to avoid O(N·M) scans. Maintain per-agent path+segment hints for O(1) neighborhood queries. Guard against degenerate segments (zero length).
  - Current status: orientation uses midline projection with a gentle lateral nudge; a per-road spatial index and stable segment pinning are next.
- Steering/yaw smoothing: Reapply forward vector smoothing (lerp/slerp) once projection is stable to get visually pleasing steering through curves.
- Speed model: Modulate speed by grade, curvature, and road class; cap speed on steep slopes and sharp turns.
- Collision/spacing: Four-way stop queues reduce intersection collisions; lane-based spacing and smarter convoy behavior remain.
- Laneing/width: Optional lanes and side-of-road offsets; passability width vs terrain slope.
- Robust spawn: Ensure spawn locks to the intended road polyline and valid segment; fallback if none.
- Telemetry/Debug: Add per-frame timings for road projection (when reintroduced), active agents, and path lengths; draw path overlays for diagnostics.

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
