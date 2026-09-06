# Vehicles Spec (v0.3) - Behaviors & Abilities

## Status

### ✅ Implemented
- Dual vehicle architecture: authoritative Frenet `PathFollower` vehicles for player-visible traffic plus instanced `VehiclesManager` agents retained for legacy grid tests/testbeds, particles, and abilities
- `VehiclesManager` particle/light FX and water spray integration (`updateExternalFx`); its disconnected private intersection-queue prototype has been removed
- Menubar and debug tooling to spawn/clear followers, toggle move modes, and sync spacing parameters
- Per-type instanced meshes, vehicle counts, and ability hooks (spray water, landing zones)
- Procedural road loops (figure-8 by default) seeded at boot/regenerate; follower vehicles auto-spawn on seeded paths
- Click-select PathFollower vehicles and issue move orders along the road network (neon green selection box)
- Bulldozers (yellow) can accept off-road move orders; firetrucks (red) remain road-only
- **Voxel mesh overhaul + civilian traffic (2026-06-09)**: multi-part voxel builds for every type in `voxelMeshes.ts` (light bar + railed ladder on the firetruck, dozer tracks, spinning `mainRotor` heli group, tanker wings/nacelles, firefighter figure). Civilians come in four styles (sedan, pickup, van, hatchback) with a seeded 8-color palette; boot fleet is 1 firetruck + 1 bulldozer + 3 civilians per road loop. Covered by `civilian-traffic` audit scenario and mesh unit tests.
- **Vehicle model fidelity pass (2026-09-05)**: retained the merged low-poly resource model while adding chamfered body/cab shells, inset front/side glazing, outer-face wheel hubs and arches, bumpers/grilles/lights, firetruck compartments/reel/hose equipment, dozer tread rollers and hydraulic details, aircraft cockpit/tank/engine detail, and firefighter reflective gear. Named animation/test hooks (`ladder`, `blade`, `rotor`, `skid`, `wings`, `tailFin`, `helmet`, `lightbar`, `mainRotor`, `yieldIndicator`) remain intact; `src/vehicles/__tests__/meshes.test.ts` covers hooks, material detail buckets, wheel-hub placement, and resource-count ceilings.
- **Aircraft roles (2026-06-09)**: helicopters and airplanes are spawnable followers that fly directly to any target at cruise altitude (10 m / 16 m) via the airborne branch in `followerOrders.ts`; helicopters drop water, airplanes drop a retardant line along their flight direction plus a cooling water component. Firefighters walk off-road at type speed. Dispatch assignment is routeability-aware (`canService` in `dispatch/cost.ts`) so off-road fires go to aircraft instead of starving on an unroutable truck. Covered by the `aircraft-drops` audit scenario.
- **Road traffic reliability (2026-07-12)**: visible Frenet followers now share deterministic batch intersection arbitration, closed-loop seam spacing, braking-distance approach caps, full-stop FIFO queues, occupant/clearance gating, and spillback checks. Vehicles ride above one depth-tested asphalt ribbon and render after its overlays; stopped/creeping vehicles show an above-road gold yield ring. Covered by focused unit tests and the `traffic-intersection` browser audit.
- **Hydrant-supplied ground suppression (2026-09-05)**: dispatched firetrucks and firefighters can draw directly from an active roadside hydrant within a bounded 6 m reach after their onboard water is exhausted; aircraft remain tank-limited. Refill targets are source-id revalidated, and the selected-unit HUD plus cyan connection line expose en-route/refilling/connected/no-source states. Covered by focused hydrant/HUD tests and the `hydrant-ground-supply` browser fixture.
- **Render-only state preservation (2026-09-06)**: zero-time updates preserve suppression assignments, hydrant supply, and payload/logistics state; the ground-supply browser regression verifies both tank-fed and connected redraws.
- **Open-path endpoint dispatch (2026-09-05)**: a road-bound follower spawned at the terminal endpoint can leave that endpoint when a dispatch target projects behind it; the target-distance logic now completes the order instead of freezing the unit at the path end. Covered by the `PathFollower` regression test.

### ⏳ Outstanding
- Extend implemented local civilian left/through/right turns into destination routing across multiple intersections with a persistent directed lane graph
- Reconcile or retire the deprecated grid-agent traffic stack in `VehiclesManager`; the player-visible Frenet stack is authoritative
- Expand intersection control with compatible movement/conflict tokens, signals, or priority roads if higher throughput is needed
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
- Auto-seeded procedural road loops at startup/regenerate plus menubar hooks to spawn/clear vehicles; fewer default spawns (1 per road)
- Visible `PathFollower` four-way-stop intersection management to avoid collisions
- Stable physical crossing metadata: duplicate segment hits merge into one intersection ID, self-crossings retain both arc occurrences, and simple endpoint joins are excluded
- Road visuals: one depth-tested, terrain-hugging ribbon with dashed center stripe, dusty shoulders that blend into terrain, and polygon offset to avoid z-fighting
- Road building: cost field includes aggressive slope/grade penalties with hard blocks for steep tiles; turn penalty biases A* to reduce sharp curves and favour straight, level alignments
- Unit tests cover road A* pathfinding, terrain cost normalization, and vehicle ability plumbing


Goals

- Fun, readable vehicle motion that follows player-drawn roads while aircraft can traverse freely.
- Stable performance on long roads and many agents; no frame hitches on spawn or movement.
- Clear hooks for future unit abilities (spray water, drop retardant, etc.).

Coord System & Timing

- World XZ plane in meters; height from heightmap sample in meters.
- Grid-based roads snap to tile centres with orthogonal 10° turns (diagonals disabled for angular routing).
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
  - Visible road followers use a terrain-normal surface offset above the raised asphalt plus a small right-side lane offset, preventing road overlays from hiding vehicle bodies.

Roads (Visual + Mask)

- Visual
  - One Catmull–Rom-smoothed, depth-tested asphalt ribbon with a 3-column cross-section (L/M/R); diagnostics never add another filled production surface.
  - Shoulders: translucent dusty bands outside road.
  - Center stripe: dashed gray quads along midline.
  - Vertices offset along terrain normal; polygon offset to avoid z-fighting.
- Mask
  - Rasterized grid mask marks road tiles; used by vehicles A* and can integrate with fire grid (e.g., set urban fuel).
- Procedural
  - Boot/regenerate uses procedural loops to ensure roads exist on fresh terrain; loops are reprojected to the new heightmap before followers spawn.

Path Planning (Road Building)

- Cost field = base + elevation (WE) + slope (WS) − valley (WV) + turn penalty.
- Hard block: tiles above slope threshold (e.g., tanθ > ~0.7, ~35°).
- Turn penalty biases straighter solutions; diagonals are disabled to keep 10° (90°) angular segments.

UI

- Debug controls:
  - Roads: toggle placement On/Off; Clear roads.
  - Vehicles: Spawn at camera vicinity; Move mode On/Off (click sets shared destination); Clear.
  - Selected-unit HUD: shows onboard fuel/water, assignment, and hydrant supply state; a cyan line appears while a ground unit is connected or refilling.

Performance Targets

- ≤ 0.5 ms/update for 100 vehicles on typical roads.
- No stutters on first spawn or after long road placement.

## Outstanding Focus Areas

- Civilian left/through/right selection and continuous cubic turn paths are implemented for connected intersection metadata; canonical reverse road continuations preserve transformed intersections and same-direction leader grouping. Multi-intersection destination routing and persistent lane-graph storage remain future work.
- Voxel part merging (2026-08): unreferenced decorative boxes now merge at build time into a few multi-material meshes per vehicle (`collapseParts` in `voxelMeshes.ts` — civilians drop to body+wheel+yield ring; service vehicles keep their named hooks). Remaining draw-call work is limited to the hook parts themselves.
- The deprecated grid-agent `VehiclesManager` no longer carries disconnected intersection fields; visible gameplay traffic uses the authoritative `IntersectionManager` until the remaining grid layer is retired.
- Reintroduce road-midline projection with spatial indexing to keep followers pinned to centerlines and smooth yaw through tight curves.
- Expand the speed model to factor in grade, curvature, and road class, and add lane/offset support for wider roads.
- Improve collision spacing for long convoys (lane-based offsets, platooning heuristics) beyond the current leader-follow spacing.
- Upgrade siren animation fidelity and dust/water emitter presentation; the core helicopter/airplane/firefighter geometry pass is implemented, while future work may add richer animated sub-parts without changing the named-hook contract.
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

### Implementation Notes
- **Particle Systems**: `InstancedParticleSystem` modifies geometry attributes for shader effects. When multiple systems share a base geometry (e.g., `IcosahedronGeometry`), the geometry must be cloned for each system to prevent attribute conflicts and WebGL errors (e.g., instance count mismatches).
