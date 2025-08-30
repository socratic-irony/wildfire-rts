# Vehicles Spec (v0.1)

Status (current)

- Implemented: instanced vehicles with a simple grid-follow model constrained to road tiles, terrain-aligned pose (pitch/roll from terrain normal, yaw from path direction), spawn near nearest road, road-only A* for explicit destinations, and an auto-follow mode that advances along connected road tiles. UI hooks to spawn/move/clear. Vehicles render reliably after rollback to terrain-only alignment.
- Road visuals: adaptive smoothed ribbon that hugs terrain via normal offset, dusty shoulders, dashed center stripe; polygon offset to avoid z-fighting.
- Road building: cost field includes slope penalty and hard block for steep tiles; turn penalty biases A* to reduce sharp curves; rasterized road mask integrates with fire grid.
- Reverted (pending rework): projecting vehicle position/orientation directly to road midline each frame (caused freezes under some conditions).

Goals

- Fun, readable vehicle motion that strictly follows player-drawn roads.
- Stable performance on long roads and many agents; no frame hitches on spawn or movement.
- Clear hooks for future unit abilities (spray water, drop retardant, etc.).

Coord System & Timing

- World XZ plane in meters; height from heightmap sample in meters.
- Grid-based roads on tile centers, optionally with diagonal connections.
- Fixed simulation loop runs per-frame; vehicles update with `dt` from render loop.

Data Model

- Agent
  - pos: world position (Vector3)
  - grid: current grid cell (x, z)
  - path: array of grid cells to follow
  - pathIdx: current segment index
  - speedTilesPerSec: speed in tiles/s
  - autoFollowRoad: boolean (walks connected road neighbors)
  - prev?: previous grid cell (to avoid immediate backtrack)
- Manager
  - hm: Heightmap, roadMask: RoadMask, terrain: TerrainCost
  - inst: InstancedMesh for rendering
  - methods: spawnAt, setDestination, setDestinationAll, update, clear

API Surface (Engine ↔ Game)

- `new VehiclesManager(hm, terrainCost, roadMask, maxAgents)`
- `spawnAt(gx, gz)` — spawn near nearest road cell
- `setDestination(i, gx, gz)` — A* path constrained to road tiles only
- `setDestinationAll(gx, gz)` — broadcast destination
- `update(dt)` — move agents and update instance transforms
- `clear()` — remove all agents
- `group` — Three.js object to add to scene

Movement & Orientation

- Modes
  - Auto-follow: if no explicit destination, step to a connected road neighbor, preferring straight-through options.
  - Path mode: follow road-only A* path from start road tile to goal road tile.
- Step integration
  - Interpolate from current to next grid center at `speedTilesPerSec * dt`.
  - Y altitude = `heightmap.sample(x, z)` + small offset.
- Pose
  - Up vector = terrain normal at (x, z) via finite differences.
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

- Midline projection (safe): Reintroduce vehicle projection/orientation to road midline using a spatial index (grid or BVH) per road to avoid O(N·M) scans. Maintain per-agent path+segment hints for O(1) neighborhood queries. Guard against degenerate segments (zero length).
- Intersections & branching: Pin each agent to the intended polyline; resolve choice at intersections; avoid snapping to parallel/nearby roads.
- Steering/yaw smoothing: Reapply forward vector smoothing (lerp/slerp) once projection is stable to get visually pleasing steering through curves.
- Speed model: Modulate speed by grade, curvature, and road class; cap speed on steep slopes and sharp turns.
- Collision/spacing: Simple follow-the-leader or separation to avoid overlapping agents on same road.
- Laneing/width: Optional lanes and side-of-road offsets; passability width vs terrain slope.
- Robust spawn: Ensure spawn locks to the intended road polyline and valid segment; fallback if none.
- Serialization: Save/load agent states, destinations, and road network.
- Telemetry/Debug: Add per-frame timings for road projection (when reintroduced), active agents, and path lengths; draw path overlays for diagnostics.

Acceptance Criteria (v0.1)

- Spawned vehicle appears immediately and follows connected road tiles without freezing.
- Explicit destination along the same road results in movement that remains on road tiles only.
- Vehicle pose tilts with terrain; yaw aligns with the road segment direction.
- Drawing roads over steep terrain yields fewer sharp kinks (turn penalty) and avoids very steep tiles.
- Smooth frame time with 20–50 vehicles on 1–3 long roads; no long stalls on spawn.

Roadmap (next)

1) Safe midline projector + per-road spatial index; re-enable road-hugging pose.
2) Intersection routing + path pinning to a specific polyline.
3) Basic spacing/avoidance and speed modulation by grade/curvature.
4) Save/load of vehicles and roads; debug overlay with counts/timings.
5) Unit abilities (water/retardant) integrated with fire grid.

