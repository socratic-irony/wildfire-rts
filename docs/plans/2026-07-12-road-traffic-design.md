# Road Traffic Reliability Design

## Outcome

Roads form deterministic, visible drivable networks. Visible ground vehicles remain on their road paths, maintain spacing across closed-loop seams, stop before intersections, queue fairly, enter one at a time, and do not enter when their exit is occupied. Browser diagnostics expose enough traffic state to verify those claims against screenshots.

## Current Failure Modes

- Road masks, rendered midlines, follower paths, and intersection metadata are rebuilt separately and can disagree.
- Closed-path intersection math treats every point before an intersection as already far past it, so control releases before the stop line.
- The stop zone is shorter than the braking distance at normal road speed, allowing overshoot.
- Leader spacing ignores the closed-loop seam, so the last vehicle has no leader and can overlap the first.
- Exit-space probing only checks vehicles on the same path, not cross traffic occupying the outbound conflict area.
- Intersection state is not exposed to deterministic browser tests, and the existing audit does not exercise simultaneous arrival, FIFO release, or long-run collision clearance.
- A particle ribbon shader injects UV animation code without declaring the required varyings/uniforms, producing invalid WebGL programs during every browser audit.

## Approaches Considered

### Selected: Shared traffic controller over smoothed road paths

Keep `RoadsVisual` and `Path2D`, make intersection metadata stable, and make `IntersectionManager` the single authority for visible Frenet followers. Add circular-distance-safe approach state, explicit queue/occupant telemetry, braking-distance caps, spatial spillback probes, and closed-loop leader handling.

This is reversible, testable in isolation, and preserves dispatch/fire integrations. It also fixes the player-visible fleet rather than expanding the deprecated instanced simulation.

### Rejected for this change: Full lane graph and route switching

Split every centerline at every intersection into directed lane edges, synthesize turn splines, and route vehicles across the graph. This is the correct future architecture for arbitrary destination routing, but it would replace follower orders, dispatch routeability, procedural seeding, and road drawing at once. That blast radius is too high for a reliability pass without first stabilizing intersection contracts.

### Rejected: Drive directly on the raster road mask

Use road tiles as graph nodes and move all vehicles cell-to-cell. This would simplify connectivity but regress smooth motion, terrain-aligned orientation, curvature speed control, visual lane placement, and the established Frenet interaction model.

## Architecture

`RoadsVisual` continues to convert grid polylines into smoothed world-space midlines and intersection positions. `rebuildPath2Ds` converts those midlines once into `Path2D` instances plus per-path intersection records. `IntersectionManager` registers every follower against those records and owns the lifecycle from approach through clearance.

The frame update has three ordered phases per road path:

1. Assign circular leader gaps so all vehicles, including the seam pair, receive a leader constraint.
2. Apply intersection speed caps and grants before motion.
3. Advance followers, then release intersection occupancy only after the rear-clear distance.

Traffic state is independent of rendering. Rendering consumes follower transforms and shows a yield indicator while a stop/creep cap is active. Browser state reports intersection queues, occupant IDs, follower traffic phase, and minimum observed spacing.

## Intersection Contract

- Detection begins far enough upstream to stop from the configured road speed under the follower brake limit.
- A braking envelope caps speed by `sqrt(2 * brake * remainingDistance)`.
- Each approach queues once. Queue order is deterministic by full-stop arrival sequence, then follower ID.
- A follower must remain fully stopped for the minimum stop time before requesting entry.
- Only the queue front may be granted.
- One occupant owns an intersection until it travels the configured clear distance beyond the crossing.
- Entry is denied when any other ground follower is inside the outbound clearance radius.
- Closed-loop distance comparisons use signed forward arc distance and never confuse “ahead” with “already cleared.”
- Reconfiguration and follower clearing release stale queues and occupants.

## Road and Vehicle Presentation

- Road surfaces, shoulders, center dashes, and intersection pads remain terrain-hugging and double-sided.
- Intersection pads are rendered above road ribbons to hide overlap seams.
- Ground traffic receives a consistent right-side lane offset small enough to remain on the current two-lane ribbon.
- Vehicles preserve smooth yaw, grade response, and curvature speed limits.
- The ribbon shader fix removes WebGL program errors that can suppress visible effects or flood diagnostics.

## Error Handling and Performance

- All path-distance math guards zero-length paths.
- Intersection registration deduplicates repeated records from self-crossings.
- Hot traffic updates reuse registered state and do not scan road geometry.
- Spillback checks scan the small active follower fleet; this remains bounded by the existing fleet cap and can later move to a spatial index.
- Browser assertions fail on page errors and WebGL shader compilation errors.

## Testing

Unit tests cover closed-loop approach math, full-stop gating, FIFO order, occupancy clearance, spillback denial, and seam spacing. Road tests cover self-crossing intersection detection and stable deduplication. Shader tests cover the presence of declarations when UV animation is injected.

The live test loop adds a deterministic traffic scenario with controlled followers on a crossing network. It checks queue buildup, one-at-a-time grants, eventual progress for every queued vehicle, minimum separation, no non-finite transforms, and no browser console errors. A visible stopped-car contention screenshot and the full audit's broader gameplay screenshots are visually inspected; post-clearance is asserted from deterministic state rather than an unreliable long-fast-forward SwiftShader readback.

## Deferred Work

- Directed lane graph routing and vehicle turn choice at intersections.
- Multiple compatible simultaneous movements through conflict-zone tokens.
- Road classes, signalized controls, and priority/yield roads.
