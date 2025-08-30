Title: Roads, Strict Road Pathing, and Terrain‑Aligned Vehicles

Summary
- Adds a road mask with rasterization and integrates it with the fire grid (road tiles mapped to urban fuel to dampen spread).
- Introduces VehiclesManager with instanced “trucks” that:
  - Spawn onto the nearest road.
  - Immediately auto-follow roads, turning at corners and T-junctions.
  - Support strict road-only A* pathfinding when Move mode is used.
  - Align their orientation to terrain normals (pitch/roll) and face along the movement tangent.
- Extends Debug UI with Vehicles controls (Spawn, Move toggle, Clear).
- Integrates vehicles update into the main loop and wires click handlers.

Changes (high level)
- roads/state.ts: Road mask (create/clear/isRoad), polyline rasterization, and optional fire-grid application.
- vehicles/vehicles.ts: Instanced vehicle manager, road-follow, strict road-only A*, terrain alignment, and frustum-culling fix.
- ui/debug.ts: New Vehicles controls in the panel.
- main.ts: Wires road mask + rasterization on road placement; applies mask to fire; adds VehiclesManager; updates per-frame; adds click handling for Move.

User Flow
1) Toggle Roads On and click two terrain points to draw a road (A* path is built over terrain cost and rendered; mask is rasterized and applied to fire).
2) Click Vehicles → Spawn to place a truck on the nearest road; it will start driving along the road network.
3) Toggle Vehicles → Move: On and click a destination; the truck plans a road-only path and follows it.
4) Vehicles → Clear removes all vehicles.

Implementation Notes
- Vehicles are aligned using terrain normals computed from height gradients and a projected forward direction to create an orthonormal basis.
- InstancedMesh frustum culling is disabled and matrices are forced to update on spawn to avoid visibility issues until the camera moves.
- Road-follow chooses a next neighbor by degree (for initial direction) and then least turning angle relative to incoming direction.

Performance
- Vehicles use InstancedMesh; matrices update per frame only for active instances. Road ribbons reuse a single material.
- Build tested with vite; no regressions observed.

Screenshots / Visuals
- N/A (can attach once remote is configured).

Next Steps (optional)
- Collision/spacing between vehicles.
- Right-click move; better click snapping to nearest road tile and feedback if none found.
- Enforce 4-neighbor only for roads if desired; widen road ribbons; center vehicles on ribbon.

