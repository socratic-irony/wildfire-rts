Intersection Logic Spec (Vehicles on Procedural Roads)

Status

- ✅ Implemented: each registered intersection now runs an all-way stop controller. Vehicles detect upcoming crossings, slow to a stop line, queue, wait one second after coming to rest, and then enter in first-come order while others remain halted. Visual pads mark every intersection so players can see where stops occur.
- 🚧 Next: upgrade to richer node semantics (approach metadata, left/through/right movement tracking, spillback checks) and eventually reserved conflict zones for higher throughput scenarios.

0) Goals
	•	No collisions, no deadlocks, no jitter.
	•	Deterministic & scalable for many vehicles.
	•	Easy to integrate with your existing path follower and road graph.
	•	Configurable realism: start with improved “all-way stop,” allow upgrades (priority roads, reservations).

⸻

1) Assumptions & Model

Roads
	•	Roads are centerline polylines with right-hand traffic.
	•	Each approach to an intersection has one lane per direction (bi-directional single-lane roads are OK; inside the intersection we treat movements as single-file).
	•	Each approach defines:
	•	Stop line point (stopPos) a few meters before the conflict area.
	•	Detection distance dDetect upstream to start “approach” behavior (e.g., 18–30 m).
	•	Storage: how many vehicles fit between detection line and stop line (prevents spillback).

Intersections
	•	Intersection = node with:
	•	Approaches A[i] (1..N).
	•	For each approach, available turn movements: left, through, right (and optional uTurn=false by default).
	•	Conflict matrix conflicts(m1, m2) ∈ {true,false} built once from movement paths.
	•	Conflict zones (small arcs/segments) covering where paths overlap (optional, used in token method).
	•	Manager that arbitrates entry.

Vehicles
	•	Each vehicle already follows a Path2D (centerline) with a path follower.
	•	Vehicle length L, desired headway tHeadway (e.g., 1.2–1.8 s), max accel/brake (a, b).
	•	Vehicle knows its next movement at the node: left|through|right.
	•	Vehicle state machine around nodes (below).

⸻

2) Geometry Primitives You Need
	•	Stop line: a point (and tangent) per approach where the vehicle must be able to stop.
	•	Entry point: first point inside the intersection after the stop line.
	•	Exit point: first point on the outbound edge after clearing conflicts.
	•	Movement path: a short spline from entry to exit for each movement (precompute once per node); also used to populate conflict zones.

Tip: For grid-like ninety-degree roads, use quarter-circle or cubic Bezier curves for left/right turns; straight for through. Sample these to build conflict zones (short segments along the center of each movement).

⸻

3) Vehicle State Machine (near intersections)

enum NodeState { Cruising, Approaching, Queued, Requesting, Entering, Crossing, Clearing }

transition rules:
Cruising -> Approaching   (within dDetect of stop line, knows movement)
Approaching -> Queued     (must stop due to control or a vehicle ahead)
Queued -> Requesting      (at stop line, full stop achieved, front-of-queue)
Requesting -> Entering    (permission/reservation granted AND exit link has space)
Entering  -> Crossing     (front axle passes stop line)
Crossing -> Clearing      (rear axle leaves last conflict zone)
Clearing -> Cruising      (resume normal following on outbound edge)

Hard rules:
	•	Do not enter unless exit has space for L + buffer (spillback prevention).
	•	Maintain car-following headway behind leader on the same approach (even through the node).

⸻

4) Four Robust Control Methods

Method A — “All-Way Stop” (Improved, Deterministic)

Use when: Few vehicles; simplest to ship first.

Core logic
	•	Each approach maintains a FIFO queue. Vehicles crossing the stop line must full-stop (speed < small threshold) before they can request right-of-way.
	•	First-come-first-served among front vehicles of each approach, with tie-breakers:
	1.	ArrivalTime at stop (the moment speed < threshold at the stop line).
	2.	If tied → priority by movement (right turn > through > left).
	3.	If still tied → approach ordering (clockwise order around the node).
	4.	If still tied → vehicle id (lowest wins).

Gap acceptance: Before granting, check conflict matrix against any vehicle currently Crossing/Clearing and headway from the last vehicle that took the same movement (or the same approach) to prevent rear-end overlaps.

Pseudocode (manager tick)

for each approach i:
  prune queues (remove vehicles that departed)
collect candidates = {front vehicle of each non-empty queue that is fully stopped}

sort candidates by (arrivalTime, movementPriority, approachOrder, vehicleId)

for v in candidates:
  if canGrant(v.movement) && exitHasSpace(v):
     grant(v)           // set v->permission = true
     blockConflicts(v)  // mark conflicts occupied for a small clearance time

Pros
	•	Simple, readable behavior.
	•	Deterministic tie-breaking solves “two cars stuck waving each other on.”

Cons
	•	Unnecessary stops even when empty.
	•	Can reduce throughput if traffic grows.

Best practices
	•	Force a minimum stop time (e.g., 0.3–0.5 s) before request to avoid rolling stop jitter.
	•	“Creep” behavior: if you’re second in queue, roll up to the stop line at low speed.

⸻

Method B — Priority/Yield (Major–Minor) with Gap Acceptance

Use when: You have “arterial” roads and want smoother flow.
	•	Tag each approach with priority = High|Low (or numeric).
	•	High priority vehicles don’t stop unless conflicts exist; Low priority must stop and accept a gap.
	•	Gap acceptance: A low-priority vehicle can enter when no conflicting movement is active and the expected time to conflict is > tGap (1.5–2.5 s).
	•	Still apply spillback prevention.

Pros
	•	Much higher throughput on primary roads.
	•	Feels more natural than all-way stops everywhere.

Cons
	•	Slightly more logic; must compute time-to-conflict estimates.

⸻

Method C — Reservation-Based (Time–Space Slots)

Use when: You want bulletproof safety and high concurrency.
	•	The intersection discretizes its conflict zones and time (e.g., 0.1 s slices).
	•	A vehicle requests a slot window along its movement path; the manager grants if all required zones are free at those times.
	•	On grant, vehicle is told to arrive at entry at tStart and maintain speed profile; small corrections allowed.

Sketch

type Slot = { zoneId:number, t0:number, t1:number, vehId:number }

function requestSlots(movement, speed):
  zones = zonesForMovement(movement)
  window = findContiguousFreeWindow(zones, durationFor(movement,speed))
  if window available:
     reserve(zones, window, vehId)
     return window
  else queue

// Vehicle matches its approach speed to hit tStart; manager releases token near tStart

Pros
	•	Highest safety; zero conflicts by construction.
	•	Scales; no head-of-line blocking if trajectories don’t intersect.

Cons
	•	More bookkeeping + time discretization.
	•	Requires the follower to hit timing (simple with your controller: adjust vTarget to match entry time).

⸻

Method D — Tokenized Conflict Zones (Pragmatic)

Use when: You want most of the benefits of reservations without time slicing.
	•	Precompute small conflict zones (IDs) for all movements (e.g., 6–12 zones cover the box and turn arcs).
	•	A vehicle must atomically acquire all tokens for its movement before entering.
	•	If not all tokens available, it waits at the stop line.
	•	On exit, it releases tokens.
	•	Always check exit space (spillback) before acquiring.

Pros
	•	Very simple and robust.
	•	Prevents “T-bone” conflicts without timing logic.

Cons
	•	Conservative (blocks even if two movements would not occupy the same time, only space).
	•	Slightly less throughput than true reservations.

⸻

5) Generating the Conflict Matrix/Zones
	1.	For each movement (approach i, turn type):
	•	Sample its spline into points {P0..Pk}.
	•	Build capsules around each segment: center Pi→Pi+1, radius r = vehicleHalfWidth + margin.
	•	For every pair of movements m1, m2, mark conflicts(m1,m2) = true if any capsules intersect, excluding pairs from the same approach and compatible headways (rear-end is managed by headway, not conflict matrix).
	2.	If you use tokens:
	•	Merge overlapping capsules into zones (ID them).
	•	zonesForMovement(m) = set of zone IDs the path touches.

This step runs offline when the node is built; store the conflict matrix/zones on the intersection.

⸻

6) Queueing, Headways, and Spillback (Essentials)
	•	Queue per approach: ordered by distance to stop line; vehicle i tracks its leader’s bumper point.
	•	Headway: inside the node, enforce a minimal time separation for same-movement followers (e.g., 0.7–1.0 s) to avoid clipping.
	•	Spillback prevention: Do not enter if the first segment of the outbound edge cannot fit L + buffer.
	•	Storage check at detection line: If queue length × (L + gap) exceeds storage, vehicles upstream slow early to avoid bunching jitter.

⸻

7) Integration with Your Path Follower

At Approaching:
	•	Compute stop target at the stop line; set follower’s vTarget so the vehicle can comfortably stop:
	•	Distance D to stop → target speed v = clamp(sqrt(2*b*D), 0, vCurrent).
	•	Enable creep: when within 2–3 m and a leader moved, allow v ≈ 0.5–1.0 m/s until you reach the line.

At Requesting:
	•	Freeze the follower at the stop line (vTarget→0) until manager grants.
	•	For reservations: follower aims to hit entry time tStart by nudging speed on approach (±10–20%).

At Entering/Crossing:
	•	Switch the follower’s local path to the intersection movement spline (entry→exit).
	•	Optionally cap yaw rate and speed (v ≤ vTurnMax) based on turn radius.

At Clearing:
	•	Restore the path follower to the outbound edge polyline; increase vTarget smoothly.

⸻

8) Parameters (defaults to start)

export const NODE = {
  dDetect: 24,          // m (start approach behavior)
  stopEps: 0.15,        // m/s (considered "stopped")
  tMinStop: 0.4,        // s at stop line before request
  tHeadway: 1.0,        // s same-movement separation inside node
  vTurnMax: 8,          // m/s cap while turning
  bufferOut: 2.5,       // m buffer in outbound segment (spillback)
  method: "all_way" as "all_way"|"priority"|"tokens"|"reservations"
};

Tie-break movement priority (right > through > left), approach order = clockwise index (precompute and store).

⸻

9) Pseudocode — Intersection Manager (All-Way Stop + Tokens Hybrid)

function tickIntersection(dt: number) {
  // 1) Refresh queues; identify front-of-queue vehicles that are fully stopped at line
  const candidates: Vehicle[] = [];
  for (const ap of approaches) {
    const v = frontVehicle(ap);
    if (!v) continue;
    if (v.state === Queued && v.speed < NODE.stopEps && v.stopTimer > NODE.tMinStop) {
      candidates.push(v);
    }
  }

  // 2) Sort by deterministic policy
  candidates.sort(byArrivalMovementApproachId);

  // 3) Try to grant in order
  for (const v of candidates) {
    if (!exitHasSpace(v)) continue;

    const mov = v.movement;                 // e.g., A2:left
    const zones = zonesForMovement[mov];    // precomputed list of zone IDs

    // Check conflicts: either via matrix+active list OR by tokens
    if (!allTokensFree(zones)) continue;

    // Grant
    lockTokens(zones, v.id);
    v.permissionGranted();          // vehicle transitions to Entering
    // Optional: set a clearance timer per token if you want small tail safety
  }

  // 4) Release tokens from vehicles that finished Clearing this node
  for (const v of vehiclesJustClearedThisTick) {
    releaseTokens(v.lockedZones);
  }
}


⸻

10) Common Bugs & Fixes
	•	Both vehicles “polite” deadlock (each yields forever):
	•	Fix: deterministic ordering & minimum stop time; back-off timer per request to avoid livelock (e.g., if denied 5× in a row, bump priority slightly).
	•	Nudging past stop line repeatedly (jitter):
	•	Fix: snap to stop line position when speed < small eps; disable lookahead target beyond line until granted.
	•	Gridlock (entered but can’t exit):
	•	Fix: spillback rule (must have space on outbound segment before entering).
	•	Rear-end inside intersection:
	•	Fix: apply tHeadway between consecutive same-movement vehicles; deny grant if last grant on same movement was < tHeadway ago.
	•	Oscillating “who goes next” with equal arrivals:
	•	Fix: include approach index & vehicle id in the sort key; never purely random.

⸻

11) Debug Overlays (do these early)
	•	Stop lines, detection lines.
	•	Movement splines colored by last-served time.
	•	Conflict zones (tokens) colored by locked/free.
	•	Front-of-queue markers and arrival timestamps.
	•	Outbound storage box highlighting spillback availability.

⸻

12) Testing Scenarios (Acceptance)
	1.	Single 4-way, light traffic: no collisions; FIFO fairness; vehicles come to full stop then go in order.
	2.	Simultaneous arrivals on all four approaches: correct tie-break sequence; no deadlock.
	3.	Left vs through vs right: right turns yield correctly only when conflicting; otherwise pass quickly.
	4.	Blocked exit: upstream vehicles wait; intersection doesn’t gridlock.
	5.	Continuous main flow, trickle side road (priority method): major road flows with minimal stopping; minor vehicles find gaps.
	6.	High load: measure throughput; token method yields > all-way stop.

⸻

13) Implementation Order
	1.	Geometry & data: stop lines, movement splines, conflict matrix (or zones).
	2.	Vehicle state machine around nodes; spillback check.
	3.	All-way stop manager with deterministic ordering.
	4.	Token lock for conflicts (optional but recommended).
	5.	Priority road flag + gap acceptance (upgrade).
	6.	(Optional) Reservation timing for maximum throughput.

⸻

14) Minimal Type Hints

type Movement = "left" | "through" | "right";

interface Approach {
  id: number;
  stopPos: Vec3;
  detectPos: Vec3;
  approachOrder: number;     // clockwise rank
  priority: "high"|"low";
  queue: number[];           // vehicle ids
}

interface MovementDef {
  approachId: number;
  type: Movement;
  spline: Vec3[];            // entry->exit path
  zones: number[];           // conflict zone ids touched
}

interface Intersection {
  id: number;
  approaches: Approach[];
  movements: MovementDef[];  // indexable by (approachId,type)
  conflicts: boolean[][];    // movement x movement (if using matrix)
  tokens: (vehId|null)[];    // per zone (if using tokens)
  lastServedAt: number[];    // per movement (for headway check)
}

interface Vehicle {
  id: number;
  L: number;                 // length
  state: NodeState;
  speed: number;
  arrivalTimeAtStop?: number;
  approachId: number;
  movement: Movement;
  lockedZones: number[];
}


⸻

15) Tuning Defaults (Start Here)
	•	dDetect = 24 m, tMinStop = 0.4 s, tHeadway = 1.0 s, bufferOut = 2.5 m, vTurnMax = 8 m/s.
	•	Token zones: start with center box (1) + four corner arcs (4) = 5 zones; expand if you observe false conflicts.

⸻

This spec gives you a clean, deterministic all-way stop that won’t deadlock, plus two upgrade paths (priority/gap and tokens/reservations) if you need more throughput later. Plug the manager’s grant/deny into your path follower’s stop/enter behavior and you’ll eliminate the current “buggy 4-way stop” symptoms.
